//! 平台特定代码入口。
//!
//! 当前仅 Windows 需要显式焦点修复（WebView2 父窗口焦点链问题）。
//! 非 Windows 平台编译为空 stub，保证跨平台一致。

#[cfg(target_os = "windows")]
pub mod windows_focus;

#[cfg(not(target_os = "windows"))]
mod stub {
    use tauri::WebviewWindow;

    pub fn initial_focus(_window: &WebviewWindow) {}
    pub fn install_refocus_guard(_window: &WebviewWindow) {}
    pub fn force_refocus(_window: &WebviewWindow) {}
}

#[cfg(not(target_os = "windows"))]
pub use stub::*;
