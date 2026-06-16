//! EventBridge — 把 agent 内部的 step / tool_call / budget 事件 emit 给前端
//!
//! 阶段二职责: 薄封装, 用 tauri::Emitter 暴露 `agent:status-update` 事件。
//! 阶段五会加更多事件类型 (approval-required, approval-resolved, memory-recall)。

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::harness::agent::budget::BudgetSnapshot;

/// 事件名常量 (前端订阅时用)
pub const EV_AGENT_STATUS: &str = "agent:status-update";
pub const EV_AGENT_STEP: &str = "agent:step";
pub const EV_AGENT_TOOL_CALL: &str = "agent:tool-call";
pub const EV_AGENT_BUDGET: &str = "agent:budget";
pub const EV_AGENT_DONE: &str = "agent:done";

/// 统一的 status-update payload (前端 `chatStore.handleStreamEvent` 同形态)
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum AgentStatusUpdate {
    Phase {
        run_id: String,
        agent_id: String,
        phase: String,
    },
    Step {
        run_id: String,
        seq: u64,
        step_kind: String,
    },
    ToolCall {
        run_id: String,
        step_seq: u64,
        call_id: String,
        tool: String,
        status: String,
        approved_by: Option<String>,
    },
    ToolResult {
        run_id: String,
        call_id: String,
        ok: bool,
        result: Value,
    },
    Budget {
        run_id: String,
        snapshot: BudgetSnapshot,
    },
    Text {
        run_id: String,
        delta: String,
    },
    Done {
        run_id: String,
        final_text: String,
        success: bool,
        error: Option<String>,
    },
}

#[derive(Clone)]
pub struct EventBridge {
    app: AppHandle,
}

impl EventBridge {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    pub fn emit(&self, payload: AgentStatusUpdate) {
        if let Err(e) = self.app.emit(EV_AGENT_STATUS, &payload) {
            tracing::warn!(target: "harness.event_bridge", "emit failed: {e}");
        }
    }

    pub fn emit_raw<T: Serialize + Clone>(&self, event: &str, payload: T) {
        if let Err(e) = self.app.emit(event, &payload) {
            tracing::warn!(target: "harness.event_bridge", "emit_raw({event}) failed: {e}");
        }
    }
}