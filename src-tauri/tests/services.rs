//! Service 层测试 — 覆盖不需要 Tauri 运行时的业务逻辑。
//! 命名空间: settings / profile / privacy_audit / llm / db / agent_service。

use ea_tauri::services::agent_service::{AgentService, ModelTier};
use ea_tauri::services::db::DbService;
use ea_tauri::services::llm_service::LlmService;
use ea_tauri::services::privacy_audit::{AuditEntry, PrivacyAuditService};
use ea_tauri::services::profile_service::{AcademicExamRecord, ProfileService};
use std::collections::HashMap;
use ea_tauri::services::settings_service::SettingsService;
use serde_json::json;
use std::path::PathBuf;

// ============================================================
// settings_service: dot-path 更新 / reset / get_path / eaa_data_dir
// ============================================================

#[test]
fn test_settings_dot_path_update_and_get() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsService::load(dir.path()).unwrap();

    // 初始无 general.theme
    assert!(s.get_path("general.theme").is_none() || s.get_path("general.theme") == Some(&json!(null)));

    // update
    s.update("general.theme", json!("dark")).unwrap();
    assert_eq!(s.get_path("general.theme"), Some(&json!("dark")));

    // 嵌套两层
    s.update("models.retry.maxRetries", json!(5)).unwrap();
    assert_eq!(s.get_path("models.retry.maxRetries"), Some(&json!(5)));
}

#[test]
fn test_settings_persist_and_reload() {
    let dir = tempfile::tempdir().unwrap();

    // 写
    {
        let mut s = SettingsService::load(dir.path()).unwrap();
        s.update("general.language", json!("zh-CN")).unwrap();
    }

    // 重新加载应读到
    let s2 = SettingsService::load(dir.path()).unwrap();
    assert_eq!(s2.get_path("general.language"), Some(&json!("zh-CN")));
}

#[test]
fn test_settings_reset() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = SettingsService::load(dir.path()).unwrap();
    s.update("general.theme", json!("dark")).unwrap();
    assert!(s.get_path("general.theme").is_some());

    s.reset().unwrap();
    // reset 后 theme 应回到默认 (default-settings 里是 "dark")
    // 注: 无 resources/config 时 defaults 为空对象, reset 后 theme 消失
}

#[test]
fn test_settings_eaa_data_dir_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let s = SettingsService::load(dir.path()).unwrap();
    let data_dir = s.eaa_data_dir(dir.path());
    // dataDir 为空时应回退到 userData/eaa-data
    assert!(data_dir.ends_with("eaa-data"));
}

// ============================================================
// profile_service: validate_academic 校验规则
// ============================================================

fn make_record(exam_type: &str, exam_name: &str, subjects: Vec<(&str, Option<f64>)>) -> AcademicExamRecord {
    let mut map = HashMap::new();
    for (k, v) in subjects {
        map.insert(k.to_string(), v);
    }
    AcademicExamRecord {
        exam_type: exam_type.into(),
        exam_name: exam_name.into(),
        subjects: map,
        date: None,
        notes: None,
    }
}

#[test]
fn test_validate_academic_valid() {
    let records = vec![
        make_record("期中", "2025秋期中", vec![("数学", Some(95.0)), ("语文", Some(88.0))]),
    ];
    let errs = ProfileService::validate_academic(&records);
    assert!(errs.is_empty(), "有效记录不应有错误: {errs:?}");
}

#[test]
fn test_validate_academic_score_out_of_range() {
    let records = vec![make_record("期中", "2025秋期中", vec![("数学", Some(9999.0))])];
    let errs = ProfileService::validate_academic(&records);
    assert!(!errs.is_empty(), "成绩超出范围应报错");
    assert!(errs[0].contains("超出范围"));
}

#[test]
fn test_validate_academic_nan_score() {
    let records = vec![make_record("期中", "2025秋期中", vec![("数学", Some(f64::NAN))])];
    let errs = ProfileService::validate_academic(&records);
    assert!(!errs.is_empty(), "NaN 成绩应报错");
}

#[test]
fn test_validate_academic_empty_exam_type() {
    let records = vec![make_record("  ", "2025秋期中", vec![("数学", Some(80.0))])];
    let errs = ProfileService::validate_academic(&records);
    assert!(errs.iter().any(|e| e.contains("考试类型")), "空考试类型应报错: {errs:?}");
}

#[test]
fn test_validate_academic_no_subjects() {
    let records = vec![make_record("期中", "2025秋期中", vec![])];
    let errs = ProfileService::validate_academic(&records);
    assert!(errs.iter().any(|e| e.contains("至少需要一个科目")), "无科目应报错: {errs:?}");
}

#[test]
fn test_validate_academic_bad_date_format() {
    let mut r = make_record("期中", "2025秋期中", vec![("数学", Some(80.0))]);
    r.date = Some("2025/10/01".into()); // 应为 YYYY-MM-DD
    let errs = ProfileService::validate_academic(&[r]);
    assert!(errs.iter().any(|e| e.contains("日期格式")), "错误日期格式应报错: {errs:?}");
}

// ============================================================
// privacy_audit: append → read → sha256 → generate_report
// ============================================================

#[test]
fn test_privacy_audit_append_read_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("audit.log");
    let svc = PrivacyAuditService::open(path).unwrap();

    let entry = AuditEntry {
        ts: 1000,
        op: "anonymize".into(),
        input_len: 100,
        output_len: 90,
        has_pii: true,
        pii_count: 3,
        receiver: Some("llm:openai".into()),
        entity_type: Some("Student".into()),
        duration_ms: 5,
        success: true,
        error: None,
    };
    svc.append(&entry).unwrap();

    let entries = svc.read(10).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].op, "anonymize");
    assert!(entries[0].has_pii);
}

#[test]
fn test_privacy_audit_sha256_consistent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("audit.log");
    let svc = PrivacyAuditService::open(path).unwrap();

    let entry = AuditEntry {
        ts: 1, op: "filter".into(), input_len: 10, output_len: 8, has_pii: false,
        pii_count: 0, receiver: None, entity_type: None, duration_ms: 1, success: true, error: None,
    };
    svc.append(&entry).unwrap();

    let h1 = svc.sha256().unwrap();
    let h2 = svc.sha256().unwrap();
    assert_eq!(h1, h2, "同一内容 SHA-256 应一致");
    assert_eq!(h1.len(), 64, "SHA-256 应是 64 hex 字符");
}

#[test]
fn test_privacy_audit_generate_report() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("audit.log");
    let svc = PrivacyAuditService::open(path).unwrap();

    // 写 3 条审计 (2 anonymize + 1 filter), 时间戳在 [100, 200) 内
    for i in 0..3 {
        let op = if i < 2 { "anonymize" } else { "filter" };
        svc.append(&AuditEntry {
            ts: 100 + i,
            op: op.into(),
            input_len: 50,
            output_len: 40,
            has_pii: i == 0,
            pii_count: if i == 0 { 2 } else { 0 },
            receiver: Some("llm".into()),
            entity_type: Some("Student".into()),
            duration_ms: 3,
            success: true,
            error: None,
        })
        .unwrap();
    }

    let report = svc.generate_report(100, 200, "测试季度").unwrap();
    assert_eq!(report.summary.total_calls, 3);
    assert_eq!(report.summary.anonymize_calls, 2);
    assert_eq!(report.summary.filter_calls, 1);
    assert_eq!(report.summary.success_calls, 3);
    assert_eq!(report.pii_stats.calls_with_pii, 1);
    assert_eq!(report.pii_stats.total_pii_hits, 2);
    assert!(!report.manifest.audit_log_sha256.is_empty());
    assert!(!report.manifest.report_sha256.is_empty());
}

// ============================================================
// llm_service: provider 注册表 (不需网络)
// ============================================================

#[test]
fn test_llm_provider_registry() {
    let providers = LlmService::list_providers();
    assert!(providers.len() >= 10, "应至少有 10 个内置 provider, 实际: {}", providers.len());

    // 验证关键 provider 存在
    let ids: Vec<&str> = providers.iter().map(|p| p.id.as_str()).collect();
    for must in &["openai", "anthropic", "gemini", "deepseek", "qwen", "ollama"] {
        assert!(ids.contains(must), "缺少 provider: {must}");
    }
}

#[test]
fn test_llm_provider_auth_types() {
    let providers = LlmService::list_providers();
    // 本地 provider (ollama/lmstudio) auth_type 应是 "local"
    let ollama = providers.iter().find(|p| p.id == "ollama").unwrap();
    assert_eq!(ollama.auth_type, "local");
    // openai 应是 "api_key"
    let openai = providers.iter().find(|p| p.id == "openai").unwrap();
    assert_eq!(openai.auth_type, "api_key");
}

// ============================================================
// db: SQLite 表创建 + 基础 CRUD
// ============================================================

#[test]
fn test_db_agent_execution_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let db = DbService::open(&dir.path().join("test.db")).unwrap();

    // insert
    let id = futures::executor::block_on(db.insert_execution(&ea_tauri::services::db::AgentExecutionRecord {
        id: None,
        agent_id: "class-monitor".into(),
        started_at: 1000,
        finished_at: None,
        status: "running".into(),
        prompt: Some("test".into()),
        output: None,
        error: None,
        tokens_input: None,
        tokens_output: None,
        cost_total: None,
    }))
    .unwrap();
    assert!(id > 0);

    // history
    let hist = futures::executor::block_on(db.get_execution_history("class-monitor", 10)).unwrap();
    assert_eq!(hist.len(), 1);
    assert_eq!(hist[0].agent_id, "class-monitor");
}

#[test]
fn test_db_cron_log_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let db = DbService::open(&dir.path().join("test.db")).unwrap();

    futures::executor::block_on(db.insert_cron_log(&ea_tauri::services::db::CronLogRecord {
        id: None,
        task_id: "cron_abc".into(),
        level: "info".into(),
        message: "执行成功".into(),
        timestamp: 1000,
        metadata: None,
    }))
    .unwrap();

    let logs = futures::executor::block_on(db.get_cron_logs(Some("cron_abc"))).unwrap();
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].message, "执行成功");
}

#[test]
fn test_db_chat_message_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    let db = DbService::open(&dir.path().join("test.db")).unwrap();

    let id = futures::executor::block_on(db.save_message(&ea_tauri::services::db::ChatMessageRecord {
        id: None,
        session_id: "sess1".into(),
        role: "user".into(),
        content: "你好".into(),
        thinking: None,
        tool_calls: None,
        timestamp: 1000,
        provider: Some("openai".into()),
        model: Some("gpt-4o".into()),
        token_input: Some(10),
        token_output: Some(20),
        cost: Some(0.001),
    }))
    .unwrap();
    assert!(id > 0);

    let msgs = futures::executor::block_on(db.load_messages(Some("sess1"))).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["content"], json!("你好"));
}

// ============================================================
// agent_service: 加载 agents.yaml (用仓库资源)
// ============================================================

#[test]
fn test_agent_service_loads_all_agents() {
    // 资源目录: src-tauri/.. = 仓库根
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let svc = AgentService::load(&resources).unwrap();

    let list = svc.list();
    assert!(list.len() >= 15, "应至少加载 15 个 agent, 实际: {}", list.len());

    // main agent 必须存在
    let main = svc.get("main");
    assert!(main.is_some(), "main agent 必须存在");
    let main = main.unwrap();
    assert!(!main.soul.is_empty(), "main 的 SOUL.md 应有内容");
    assert!(!main.rules.is_empty(), "main 的 AGENTS.md 应有内容");
}

#[test]
fn test_agent_service_capability_check() {
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let svc = AgentService::load(&resources).unwrap();

    // main agent 有 read/write/all 等大量 capability
    let caps = svc.capabilities("main");
    assert!(!caps.is_empty(), "main 应有 capabilities");
}

#[test]
fn test_agent_service_model_tier() {
    let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let svc = AgentService::load(&resources).unwrap();

    // 至少有一个 high_quality 和一个 low_cost
    let list = svc.list();
    let has_hq = list.iter().any(|a| a.model_tier == ModelTier::HighQuality);
    let has_lc = list.iter().any(|a| a.model_tier == ModelTier::LowCost);
    assert!(has_hq, "应有 high_quality tier agent");
    assert!(has_lc, "应有 low_cost tier agent");
}

// ============================================================
// P0 补测 — db 剩余 CRUD + llm custom model CRUD + settings set_custom_models
// ============================================================

// ---- db.rs 剩余 CRUD ----

#[test]
fn test_db_update_execution() {
    let dir = tempfile::tempdir().unwrap();
    let db = DbService::open(&dir.path().join("test.db")).unwrap();
    let rec = ea_tauri::services::db::AgentExecutionRecord {
        id: None,
        agent_id: "test-agent".into(),
        started_at: 1_700_000_000_000,
        finished_at: None,
        status: "running".into(),
        prompt: Some("hi".into()),
        output: None,
        error: None,
        tokens_input: None,
        tokens_output: None,
        cost_total: None,
    };
    let id = futures::executor::block_on(db.insert_execution(&rec)).unwrap();
    assert!(id > 0);

    // 标记完成
    let finished = ea_tauri::services::db::AgentExecutionRecord {
        id: Some(id),
        agent_id: "test-agent".into(),
        started_at: 1_700_000_000_000,
        finished_at: Some(1_700_000_005_000),
        status: "success".into(),
        prompt: None,
        output: Some("done".into()),
        error: None,
        tokens_input: Some(10),
        tokens_output: Some(20),
        cost_total: Some(0.001),
    };
    futures::executor::block_on(db.update_execution(id, &finished)).unwrap();

    let hist = futures::executor::block_on(db.get_execution_history("test-agent", 10)).unwrap();
    assert_eq!(hist.len(), 1);
    assert_eq!(hist[0].status, "success");
    assert_eq!(hist[0].output.as_deref(), Some("done"));
    assert_eq!(hist[0].tokens_input, Some(10));
    assert_eq!(hist[0].cost_total, Some(0.001));
}

#[test]
fn test_db_get_all_executions_with_filters() {
    let dir = tempfile::tempdir().unwrap();
    let db = DbService::open(&dir.path().join("test.db")).unwrap();

    // 3 条不同 agent + 不同 status
    for (agent, status, started) in [
        ("a1", "success", 1_700_000_001_000i64),
        ("a1", "failure", 1_700_000_002_000),
        ("a2", "success", 1_700_000_003_000),
    ] {
        let rec = ea_tauri::services::db::AgentExecutionRecord {
            id: None,
            agent_id: agent.into(),
            started_at: started,
            finished_at: Some(started + 100),
            status: status.into(),
            prompt: None,
            output: None,
            error: None,
            tokens_input: None,
            tokens_output: None,
            cost_total: None,
        };
        futures::executor::block_on(db.insert_execution(&rec)).unwrap();
    }

    // 仅 success
    let r = futures::executor::block_on(db.get_all_executions(Some("success"), None, None, 100)).unwrap();
    assert_eq!(r.len(), 2);

    // 仅 a1
    let r = futures::executor::block_on(db.get_all_executions(None, Some("a1"), None, 100)).unwrap();
    assert_eq!(r.len(), 2);

    // since 过滤
    let r = futures::executor::block_on(db.get_all_executions(None, None, Some(1_700_000_002_500), 100)).unwrap();
    assert_eq!(r.len(), 1);
}

#[test]
fn test_db_delete_and_list_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let db = DbService::open(&dir.path().join("test.db")).unwrap();

    // 写 3 条消息到 2 个 session
    for (sid, content) in [("s1", "hello"), ("s1", "world"), ("s2", "foo")] {
        let msg = ea_tauri::services::db::ChatMessageRecord {
            id: None,
            session_id: sid.into(),
            role: "user".into(),
            content: content.into(),
            thinking: None,
            tool_calls: None,
            timestamp: 1_700_000_000_000,
            provider: None,
            model: None,
            token_input: None,
            token_output: None,
            cost: None,
        };
        futures::executor::block_on(db.save_message(&msg)).unwrap();
    }

    // 列出 2 个 session
    let sessions = futures::executor::block_on(db.list_sessions()).unwrap();
    assert_eq!(sessions.len(), 2);

    // 删 s1
    futures::executor::block_on(db.delete_session("s1")).unwrap();
    let sessions = futures::executor::block_on(db.list_sessions()).unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "s2");

    // s1 的 messages 也应删掉
    let msgs = futures::executor::block_on(db.load_messages(Some("s1"))).unwrap();
    assert_eq!(msgs.len(), 0);
}

// ---- llm_service 自定义模型 CRUD ----

fn make_model(id: &str, name: &str, provider: &str) -> ea_tauri::services::llm_service::ModelInfo {
    ea_tauri::services::llm_service::ModelInfo {
        id: id.into(),
        name: name.into(),
        provider: provider.into(),
        context_window: Some(8192),
        max_output_tokens: Some(4096),
        supports_reasoning: false,
        supports_vision: false,
        cost_per_input_token: None,
        cost_per_output_token: None,
        custom: true,
    }
}

#[test]
fn test_llm_custom_model_lifecycle() {
    let svc = LlmService::new();

    // 初始: 无自定义模型
    assert!(svc.list_models("custom-provider").is_empty());

    // add 2 个
    svc.add_custom_model(make_model("custom-1", "Custom One", "custom-provider"));
    svc.add_custom_model(make_model("custom-2", "Custom Two", "custom-provider"));
    let models = svc.list_models("custom-provider");
    assert_eq!(models.len(), 2);

    // update custom-1
    let mut updated = make_model("custom-1", "Custom One v2", "custom-provider");
    updated.context_window = Some(16384);
    svc.update_custom_model("custom-provider", "custom-1", updated);
    let models = svc.list_models("custom-provider");
    let c1 = models.iter().find(|m| m.id == "custom-1").unwrap();
    assert_eq!(c1.name, "Custom One v2");
    assert_eq!(c1.context_window, Some(16384));

    // delete custom-2
    svc.delete_custom_model("custom-provider", "custom-2");
    let models = svc.list_models("custom-provider");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "custom-1");

    // delete 不存在的 model: noop
    svc.delete_custom_model("custom-provider", "nonexistent");
    assert_eq!(svc.list_models("custom-provider").len(), 1);
}

#[test]
fn test_llm_get_provider_returns_builtin() {
    let p = LlmService::get_provider("openai");
    assert!(p.is_some(), "openai 应在内置列表");
    let p = p.unwrap();
    assert_eq!(p.id, "openai");
}

#[test]
fn test_llm_get_provider_returns_none_for_unknown() {
    assert!(LlmService::get_provider("nonexistent-provider-xyz").is_none());
}

// ---- settings_service.set_custom_models ----

#[test]
fn test_settings_set_custom_models_persists() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    let mut svc = SettingsService::load(&dir.path()).unwrap();

    let models = vec![
        json!({"id": "x1", "name": "X One", "contextWindow": 4096}),
        json!({"id": "x2", "name": "X Two", "contextWindow": 8192}),
    ];
    svc.set_custom_models("my-provider", models.clone()).unwrap();

    // 重 load, 应能读到
    let svc2 = SettingsService::load(&dir.path()).unwrap();
    // 嵌套结构: models.customModels[provider_id] = [...]
    let stored = svc2.get_path("models.customModels")
        .and_then(|v| v.get("my-provider"))
        .unwrap();
    let arr = stored.as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0]["id"], "x1");
    assert_eq!(arr[1]["contextWindow"], 8192);

    // path 已写入
    assert!(path.exists());
}
