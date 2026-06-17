//! Agent commands — Agent 运行时 IPC (13 个通道, `agent:*`)。
//! run_manual 是核心: 组装 prompt → LLM 流式 → 工具调用循环 → 持久化执行历史。

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::error::Result;
use crate::harness::agent::prompt_builder::AppContext;
use crate::harness::guardrails::ApprovalDecision;
use crate::services::agent_service::AgentDetail;
use crate::services::llm_service::ChatMessage;
use crate::services::memory_service::{CreateMemoryRequest, MemoryKind};
use crate::state::AppState;

#[tauri::command]
pub async fn agent_list(state: State<'_, AppState>) -> Result<Value> {
    Ok(json!(state.agents.read().list()))
}

#[tauri::command]
pub async fn agent_get(state: State<'_, AppState>, id: String) -> Result<Option<AgentDetail>> {
    Ok(state.agents.read().get(&id))
}

#[tauri::command]
pub async fn agent_toggle(state: State<'_, AppState>, id: String, enabled: bool) -> Result<Value> {
    state.agents.write().toggle(&id, enabled)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn agent_update(state: State<'_, AppState>, id: String, patch: Value) -> Result<Value> {
    state.agents.write().update(&id, &patch)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn agent_get_soul(state: State<'_, AppState>, id: String) -> Result<String> {
    state.agents.read().get_soul(&id)
}

#[tauri::command]
pub async fn agent_set_soul(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<Value> {
    state.agents.read().set_soul(&id, &content)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn agent_get_rules(state: State<'_, AppState>, id: String) -> Result<String> {
    state.agents.read().get_rules(&id)
}

#[tauri::command]
pub async fn agent_set_rules(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<Value> {
    state.agents.read().set_rules(&id, &content)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn agent_get_history(state: State<'_, AppState>, id: String) -> Result<Value> {
    let rows = state
        .db
        .lock()
        .await
        .get_execution_history(&id, 100)
        .await?;
    Ok(json!(rows))
}

#[derive(serde::Deserialize)]
pub struct GetAllExecutionsOpts {
    pub status: Option<String>,
    pub agent_id: Option<String>,
    pub since_ms: Option<i64>,
    pub limit: Option<i64>,
}

#[tauri::command]
pub async fn agent_get_all_executions(
    state: State<'_, AppState>,
    opts: Option<GetAllExecutionsOpts>,
) -> Result<Value> {
    let opts = opts.unwrap_or(GetAllExecutionsOpts {
        status: None,
        agent_id: None,
        since_ms: None,
        limit: None,
    });
    let limit = opts.limit.unwrap_or(200);
    let rows = state
        .db
        .lock()
        .await
        .get_all_executions(
            opts.status.as_deref(),
            opts.agent_id.as_deref(),
            opts.since_ms,
            limit,
        )
        .await?;
    let total_runs = rows.len() as u64;
    let success = rows.iter().filter(|r| r.status == "success").count() as u64;
    let error = rows.iter().filter(|r| r.status == "failure").count() as u64;
    let timeout = rows.iter().filter(|r| r.status == "aborted").count() as u64;
    let total_cost: f64 = rows.iter().filter_map(|r| r.cost_total).sum();
    let total_tokens: i64 = rows
        .iter()
        .map(|r| r.tokens_input.unwrap_or(0) + r.tokens_output.unwrap_or(0))
        .sum();

    let name_map: serde_json::Map<String, Value> = {
        let agents = state.agents.read();
        agents
            .list()
            .iter()
            .map(|a| (a.id.clone(), Value::String(a.name.clone())))
            .collect()
    };
    Ok(json!({
        "executions": rows,
        "stats": {
            "totalRuns": total_runs,
            "successCount": success,
            "errorCount": error,
            "timeoutCount": timeout,
            "successRate": if total_runs > 0 { success as f64 / total_runs as f64 } else { 0.0 },
            "totalCost": total_cost,
            "totalTokens": total_tokens,
        },
        "agentNameMap": name_map,
    }))
}

#[tauri::command]
pub async fn agent_abort(state: State<'_, AppState>, id: String) -> Result<Value> {
    let mut streams = state.active_streams.lock().await;
    if let Some(token) = streams.remove(&id) {
        token.cancel();
        Ok(json!({ "success": true }))
    } else {
        Ok(json!({ "success": false, "error": "无进行中的流" }))
    }
}

/// agent:run-manual — 手动运行一次 agent。
/// 核心逻辑提取到 services/agent_runner::run, 手动触发/定时任务共用同一执行路径
/// (组装 prompt → LLM 流式 → 工具调用循环 → 持久化 → 广播)。
#[tauri::command]
pub async fn agent_run_manual(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    prompt: String,
    history: Option<Vec<ChatMessage>>,
    app_context: Option<AppContext>,
) -> Result<Value> {
    let cfg = crate::harness::agent::AgentRunConfig {
        agent_id: id,
        prompt,
        history,
        cancel: None,
        budget: None,
        app_context,
        trace_collector: None,
    };
    let session_id = crate::services::agent_runner::run_with_config(&app, &state, cfg).await?;
    Ok(json!({ "success": true, "id": session_id }))
}

/// 前端发回的审批决议 (HITL 闭环)
/// `decision` 是 `ApprovalDecision` 的 JSON 表示:
///   {"type": "approve", "by": "user_id"}
///   {"type": "reject", "by": "user_id", "reason": "..."}
///   {"type": "edit", "by": "user_id", "newArgs": {...}}
#[tauri::command]
pub async fn agent_approval_resolve(
    state: State<'_, AppState>,
    request_id: String,
    decision: Value,
) -> Result<Value> {
    let parsed = ApprovalDecision::from_json(decision)
        .map_err(|e| crate::error::AppError::Other(format!("invalid decision: {e}")))?;
    state
        .approval_channel
        .resolve(&request_id, parsed)
        .map_err(|e| crate::error::AppError::Other(format!("resolve failed: {e}")))?;
    Ok(json!({ "success": true, "request_id": request_id }))
}

/// 列出当前挂起的审批请求 (调试 / 仪表盘)
#[tauri::command]
pub async fn agent_approval_pending_count(state: State<'_, AppState>) -> Result<Value> {
    Ok(json!({ "pending": state.approval_channel.pending_count() }))
}

/// agent:memory-list — 列出某 agent 的跨会话记忆
#[tauri::command]
pub async fn agent_memory_list(
    state: State<'_, AppState>,
    agent_id: String,
    limit: Option<usize>,
) -> Result<Value> {
    let memories = state
        .memory
        .list_for_agent(&agent_id, limit.unwrap_or(20))
        .await?;
    Ok(json!({ "success": true, "memories": memories }))
}

/// agent:memory-create — 手动创建一条记忆（也可由 AgentHarness 自动写入）
#[tauri::command]
pub async fn agent_memory_create(
    state: State<'_, AppState>,
    agent_id: String,
    kind: String,
    content_json: String,
    source_run_id: Option<String>,
) -> Result<Value> {
    let kind = match kind.as_str() {
        "fact" => MemoryKind::Fact,
        "preference" => MemoryKind::Preference,
        "summary" => MemoryKind::Summary,
        _ => MemoryKind::Fact,
    };
    let req = CreateMemoryRequest {
        agent_id,
        kind,
        content_json,
        source_run_id,
    };
    let id = state.memory.create(&req).await?;
    Ok(json!({ "success": true, "id": id }))
}

/// agent:memory-delete — 删除一条记忆
#[tauri::command]
pub async fn agent_memory_delete(state: State<'_, AppState>, id: String) -> Result<Value> {
    state.memory.delete(&id).await?;
    Ok(json!({ "success": true }))
}
