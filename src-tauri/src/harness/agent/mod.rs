//! Agent Harness — 执行层主入口
//!
//! # 职责
//! 编排一次完整的 agent run:
//! 1. 加载 agent 配置 (SOUL/Rules/caps) + Skill + Tool 描述
//! 2. 组装 system prompt (PromptBuilder)
//! 3. 启动 StateStore run (写 agent_runs 表)
//! 4. 进入 ReAct 循环 (ReActMachine):
//!    a. LLM 单步 stream_chat
//!    b. 解析 ToolCalls 或 FinalAnswer
//!    c. ToolCalls: ToolRegistry::get_checked → 执行 → 记录 tool_call
//!    d. 写操作: 阶段三会加 HITL; 阶段二先放行
//!    e. BudgetTracker.check()
//! 5. finish_run (写 status=success/failure)
//!
//! # 阶段二 vs 旧 agent_runner
//! - 旧实现 290 行胖函数, 把编排、隐私脱敏、事件 emit、tool 闭包、DB 写全混
//! - Harness 把编排集中在 AgentHarness::run (~120 行), 隐私脱敏留阶段三, 事件 emit
//!   走 EventBridge, tool 调用走 ToolRegistry, DB 走 StateStore
//! - 旧 `stream_chat_with_tool_loop` 删除, 工具循环由 Harness 显式驱动

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use crate::error::AppError;
use crate::harness::agent::budget::{Budget, BudgetTracker};
use crate::harness::agent::event_bridge::{AgentStatusUpdate, EventBridge};
use crate::harness::agent::prompt_builder::{PromptBuilder, PromptInputs, SkillPromptEntry};
use crate::harness::agent::react_machine::{ReactPhase, ReActMachine, StepDecision};
use crate::harness::agent::state_store::{StateStore, StepKind, ToolCallStatus};
use crate::harness::error::{HarnessError, Result as HarnessResult};
use crate::harness::guardrails::GuardrailPipeline;
use crate::harness::tools::{ToolContext, ToolRegistry};
use crate::services::agent_service::ModelTier;
use crate::services::llm_service::{ChatMessage, ChatParams, StreamEvent};
use crate::state::AppState;

// 子模块
pub mod budget;
pub mod event_bridge;
pub mod prompt_builder;
pub mod react_machine;
pub mod state_store;

/// Agent 运行配置 (由 commands/agent.rs 构造)
#[derive(Debug, Clone)]
pub struct AgentRunConfig {
    pub agent_id: String,
    pub prompt: String,
    pub history: Option<Vec<ChatMessage>>,
    pub cancel: Option<CancellationToken>,
    pub budget: Option<Budget>,
}

/// Agent 运行汇总 (返回给前端 + 落 agent_runs 表)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunSummary {
    pub run_id: String,
    pub status: String,
    pub rounds: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd_micros: u64,
    pub final_text: String,
    pub error: Option<String>,
}

/// Agent Harness 主入口
pub struct AgentHarness<'a> {
    state: &'a AppState,
    registry: ToolRegistry,
    app: AppHandle,
}

impl<'a> AgentHarness<'a> {
    pub fn new(state: &'a AppState, registry: ToolRegistry, app: AppHandle) -> Self {
        Self {
            state,
            registry,
            app,
        }
    }

    /// 执行一次 agent run (手动或定时共用)
    ///
    /// 编排流程:
    /// ```text
    /// load agent config → build prompt → StateStore.start_run
    ///   → loop (max_rounds):
    ///       ReActMachine::Act: stream_chat → parse_step
    ///       → ToolCalls: ToolRegistry::dispatch + StateStore::record_tool_call
    ///       → FinalAnswer: 退出循环
    ///       → BudgetTracker::check
    ///   → StateStore::finish_run
    /// ```
    pub async fn run(
        &self,
        cfg: AgentRunConfig,
    ) -> HarnessResult<AgentRunSummary> {
        // === Step 1: 加载 agent 配置 ===
        let entry = {
            let agents = self.state.agents.read();
            agents
                .entry(&cfg.agent_id)
                .cloned()
                .ok_or_else(|| {
                    HarnessError::InvalidConfig(format!("agent {} 不存在", cfg.agent_id))
                })?
        };
        if !entry.enabled {
            return Err(HarnessError::InvalidConfig(format!(
                "agent {} 已禁用",
                cfg.agent_id
            )));
        }

        // === Step 2: 选择 provider/model + 取 api_key ===
        let (provider_id, model_id) = self.resolve_model(&entry.model_tier)?;
        let api_key = self
            .state
            .keystore
            .get(&provider_id)?
            .ok_or_else(|| HarnessError::Llm(format!("缺少 {provider_id} 的 API Key")))?;

        // === Step 3: 组装 system prompt ===
        let soul = {
            let agents = self.state.agents.read();
            agents.get_soul(&cfg.agent_id).unwrap_or_default()
        };
        let rules = {
            let agents = self.state.agents.read();
            agents.get_rules(&cfg.agent_id).unwrap_or_default()
        };
        let skills = {
            let skills = self.state.skills.read();
            skills
                .list()
                .iter()
                .map(|s| SkillPromptEntry {
                    name: s.name.clone(),
                    description: s.description.clone(),
                    enabled: s.enabled,
                })
                .collect::<Vec<_>>()
        };
        let tool_descs = self.registry.llm_descriptions();
        let capabilities: Vec<String> = entry.capabilities.clone();
        let system_prompt = PromptBuilder::build(&PromptInputs {
            soul: &soul,
            rules: &rules,
            capabilities: &capabilities,
            skills: &skills,
            tools: &tool_descs,
            agent_id: &cfg.agent_id,
        });

        // === Step 4: Agent 数据隔离 (阶段二 best-effort, 失败仅 warn) ===
        self.try_isolate(&cfg.agent_id).await;

        // === Step 5: 启动 StateStore run ===
        let db = self.state.db.clone();
        let store = StateStore::new(db);
        let run_id = store
            .start_run(&cfg.agent_id, &cfg.prompt)
            .await
            .map_err(|e| HarnessError::StateStore(e.to_string()))?;

        // === Step 6: 准备 messages (含历史) + 可选隐私脱敏 ===
        let privacy_enabled = *self.state.privacy_enabled.read();
        let mut messages = cfg.history.unwrap_or_default();
        messages.push(ChatMessage {
            role: "user".into(),
            content: cfg.prompt.clone(),
        });
        if privacy_enabled {
            let eng = self.state.privacy.read();
            for m in messages.iter_mut() {
                m.content = eng.anonymize(&m.content);
            }
        }

        // === Step 7: 注册 cancel token ===
        let cancel = cfg.cancel.unwrap_or_else(CancellationToken::new);
        let session_id = format!("agent_{run_id}");
        self.state
            .active_streams
            .lock()
            .await
            .insert(session_id.clone(), cancel.clone());

        // === Step 8: 准备 EventBridge + BudgetTracker ===
        let bridge = EventBridge::new(self.app.clone());
        bridge.emit(AgentStatusUpdate::Phase {
            run_id: run_id.clone(),
            agent_id: cfg.agent_id.clone(),
            phase: "init".into(),
        });
        let budget = cfg.budget.unwrap_or_else(Budget::soft);
        let mut tracker = BudgetTracker::new(budget);

        // === Step 9: ReAct 循环 ===
        let mut final_text = String::new();
        let mut summary_error: Option<String> = None;
        // GUARDRAIL: 构造守卫链 (input_filter + sandbox + hitl + output_filter)
        let pipeline = GuardrailPipeline::standard(
            self.state,
            self.app.clone(),
            Some(self.state.approval_channel.clone()),
        );
        let loop_result = self
            .react_loop(
                &run_id,
                &cfg.agent_id,
                &system_prompt,
                &provider_id,
                &model_id,
                &api_key,
                &mut messages,
                &tool_descs,
                &store,
                &bridge,
                &cancel,
                &mut tracker,
                &mut final_text,
                &pipeline,
            )
            .await;

        if let Err(e) = loop_result {
            summary_error = Some(e.to_string());
        }

        // === Step 10: 写终态 ===
        let snap = tracker.snapshot();
        let final_status = if summary_error.is_some() {
            "failure"
        } else {
            "success"
        };
        let _ = store
            .finish_run(final_status, Some(&final_text), summary_error.as_deref())
            .await;

        // === Step 11: 注销 active stream + emit Done ===
        self.state.active_streams.lock().await.remove(&session_id);
        bridge.emit(AgentStatusUpdate::Done {
            run_id: run_id.clone(),
            final_text: final_text.clone(),
            success: summary_error.is_none(),
            error: summary_error.clone(),
        });
        // 向后兼容旧事件 (前端 chatStore.handleAgentEvent 用)
        let _ = self.app.emit(
            "agent:status-update",
            json!({
                "agentId": cfg.agent_id,
                "status": if summary_error.is_none() { "idle" } else { "error" },
                "execId": run_id,
            }),
        );

        Ok(AgentRunSummary {
            run_id,
            status: final_status.into(),
            rounds: snap.rounds as u32,
            input_tokens: snap.input_tokens,
            output_tokens: snap.output_tokens,
            cost_usd_micros: snap.cost_usd_micros,
            final_text,
            error: summary_error,
        })
    }

    /// ReAct 主循环 — 显式 Plan → Act → Observe → Reflect
    async fn react_loop(
        &self,
        run_id: &str,
        agent_id: &str,
        system_prompt: &str,
        provider_id: &str,
        model_id: &str,
        api_key: &str,
        messages: &mut Vec<ChatMessage>,
        _tool_descs: &[crate::harness::tools::ToolDescription],
        store: &StateStore,
        bridge: &EventBridge,
        cancel: &CancellationToken,
        tracker: &mut BudgetTracker,
        final_text: &mut String,
        pipeline: &GuardrailPipeline,
    ) -> HarnessResult<()> {
        let mut phase = ReactPhase::Init;
        let llm = self.state.llm.clone();
        let caps: Arc<Vec<String>> = Arc::new({
            let agents = self.state.agents.read();
            agents
                .entry(agent_id)
                .map(|e| e.capabilities.clone())
                .unwrap_or_default()
        });
        let data_cache: Arc<crate::tools::data_cache::DataCache> =
            Arc::new(crate::tools::data_cache::DataCache::new());

        loop {
            tracker.check_wall_time()?;
            // 转换校验 (Init → Act)
            ReActMachine::validate_transition(phase, ReactPhase::Act)?;
            phase = ReactPhase::Act;
            bridge.emit(AgentStatusUpdate::Phase {
                run_id: run_id.into(),
                agent_id: agent_id.into(),
                phase: "act".into(),
            });

            tracker.on_round_started()?;

            // === GUARDRAIL: input — LLM 输入前过 InputFilter ===
            {
                let mut input_data = serde_json::json!({
                    "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>()
                });
                if let Err(e) = pipeline
                    .check_input(run_id, agent_id, &mut input_data)
                    .await
                {
                    tracing::warn!(target: "harness.guardrail", "input filter blocked: {e}");
                    return Err(e);
                }
            }

            // === Act: LLM 单步 ===
            let events = self.llm_step(
                &llm,
                provider_id,
                model_id,
                api_key,
                system_prompt,
                messages,
                cancel,
                bridge,
                run_id,
            )
            .await?;

            // 累加 usage (从 Done 事件取)
            if let Some(StreamEvent::Done { usage, cost }) = events.last() {
                let in_tok = usage.input_tokens;
                let out_tok = usage.output_tokens;
                let cost_micros = (cost * 1_000_000.0) as u64;
                tracker.on_usage(in_tok, out_tok, cost_micros)?;
                let _ = store.add_usage(in_tok as i64, out_tok as i64, cost_micros as i64).await;
            }

            // === 解析 decision ===
            let decision = ReActMachine::parse_step(&events);
            match decision {
                StepDecision::FinalAnswer(text) => {
                    ReActMachine::validate_transition(phase, ReactPhase::Done)?;
                    *final_text = text;
                    // 记录 FinalAnswer step
                    let _ = store
                        .record_step(StepKind::FinalAnswer, &json!({"text": final_text}))
                        .await;
                    bridge.emit(AgentStatusUpdate::Phase {
                        run_id: run_id.into(),
                        agent_id: agent_id.into(),
                        phase: "done".into(),
                    });
                    return Ok(());
                }
                StepDecision::ToolCalls(calls) => {
                    // 进入 Observe
                    ReActMachine::validate_transition(phase, ReactPhase::Observe)?;
                    phase = ReactPhase::Observe;

                    // 记录 Act step (含 tool_calls 列表)
                    let step_id = store
                        .record_step(
                            StepKind::Act,
                            &json!({"calls": calls.iter().map(|c| &c.name).collect::<Vec<_>>()}),
                        )
                        .await
                        .map_err(|e| HarnessError::StateStore(e.to_string()))?;

                    for call in &calls {
                        // capability 校验
                        let checked = match self.registry.get_checked(&call.name, &caps) {
                            Ok(c) => c,
                            Err(e) => {
                                let result_json = json!({"error": e.to_string()}).to_string();
                                let _ = store
                                    .record_tool_call(
                                        &step_id,
                                        &call.name,
                                        &call.args,
                                        ToolCallStatus::Rejected,
                                        None,
                                        chrono::Utc::now().timestamp_millis(),
                                        Some(chrono::Utc::now().timestamp_millis()),
                                        Some(&json!({"error": e.to_string()})),
                                    )
                                    .await;
                                // 把错误结果回喂给 LLM
                                messages.push(ReActMachine::build_tool_result_message(
                                    &call.id,
                                    &result_json,
                                ));
                                continue;
                            }
                        };

                        // === GUARDRAIL: tool_call — args 过 Sandbox + HITL ===
                        // 准备 args 副本 (HITL Edit 可能改写)
                        let mut tool_args = call.args.clone();
                        // 构造 is_write/risk 元信息供守卫使用
                        let is_write_flag = checked.is_write();
                        let risk_str = match crate::harness::guardrails::RiskLevel::from_tool_name(&call.name) {
                            crate::harness::guardrails::RiskLevel::Destructive => "destructive",
                            crate::harness::guardrails::RiskLevel::High => "high",
                            crate::harness::guardrails::RiskLevel::Medium => "medium",
                            crate::harness::guardrails::RiskLevel::Low => "low",
                        };
                        if let Err(e) = pipeline
                            .check_tool_call_with_meta(
                                run_id,
                                agent_id,
                                &call.name,
                                &mut tool_args,
                                is_write_flag,
                                risk_str,
                            )
                            .await
                        {
                            tracing::warn!(target: "harness.guardrail", "tool_call blocked for {}: {e}", call.name);
                            // 拒绝: 记录 Rejected tool_call + 回喂 LLM
                            let result_json = json!({"error": e.to_string()}).to_string();
                            let _ = store
                                .record_tool_call(
                                    &step_id,
                                    &call.name,
                                    &call.args,
                                    ToolCallStatus::Rejected,
                                    None,
                                    chrono::Utc::now().timestamp_millis(),
                                    Some(chrono::Utc::now().timestamp_millis()),
                                    Some(&json!({"guardrail": e.to_string()})),
                                )
                                .await;
                            messages.push(ReActMachine::build_tool_result_message(
                                &call.id,
                                &result_json,
                            ));
                            continue;
                        }

                        // 阶段三会插 Guardrails HITL; 阶段二先放行 (auto-approve)
                        let now = chrono::Utc::now().timestamp_millis();
                        let tool_ctx = ToolContext {
                            run_id: run_id.to_string(),
                            agent_id: agent_id.to_string(),
                            capabilities: caps.clone(),
                            data_cache: Some(data_cache.clone()),
                        };
                        let call_id_for_record = store
                            .record_tool_call(
                                &step_id,
                                &call.name,
                                &tool_args,
                                ToolCallStatus::Approved,
                                Some("auto"),
                                now,
                                None,
                                None,
                            )
                            .await
                            .map_err(|e| HarnessError::StateStore(e.to_string()))?;

                        // 真正执行 (用可能改写过的 tool_args)
                        // 先取 schema (checked 在 .call() 后被 move)
                        let tool_schema = checked.input_schema();
                        let tool_result = checked.call(tool_args.clone(), &tool_ctx).await;
                        // === GUARDRAIL: tool_result — 值过 OutputFilter (schema/deanonymize/truncate) ===
                        let (status, result_json) = match tool_result {
                            Ok(v) => {
                                let mut v_mut = v.clone();
                                if let Err(e) = pipeline
                                    .check_tool_result_with_meta(
                                        run_id,
                                        agent_id,
                                        &call.name,
                                        &mut v_mut,
                                        is_write_flag,
                                        &tool_schema,
                                    )
                                    .await
                                {
                                    tracing::warn!(target: "harness.guardrail", "tool_result blocked for {}: {e}", call.name);
                                    (ToolCallStatus::Failed, json!({"error": e.to_string()}).to_string())
                                } else {
                                    (
                                        ToolCallStatus::Executed,
                                        serde_json::to_string(&v_mut).unwrap_or_else(|_| v.to_string()),
                                    )
                                }
                            }
                            Err(e) => (
                                ToolCallStatus::Failed,
                                json!({"error": e.to_string()}).to_string(),
                            ),
                        };
                        let finished_at = chrono::Utc::now().timestamp_millis();
                        // 更新 tool_call 的 result (写新一行覆盖 Pending → Executed)
                        // 简化: 不做 update, finish 时通过 final_text 携带
                        let _ = (call_id_for_record, status, finished_at);

                        // 记录 Observe step
                        let _ = store
                            .record_step(
                                StepKind::Observe,
                                &json!({"tool": call.name, "result": result_json}),
                            )
                            .await;

                        bridge.emit(AgentStatusUpdate::ToolResult {
                            run_id: run_id.into(),
                            call_id: call.id.clone(),
                            ok: status == ToolCallStatus::Executed,
                            result: serde_json::from_str(&result_json).unwrap_or_default(),
                        });

                        // 回喂给 LLM
                        messages.push(ReActMachine::build_tool_result_message(
                            &call.id,
                            &result_json,
                        ));
                    }

                    // Observe → Act (下一轮)
                    ReActMachine::validate_transition(phase, ReactPhase::Act)?;
                    phase = ReactPhase::Act;
                }
                StepDecision::Continue => {
                    // 流未结束 (不应该发生 — stream_chat 等到 Done 才返回)
                    return Err(HarnessError::Llm("LLM 流未结束".into()));
                }
            }
        }
    }

    /// 单步 LLM 调用 + 收集 events
    async fn llm_step(
        &self,
        llm: &Arc<crate::services::llm_service::LlmService>,
        provider_id: &str,
        model_id: &str,
        api_key: &str,
        system_prompt: &str,
        messages: &[ChatMessage],
        cancel: &CancellationToken,
        bridge: &EventBridge,
        run_id: &str,
    ) -> HarnessResult<Vec<StreamEvent>> {
        let params = ChatParams {
            provider_id: provider_id.to_string(),
            model_id: model_id.to_string(),
            messages: messages.to_vec(),
            system_prompt: Some(system_prompt.to_string()),
            thinking: None,
            max_tokens: None,
        };
        let events = std::sync::Arc::new(std::sync::Mutex::new(Vec::<StreamEvent>::new()));
        let events_c = events.clone();
        let bridge_c = bridge.clone();
        let run_id_c = run_id.to_string();
        let on_event = move |ev: StreamEvent| {
            // 文本增量透传给前端 (旧事件协议)
            if let StreamEvent::TextDelta { delta } = &ev {
                bridge_c.emit(AgentStatusUpdate::Text {
                    run_id: run_id_c.clone(),
                    delta: delta.clone(),
                });
            }
            events_c.lock().unwrap().push(ev);
        };
        llm.stream_chat(&params, api_key, None, on_event, cancel.clone())
            .await
            .map_err(|e| HarnessError::Llm(e.to_string()))?;
        let taken = events.lock().unwrap().drain(..).collect::<Vec<_>>();
        Ok(taken)
    }

    /// 解析模型 tier → (provider_id, model_id)
    fn resolve_model(&self, tier: &ModelTier) -> HarnessResult<(String, String)> {
        let settings = self.state.settings.read();
        let provider_id = settings
            .get_path("models.defaultProvider")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let key = match tier {
            ModelTier::HighQuality => "models.highQualityModel",
            ModelTier::LowCost => "models.lowCostModel",
        };
        let model_id = settings
            .get_path(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if provider_id.is_empty() || model_id.is_empty() {
            return Err(HarnessError::InvalidConfig(
                "未配置默认 provider/model".into(),
            ));
        }
        Ok((provider_id, model_id))
    }

    /// Agent 数据隔离 (best-effort)
    async fn try_isolate(&self, agent_id: &str) {
        let eaa_data = self.state.paths.eaa_data.clone();
        let id = agent_id.to_string();
        let result = tokio::task::spawn_blocking(move || {
            let isolator = agent_isolation::AgentIsolator::new(eaa_data.join("agents")).ok()?;
            isolator.register_agent(&id).ok()
        })
        .await
        .ok()
        .flatten();
        if result.is_none() {
            tracing::warn!(target: "harness.isolation", "agent {agent_id} 数据隔离目录注册失败");
        }
    }
}

// === helper: Result<T, AppError> 转 HarnessError (用于边界 ? 传播) ===
impl From<AppError> for HarnessError {
    fn from(e: AppError) -> Self {
        HarnessError::Llm(e.to_string())
    }
}

// 注: 旧的 `state.active_streams.lock().await.insert(...)` 用 tokio Mutex, 这里用 .await
// 不会阻塞 sync context (因为本函数整体是 async fn)
#[allow(dead_code)]
fn _ensure_async_fn_used(_: tokio::sync::MutexGuard<'_, ()>) {}

// 把 TokenUsage 的 optional 字段硬转 u64 的小工具 (避免警告)
#[allow(dead_code)]
fn _u64_opt(o: &u64) -> u64 {
    *o
}

// Re-export
pub use budget::{Budget as AgentBudget, BudgetSnapshot};
pub use prompt_builder::{PromptBuilder as AgentPromptBuilder, PromptInputs as AgentPromptInputs};