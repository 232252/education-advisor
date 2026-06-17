//! Harness 集成测试 (阶段二 Round 7)
//!
//! 覆盖点:
//! 1. ToolRegistry::builder + 25 个 Tool impl 注册正常
//! 2. ReActMachine::parse_step 把 StreamEvent 列表解析为 ToolCalls / FinalAnswer / Continue
//! 3. ReActMachine::validate_transition 校验合法/非法转换
//! 4. ReActMachine::build_tool_result_message 构造回喂消息
//! 5. PromptBuilder::build 输出包含 SOUL/Rules/caps/tools/skill
//! 6. BudgetTracker::on_round_started + on_usage 在超限时返回 BudgetExceeded
//!
//! 不覆盖 (留到阶段三+):
//! - AgentHarness::run 端到端 (需要 mock LLM)
//! - HITL 审批流
//! - StateStore 真实 SQLite 写入 (需要 tempdir)
//! - EventBridge emit (需要 mock AppHandle)

use ea_tauri::harness::agent::budget::{Budget, BudgetTracker};
use ea_tauri::harness::agent::prompt_builder::{AppContext, PromptBuilder, PromptInputs, SkillPromptEntry};
use ea_tauri::harness::agent::react_machine::{
    ParsedToolCall, ReActMachine, ReactPhase, StepDecision,
};
use ea_tauri::services::llm_service::StreamEvent;

// =============================================================
// 1. ToolRegistry 注册测试
// =============================================================

#[test]
fn test_registry_default_has_all_25_tools() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let names = reg.tool_names();
    assert!(
        names.len() >= 25,
        "expected >= 25 tools, got {}",
        names.len()
    );

    // 抽查关键工具
    assert!(names.contains(&"get_score"));
    assert!(names.contains(&"add_event"));
    assert!(names.contains(&"delete_student"));
    assert!(names.contains(&"reset_factory"));
    assert!(names.contains(&"calculate"));
}

#[test]
fn test_registry_capability_check_passes() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let caps = vec!["read:scores".to_string()];
    let checked = reg.get_checked("get_score", &caps);
    assert!(
        checked.is_ok(),
        "get_score should be allowed with read:scores"
    );
}

#[test]
fn test_registry_capability_check_fails() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    // get_score 需要 read:scores, 只给 write:events 应当被拒
    let caps = vec!["write:events".to_string()];
    let checked = reg.get_checked("get_score", &caps);
    assert!(
        checked.is_err(),
        "get_score should NOT be allowed without read:scores"
    );
}

#[test]
fn test_registry_wildcard_cap() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let caps = vec!["all".to_string()];
    // "all" 应放行任何工具
    assert!(reg.get_checked("delete_student", &caps).is_ok());
    assert!(reg.get_checked("reset_factory", &caps).is_ok());
}

#[test]
fn test_registry_is_write_flag() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    // 只读工具
    let get_score = reg.get("get_score").unwrap();
    assert!(!get_score.is_write(), "get_score must not be write");
    // 写工具
    let add_event = reg.get("add_event").unwrap();
    assert!(add_event.is_write(), "add_event must be write");
    // 危险工具
    let reset = reg.get("reset_factory").unwrap();
    assert!(reset.is_write(), "reset_factory must be write");
}

#[test]
fn test_registry_unknown_tool() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let caps = vec!["all".to_string()];
    let r = reg.get_checked("nonexistent_tool", &caps);
    assert!(r.is_err());
}

#[test]
fn test_registry_llm_descriptions() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let descs = reg.llm_descriptions();
    assert!(!descs.is_empty());
    // 每个 desc 都有 name + schema
    for d in &descs {
        assert!(!d.name.is_empty());
        assert!(d.schema.is_object() || d.schema.is_string());
    }
}

// =============================================================
// 1b. Capability 别名展开测试（config/agents.yaml 语义）
// =============================================================

#[test]
fn test_capability_yaml_alias_read_allows_get_score() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let raw = vec!["read".to_string()];
    let expanded = ea_tauri::harness::tools::expand_capabilities(&raw);
    assert!(
        expanded.contains(&"read:scores".to_string()),
        "read alias should expand to read:scores"
    );
    assert!(reg.get_checked("get_score", &expanded).is_ok());
}

#[test]
fn test_capability_yaml_alias_write_allows_add_event() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let raw = vec!["write".to_string()];
    let expanded = ea_tauri::harness::tools::expand_capabilities(&raw);
    assert!(
        expanded.contains(&"write:events".to_string()),
        "write alias should expand to write:events"
    );
    assert!(reg.get_checked("add_event", &expanded).is_ok());
}

#[test]
fn test_capability_read_blocks_write_tool() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let raw = vec!["read".to_string()];
    let expanded = ea_tauri::harness::tools::expand_capabilities(&raw);
    assert!(reg.get_checked("add_event", &expanded).is_err());
}

#[test]
fn test_capability_academic_alias_expands_both_ways() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let raw = vec!["academic".to_string()];
    let expanded = ea_tauri::harness::tools::expand_capabilities(&raw);
    assert!(reg.get_checked("academic_get", &expanded).is_ok());
    assert!(reg.get_checked("academic_add", &expanded).is_ok());
}

// =============================================================
// 2. ReActMachine::parse_step 测试
// =============================================================

#[test]
fn test_parse_step_tool_calls() {
    let events = vec![
        StreamEvent::ToolcallStart {
            id: "c1".into(),
            name: "get_score".into(),
        },
        StreamEvent::ToolcallDelta {
            id: "c1".into(),
            args_delta: r#"{"student":"张三"}"#.into(),
        },
        StreamEvent::ToolcallEnd { id: "c1".into() },
        StreamEvent::Done {
            usage: ea_tauri::services::llm_service::TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            },
            cost: 0.001,
        },
    ];
    let decision = ReActMachine::parse_step(&events);
    match decision {
        StepDecision::ToolCalls(calls) => {
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].name, "get_score");
            assert_eq!(calls[0].id, "c1");
            assert_eq!(calls[0].args["student"], "张三");
        }
        _ => panic!("expected ToolCalls"),
    }
}

#[test]
fn test_parse_step_final_answer() {
    let events = vec![
        StreamEvent::TextDelta {
            delta: "你好".into(),
        },
        StreamEvent::TextDelta {
            delta: ", 张三".into(),
        },
        StreamEvent::Done {
            usage: ea_tauri::services::llm_service::TokenUsage {
                input_tokens: 10,
                output_tokens: 20,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            },
            cost: 0.0,
        },
    ];
    let decision = ReActMachine::parse_step(&events);
    match decision {
        StepDecision::FinalAnswer(text) => {
            assert_eq!(text, "你好, 张三");
        }
        _ => panic!("expected FinalAnswer"),
    }
}

#[test]
fn test_parse_step_multiple_tool_calls() {
    let events = vec![
        StreamEvent::ToolcallStart {
            id: "c1".into(),
            name: "get_score".into(),
        },
        StreamEvent::ToolcallDelta {
            id: "c1".into(),
            args_delta: r#"{"student":"张三"}"#.into(),
        },
        StreamEvent::ToolcallEnd { id: "c1".into() },
        StreamEvent::ToolcallStart {
            id: "c2".into(),
            name: "list_students".into(),
        },
        StreamEvent::ToolcallDelta {
            id: "c2".into(),
            args_delta: "{}".into(),
        },
        StreamEvent::ToolcallEnd { id: "c2".into() },
        StreamEvent::Done {
            usage: ea_tauri::services::llm_service::TokenUsage {
                input_tokens: 200,
                output_tokens: 100,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            },
            cost: 0.005,
        },
    ];
    let decision = ReActMachine::parse_step(&events);
    match decision {
        StepDecision::ToolCalls(calls) => {
            assert_eq!(calls.len(), 2);
            assert_eq!(calls[0].name, "get_score");
            assert_eq!(calls[1].name, "list_students");
        }
        _ => panic!("expected 2 ToolCalls"),
    }
}

#[test]
fn test_parse_step_malformed_args_fallback() {
    // args_delta 不是合法 JSON, parse_step 应兜底为 Value::String
    let events = vec![
        StreamEvent::ToolcallStart {
            id: "c1".into(),
            name: "x".into(),
        },
        StreamEvent::ToolcallDelta {
            id: "c1".into(),
            args_delta: "not-json".into(),
        },
        StreamEvent::ToolcallEnd { id: "c1".into() },
        StreamEvent::Done {
            usage: ea_tauri::services::llm_service::TokenUsage {
                input_tokens: 0,
                output_tokens: 0,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            },
            cost: 0.0,
        },
    ];
    let decision = ReActMachine::parse_step(&events);
    if let StepDecision::ToolCalls(calls) = decision {
        // 兜底为字符串
        assert!(calls[0].args.is_string());
    } else {
        panic!("expected ToolCalls even with malformed args");
    }
}

// =============================================================
// 3. ReActMachine::validate_transition 测试
// =============================================================

#[test]
fn test_validate_transition_legal() {
    use ReactPhase::*;
    assert!(ReActMachine::validate_transition(Init, Act).is_ok());
    assert!(ReActMachine::validate_transition(Act, Observe).is_ok());
    assert!(ReActMachine::validate_transition(Observe, Act).is_ok());
    assert!(ReActMachine::validate_transition(Observe, Reflect).is_ok());
    assert!(ReActMachine::validate_transition(Reflect, Done).is_ok());
    assert!(ReActMachine::validate_transition(Act, Done).is_ok()); // LLM 直接 final
    assert!(ReActMachine::validate_transition(Observe, Done).is_ok());
}

#[test]
fn test_validate_transition_illegal() {
    use ReactPhase::*;
    assert!(ReActMachine::validate_transition(Init, Done).is_err());
    assert!(ReActMachine::validate_transition(Done, Act).is_err());
    assert!(ReActMachine::validate_transition(Reflect, Act).is_err());
    assert!(ReActMachine::validate_transition(Init, Observe).is_err());
}

// =============================================================
// 4. ReActMachine::build_tool_result_message 测试
// =============================================================

#[test]
fn test_build_tool_result_message() {
    let msg = ReActMachine::build_tool_result_message("call_abc", r#"{"score":95}"#);
    assert_eq!(msg.role, "tool");
    assert!(msg.content.contains("call_abc"));
    assert!(msg.content.contains(r#""score":95"#));
}

// =============================================================
// 5. PromptBuilder 测试
// =============================================================

#[test]
fn test_prompt_builder_basic() {
    let prompt = PromptBuilder::build(&PromptInputs {
        soul: "你是 AI 助手",
        rules: "遵守规则",
        capabilities: &["read:scores".into()],
        skills: &[],
        tools: &[],
        agent_id: "test_agent",
        memory: "",
        app_context: &AppContext::default(),
    });
    assert!(prompt.contains("AI 助手"));
    assert!(prompt.contains("遵守规则"));
    assert!(prompt.contains("read:scores"));
    assert!(prompt.contains("test_agent"));
}

#[test]
fn test_prompt_builder_with_skills_and_tools() {
    let skills = vec![SkillPromptEntry {
        name: "ocr".into(),
        description: "OCR 识别图片文字".into(),
        enabled: true,
    }];
    let tools = vec![ea_tauri::harness::tools::ToolDescription {
        name: "calculate".into(),
        description: "数学计算".into(),
        schema: serde_json::json!({"type":"object"}),
        is_write: false,
    }];
    let prompt = PromptBuilder::build(&PromptInputs {
        soul: "x",
        rules: "",
        capabilities: &["read:math".into()],
        skills: &skills,
        tools: &tools,
        agent_id: "a",
        memory: "",
        app_context: &AppContext::default(),
    });
    assert!(prompt.contains("OCR 识别图片文字"));
    assert!(prompt.contains("calculate"));
    assert!(prompt.contains("数学计算"));
    // 空 rules 不应渲染 RULES 段
    assert!(!prompt.contains("行为规则"));
}

#[test]
fn test_prompt_builder_filters_disabled_skills() {
    let skills = vec![
        SkillPromptEntry {
            name: "on".into(),
            description: "ON".into(),
            enabled: true,
        },
        SkillPromptEntry {
            name: "off".into(),
            description: "OFF".into(),
            enabled: false,
        },
    ];
    let prompt = PromptBuilder::build(&PromptInputs {
        soul: "x",
        rules: "",
        capabilities: &[],
        skills: &skills,
        tools: &[],
        agent_id: "a",
        memory: "",
        app_context: &AppContext::default(),
    });
    assert!(prompt.contains("on: ON"));
    assert!(!prompt.contains("off: OFF"));
}

#[test]
fn test_prompt_builder_write_tag() {
    let tools = vec![ea_tauri::harness::tools::ToolDescription {
        name: "add_event".into(),
        description: "添加事件".into(),
        schema: serde_json::json!({"type":"object"}),
        is_write: true,
    }];
    let prompt = PromptBuilder::build(&PromptInputs {
        soul: "x",
        rules: "",
        capabilities: &[],
        skills: &[],
        tools: &tools,
        agent_id: "a",
        memory: "",
        app_context: &AppContext::default(),
    });
    assert!(prompt.contains("⚠️") || prompt.contains("写操作"));
}

// =============================================================
// 6. BudgetTracker 测试
// =============================================================

#[test]
fn test_budget_tracker_under_limit() {
    let mut t = BudgetTracker::new(Budget::default());
    assert!(t.on_round_started().is_ok());
    assert!(t.on_usage(100, 50, 1000).is_ok());
    let snap = t.snapshot();
    assert_eq!(snap.rounds, 1);
    assert_eq!(snap.input_tokens, 100);
}

#[test]
fn test_budget_tracker_exceeds_rounds() {
    let b = Budget {
        max_rounds: 2,
        ..Budget::default()
    };
    let mut t = BudgetTracker::new(b);
    assert!(t.on_round_started().is_ok());
    assert!(t.on_round_started().is_ok());
    let r = t.on_round_started();
    assert!(r.is_err(), "should exceed at round 3");
}

#[test]
fn test_budget_tracker_exceeds_tokens() {
    let b = Budget {
        max_input_tokens: 100,
        ..Budget::default()
    };
    let mut t = BudgetTracker::new(b);
    assert!(t.on_usage(50, 0, 0).is_ok());
    assert!(
        t.on_usage(60, 0, 0).is_err(),
        "should exceed 100 input tokens"
    );
}

#[test]
fn test_budget_tracker_exceeds_cost() {
    let b = Budget {
        max_cost_usd_micros: 100,
        ..Budget::default()
    };
    let mut t = BudgetTracker::new(b);
    assert!(t.on_usage(0, 0, 50).is_ok());
    assert!(t.on_usage(0, 0, 60).is_err());
}

#[test]
fn test_budget_tight() {
    let b = Budget::tight();
    assert!(b.max_rounds <= 4);
    assert!(b.max_cost_usd_micros <= 1_000_000);
}

// =============================================================
// 7. Registry 不可变性测试
// =============================================================

#[test]
fn test_registry_immutable_after_build() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    // 同一个 registry 应可 clone 并共享
    let reg2 = reg.clone();
    assert_eq!(reg.tool_names(), reg2.tool_names());
}

#[test]
fn test_registry_debug_includes_tool_count() {
    let reg = ea_tauri::harness::tools::build_default_registry();
    let dbg = format!("{:?}", reg);
    assert!(dbg.contains("ToolRegistry"));
    assert!(dbg.contains("tool_count"));
}

// =============================================================
// 8. ParsedToolCall 测试
// =============================================================

#[test]
fn test_parsed_tool_call_construct() {
    let p = ParsedToolCall {
        id: "c1".into(),
        name: "add_event".into(),
        args: serde_json::json!({"student": "张三"}),
    };
    assert_eq!(p.id, "c1");
    assert_eq!(p.name, "add_event");
    assert_eq!(p.args["student"], "张三");
}
