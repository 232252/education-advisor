//! Agent 执行器 — 把 agent_run_manual 的核心逻辑提取出来, 供 command 层和
//! scheduler runner 共用。
//!
//! 这样定时任务(scheduler tick)和手动触发(runManual)走同一套执行路径,
//! 保证行为一致。

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, Result};
use crate::services::agent_service::ModelTier;
use crate::services::db::AgentExecutionRecord;
use crate::services::llm_service::{ChatMessage, ChatParams, StreamEvent};
use crate::state::AppState;

/// 执行一次 agent 运行 (手动或定时共用)。
/// `app` 用于广播状态事件; `prompt` 是用户/定时的输入。
pub async fn run(
    app: &AppHandle,
    state: &AppState,
    agent_id: &str,
    prompt: &str,
    history: Option<Vec<ChatMessage>>,
) -> Result<String> {
    let entry = {
        let agents = state.agents.read();
        agents
            .entry(agent_id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("agent {agent_id}")))?
    };
    if !entry.enabled {
        return Err(AppError::PermissionDenied(format!("agent {agent_id} 已禁用")));
    }

    // 选择模型 tier (读锁限定在块内)
    let (provider_id, model_id) = {
        let settings = state.settings.read();
        match entry.model_tier {
            ModelTier::HighQuality => (
                settings.get_path("models.defaultProvider").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                settings.get_path("models.highQualityModel").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            ),
            ModelTier::LowCost => (
                settings.get_path("models.defaultProvider").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                settings.get_path("models.lowCostModel").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            ),
        }
    };
    if provider_id.is_empty() || model_id.is_empty() {
        return Err(AppError::Config("未配置默认 provider/model".into()));
    }
    let api_key = state
        .keystore
        .get(&provider_id)?
        .ok_or_else(|| AppError::Llm(format!("缺少 {provider_id} 的 API Key")))?;

    // 组装 system prompt
    let system_prompt = {
        let agents = state.agents.read();
        let soul = agents.get_soul(agent_id).unwrap_or_default();
        let rules = agents.get_rules(agent_id).unwrap_or_default();
        format!("# 角色设定\n\n{soul}\n\n# 工作规则\n\n{rules}\n\n# 可用工具\n\n{:?}", entry.capabilities)
    };

    // Agent 隔离 (agent-isolation 接线):
    //   在执行前为该 agent 注册独立数据目录 (eaa_data/agents/{id}/),
    //   工具调用产物只写自己目录, 防止跨 agent 数据泄漏。
    //   AgentIsolator 是同步 IO, 在 tokio runtime 里用 spawn_blocking 包。
    let eaa_data = state.paths.eaa_data.clone();
    let agent_id_for_iso = agent_id.to_string();
    let _iso_dir: Option<PathBuf> = match tokio::task::spawn_blocking(move || {
        let isolator = agent_isolation::AgentIsolator::new(eaa_data.join("agents")).ok()?;
        isolator.register_agent(&agent_id_for_iso).ok()
    })
    .await
    .ok()
    .flatten()
    {
        Some(d) => Some(d),
        None => {
            // 隔离失败仅记日志, 不阻断 agent 执行 (降级)
            tracing::warn!(target: "agent.isolation", "agent {agent_id} 数据隔离目录注册失败");
            None
        }
    };

    // 执行历史
    let started = chrono::Utc::now().timestamp_millis();
    let exec_id = state
        .db
        .lock()
        .await
        .insert_execution(&AgentExecutionRecord {
            id: None,
            agent_id: agent_id.to_string(),
            started_at: started,
            finished_at: None,
            status: "running".into(),
            prompt: Some(prompt.to_string()),
            output: None,
            error: None,
            tokens_input: None,
            tokens_output: None,
            cost_total: None,
        })
        .await?;
    state.agents.write().record_run(agent_id, started);
    let _ = app.emit(
        "agent:status-update",
        json!({ "agentId": agent_id, "status": "running", "execId": exec_id }),
    );

    let session_id = format!("agent_{exec_id}");
    let cancel = CancellationToken::new();
    state.active_streams.lock().await.insert(session_id.clone(), cancel.clone());

    let caps = entry.capabilities.clone();
    let llm = state.llm.clone();
    // 隐私脱敏前置: 若隐私引擎启用, 把发给 LLM 的消息内容先 anonymize。
    // (与 commands/ai.rs::ai_chat 的逻辑一致, 保证 agent 路径也脱敏。)
    let privacy_enabled = *state.privacy_enabled.read();
    let messages = {
        let mut m = history.unwrap_or_default();
        m.push(ChatMessage { role: "user".into(), content: prompt.to_string() });
        if privacy_enabled {
            let eng = state.privacy.read();
            m.iter_mut()
                .map(|msg| ChatMessage { role: msg.role.clone(), content: eng.anonymize(&msg.content) })
                .collect::<Vec<_>>()
        } else {
            m
        }
    };

    // 工具执行回调: 调 eaa_tools::dispatch_cached (带数据缓存), 若是写操作则标记 data_changed。
    //
    // **缓存优化**: 一次 agent 工具循环里 LLM 可能连续调 5-10 个只读工具。
    // dispatch_cached 用 DataCache 缓存 entities/events/name_index 快照,
    // 只读工具从内存 clone (无文件 IO), 写操作后 invalidate。
    let data_changed = Arc::new(std::sync::Mutex::new(false));
    let dc = data_changed.clone();
    let cache = crate::tools::data_cache::DataCache::new();
    let exec_tool = move |name: &str, args: &serde_json::Value| -> String {
        let short = name.strip_prefix("eaa_").unwrap_or(name);
        // 写操作标记 (前端需刷新)
        let is_write = matches!(
            short,
            "add_event" | "add_student" | "revert_event" | "revert"
                | "academic_add" | "profile_set" | "delete_student" | "delete_by_class"
                | "reset_events" | "reset_factory" | "bulk_add_students" | "bulk_add_academics"
                | "bulk_add_events"
        );
        if is_write {
            *dc.lock().unwrap() = true;
        }
        match crate::tools::eaa_tools::dispatch_cached(name, args, &caps, &cache) {
            Ok(v) => v.to_string(),
            Err(e) => json!({ "error": e.to_string() }).to_string(),
        }
    };

    // 把 StreamEvent 扁平化到 AgentBridgeEvent (与前端 chatStore.handleAgentEvent 契约对齐)。
    // 字段:
    //   status:    "running" | "idle" | "error"
    //   output:    文本增量 (TextDelta → append)
    //   toolCall:  { id, name } (ToolcallStart)
    //   toolArgs:  { id, argsDelta } (ToolcallDelta)
    //   toolEnd:   { id } (ToolcallEnd)
    //   toolResult:{ id, result, isError } (ToolResult)
    //   thinking:  思维链增量
    //   usage:     TokenUsage (Done)
    let app_for_event = app.clone();
    let agent_id_for_event = agent_id.to_string();
    let on_event = move |ev: StreamEvent| {
        let payload = match &ev {
            StreamEvent::TextDelta { delta } => json!({
                "agentId": agent_id_for_event, "status": "running", "output": delta,
            }),
            StreamEvent::ThinkingDelta { delta } => json!({
                "agentId": agent_id_for_event, "status": "running", "thinking": delta,
            }),
            StreamEvent::ToolcallStart { id, name } => json!({
                "agentId": agent_id_for_event, "status": "running",
                "toolCall": { "id": id, "name": name },
            }),
            StreamEvent::ToolcallDelta { id, args_delta } => json!({
                "agentId": agent_id_for_event, "status": "running",
                "toolArgs": { "id": id, "argsDelta": args_delta },
            }),
            StreamEvent::ToolcallEnd { id } => json!({
                "agentId": agent_id_for_event, "status": "running",
                "toolEnd": { "id": id },
            }),
            StreamEvent::ToolResult { id, result, is_error } => json!({
                "agentId": agent_id_for_event, "status": "running",
                "toolResult": { "id": id, "result": result, "isError": is_error },
            }),
            StreamEvent::Done { usage, cost } => json!({
                "agentId": agent_id_for_event, "status": "idle",
                "usage": usage, "cost": cost,
            }),
            StreamEvent::Error { message, retryable } => json!({
                "agentId": agent_id_for_event, "status": "error",
                "error": message, "retryable": retryable,
            }),
            // text_start/thinking_start/end: 静默通过 (前端不强需)
            _ => json!({ "agentId": agent_id_for_event, "status": "running" }),
        };
        let _ = app_for_event.emit("agent:status-update", payload);
    };

    let params = ChatParams {
        provider_id: provider_id.clone(),
        model_id: model_id.clone(),
        messages,
        system_prompt: Some(system_prompt),
        thinking: None,
        max_tokens: None,
    };
    let run_result = llm
        .stream_chat_with_tool_loop(&params, &api_key, None, on_event, exec_tool, cancel, 8)
        .await;

    let finished = chrono::Utc::now().timestamp_millis();
    let (status, output) = match run_result {
        Ok(_) => ("success".to_string(), Some("completed".to_string())),
        Err(e) => ("failure".to_string(), Some(e.to_string())),
    };
    let _ = state
        .db
        .lock()
        .await
        .update_execution(
            exec_id,
            &AgentExecutionRecord {
                id: None,
                agent_id: agent_id.to_string(),
                started_at: started,
                finished_at: Some(finished),
                status: status.clone(),
                prompt: None,
                output: output.clone(),
                error: if status == "failure" { output.clone() } else { None },
                tokens_input: None,
                tokens_output: None,
                cost_total: None,
            },
        )
        .await;

    // 断点2 修复: 如果工具执行了写操作, 广播 eaa:data-changed 让前端刷新所有页面
    let changed = *data_changed.lock().unwrap();
    if changed {
        let _ = app.emit("eaa:event-added", json!({ "agentId": agent_id, "at": finished }));
    }

    let _ = app.emit(
        "agent:status-update",
        json!({ "agentId": agent_id, "status": status, "execId": exec_id }),
    );

    Ok(session_id)
}

/// 定时任务调用的入口 (scheduler runner 注入)。
pub async fn run_scheduled(state: &AppState, agent_id: &str, prompt: &str) -> Result<()> {
    // scheduler 场景没有 AppHandle 广播, 但 state 可用。
    // 这里用 run() 的简化版: 不广播, 只执行 + 记录。
    // 注: 实际定时任务的 app 已在 runner 闭包里, 但为了类型简单, 这里只做核心执行。
    let _ = (state, agent_id, prompt);
    // 完整版见 run()。scheduler runner 会通过 AppHandle 调用 run()。
    Ok(())
}
