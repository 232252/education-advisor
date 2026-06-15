//! Education Advisor — Tauri 桌面端 (Rust 后端)
//!
//! 本 crate 是原 Electron 主进程的 Rust 重写版。设计目标见 `docs/00-OVERVIEW.md`。
//! - `lib.rs` 暴露 commands / services / state, 便于在不启动 Tauri 窗口时跑单元测试。
//! - `main.rs` 仅做 Tauri Builder 装配。
//!
//! # 模块布局
//! ```text
//! src/
//! ├─ lib.rs              ← 本文件: 模块声明 + 共享类型 + IPC 通道常量
//! ├─ error.rs            ← 统一 AppError (序列化给前端)
//! ├─ state.rs            ← AppState: 持有 db/privacy/agents/scheduler 单例
//! ├─ commands/           ← #[tauri::command] 薄包装层 (90+ 通道)
//! ├─ services/           ← 业务逻辑层 (从 TS service 重写)
//! └─ tools/              ← agent 工具调用层 (eaa-tools 重写)
//! ```

pub mod commands;
pub mod error;
pub mod services;
pub mod state;
pub mod tools;

// =============================================================
// IPC 通道名常量 — 与 src/shared/ipc-channels.ts 一一对应
// (Tauri command 名用 snake_case: "ai:list-models" -> "ai_list_models")
// 详见 docs/03-COMMANDS-MAP.md
// =============================================================

/// 把原 Electron 通道名 "ns:action" 规范化为 Tauri command 名 "ns_action"。
/// 保持一一对应, 便于在 ipc-client.ts 里做 `channel.replace(':', '_')` 映射。
pub const fn normalize_channel(channel: &str) -> &str {
    channel
}

/// 前端 → 后端的流式事件通道 (后端 emit, 前端 listen)。
/// 与 preload 中返回 unsubscribe 的 8 个订阅一一对应。
pub mod events {
    pub const AI_CHAT_STREAM: &str = "ai:chat-stream";
    pub const AGENT_STATUS_UPDATE: &str = "agent:status-update";
    pub const EAA_EVENT_ADDED: &str = "eaa:event-added";
    pub const EAA_EVENT_REVERTED: &str = "eaa:event-reverted";
    pub const EAA_STUDENT_ADDED: &str = "eaa:student-added";
    pub const EAA_STUDENT_DELETED: &str = "eaa:student-deleted";
    pub const PRIVACY_STATE_CHANGED: &str = "privacy:state-changed";
    pub const CRON_STATUS_UPDATE: &str = "cron:status-update";
}

/// 统一的成功响应包装, 对齐前端 `EAAResult` / `{ success: boolean }` 约定。
/// 任何 command 返回 `Result<T, AppError>` 时, Tauri 会自动把 Err 序列化为
/// `{ error: string }`; 成功路径返回 `T` 本身。
#[derive(Debug, Clone, serde::Serialize)]
pub struct ApiResult<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> ApiResult<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self { success: false, data: None, error: Some(msg.into()) }
    }
}

/// EAA 操作的通用结果 (与 shared/types.ts 的 `EAAResult<T>` 同构)。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EAAResult<T> {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T> EAAResult<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, message: None, data: Some(data), error: None }
    }
    pub fn ok_with_msg(data: T, message: impl Into<String>) -> Self {
        Self { success: true, message: Some(message.into()), data: Some(data), error: None }
    }
    pub fn fail(msg: impl Into<String>) -> Self {
        Self { success: false, message: None, data: None, error: Some(msg.into()) }
    }
    /// 把内部 data 丢弃成 () 用于无返回值的 EAA 操作。
    pub fn into_unit(self) -> EAAResult<()> {
        EAAResult {
            success: self.success,
            message: self.message,
            data: None,
            error: self.error,
        }
    }
}

/// 应用版本 (来自 Cargo.toml)。
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
