//! Windows 焦点修复
//!
//! 问题背景：在 Windows WebView2 环境下，启动后或窗口失焦再聚焦时，
//! 键盘/鼠标事件有时会被 WebView2 的父 HWND 吞掉，导致前端按钮、输入框
//! 看起来“没有任何按键出现”（实际是无法交互）。
//!
//! 修复策略：
//! 1. 启动后显式把焦点设到 WebView 窗口（initial_focus）。
//! 2. 监听窗口 focus/blur 事件，失焦后重新聚焦时再次 set_focus（refocus_guard）。
//! 3. 提供一个 Tauri command `force_refocus`，供前端 mousedown/click 兜底调用。
//!
//! 实现优先使用 Tauri 2.0 跨平台 API (`set_focus`)，它在 Windows 内部会调用
//! `SetForegroundWindow`/`SetFocus`。如果后续仍有 DWM 焦点链问题，可再引入
//! `windows` crate 直接操作 HWND。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Listener, Manager, WebviewWindow};

const WINDOW_LABEL: &str = "main";

/// 启动后首次聚焦。
///
/// 调用时机：Tauri setup 钩子中，窗口创建完成后立即调用。
pub fn initial_focus(window: &WebviewWindow) {
    if let Err(e) = window.set_focus() {
        tracing::warn!(target: "windows_focus", "initial_focus set_focus failed: {e}");
    }
    // 额外确保窗口可见；部分场景下不可见窗口 set_focus 无效。
    let _ = window.show();
    tracing::info!(target: "windows_focus", "initial_focus applied");
}

/// 安装失焦后的自动重聚焦守护。
///
/// 监听 `tauri://focus/{label}` / `tauri://blur/{label}`（Tauri 2.x 窗口事件），
/// 当窗口从 blur 回到 focus 时，再次调用 set_focus，确保 WebView2 重获键盘焦点。
pub fn install_refocus_guard(window: &WebviewWindow) {
    let handle: AppHandle = window.app_handle().clone();
    let blurred = Arc::new(AtomicBool::new(false));

    let focus_channel = format!("tauri://focus/{WINDOW_LABEL}");
    let blur_channel = format!("tauri://blur/{WINDOW_LABEL}");

    let blurred_for_focus = blurred.clone();
    let window_for_focus = handle.get_webview_window(WINDOW_LABEL);
    let _ = handle.listen(focus_channel, move |_event| {
        if blurred_for_focus.swap(false, Ordering::SeqCst) {
            if let Some(w) = window_for_focus.as_ref() {
                if let Err(e) = w.set_focus() {
                    tracing::warn!(target: "windows_focus", "refocus set_focus failed: {e}");
                }
            }
        }
    });

    let blurred_for_blur = blurred.clone();
    let _ = handle.listen(blur_channel, move |_event| {
        blurred_for_blur.store(true, Ordering::SeqCst);
        tracing::debug!(target: "windows_focus", "window blurred");
    });

    tracing::info!(target: "windows_focus", "refocus guard installed");
}

/// 兜底 command：前端在 mousedown 时调用，强制把焦点拉回 WebView。
///
/// 注册在 `main.rs` 的 `generate_handler!` 中，仅 Windows 编译。
#[tauri::command]
pub fn force_refocus(window: WebviewWindow) {
    if let Err(e) = window.set_focus() {
        tracing::warn!(target: "windows_focus", "force_refocus set_focus failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    // 该模块依赖 Tauri 运行时与 Windows GUI，单元测试难以在 CI 中跑。
    // 保留空 test module 占位，真实验证通过手动在 Windows 上启动应用完成。
}
