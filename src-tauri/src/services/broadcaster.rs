//! 广播器 — Rust 重写自 `src/main/services/broadcaster.ts`。
//!
//! 把 main → renderer 的事件广播封装一层。在 Tauri 里就是 `AppHandle::emit`,
//! 但保留封装层便于: (1) 统一事件名常量; (2) 加日志; (3) 多窗口支持。
//!
//! 事件名沿用原 Electron 通道字符串 (含冒号), 与 `src/shared/ipc-channels.ts` 一致,
//! 这样前端 listen() 时不用改字符串。

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::Result;

/// 向所有窗口广播事件 (webview + 内部监听器都能收到)。
pub fn emit_all<T: Serialize + Clone>(app: &AppHandle, channel: &str, payload: T) -> Result<()> {
    tracing::debug!(target: "broadcaster", "emit {channel}");
    app.emit(channel, payload).map_err(crate::error::other)?;
    Ok(())
}

/// 仅向指定 label 的窗口发事件。
pub fn emit_to<T: Serialize + Clone>(
    app: &AppHandle,
    label: &str,
    channel: &str,
    payload: T,
) -> Result<()> {
    app.emit_to(label, channel, payload)
        .map_err(crate::error::other)?;
    Ok(())
}

/// 拿到主窗口 (label = "main"), 用于定向发送。
pub fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}
