//! 系统托盘 — Rust 重写自 `src/main/services/tray-service.ts` (125 行)。
//!
//! Tauri 2.0 用 `tauri::tray::TrayIconBuilder`。菜单项点击通过事件路由到
//! 主窗口 (show / hide / quit)。托盘图标在 tauri.conf.json 里声明 iconPath。
//!
//! 注意: 实际构建需要在 main.rs 的 setup 里调用, 因为依赖 AppHandle。

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::error::{AppError, Result};

/// 构建并安装托盘。返回的句柄由 Tauri 持有, 无需手动 Drop。
pub fn setup(app: &AppHandle) -> Result<()> {
    let show = MenuItem::with_id(app, "tray_show", "显示窗口", true, None::<&str>)
        .map_err(crate::error::other)?;
    let hide = MenuItem::with_id(app, "tray_hide", "隐藏到托盘", true, None::<&str>)
        .map_err(crate::error::other)?;
    let quit = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)
        .map_err(crate::error::other)?;
    let menu = Menu::with_items(app, &[&show, &hide, &quit]).map_err(crate::error::other)?;

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(
            app.default_window_icon()
                .cloned()
                .ok_or_else(|| AppError::Other("缺少默认窗口图标".into()))?,
        )
        .tooltip("Education Advisor")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "tray_hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            "tray_quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)
        .map_err(crate::error::other)?;

    tracing::info!(target: "tray", "installed");
    Ok(())
}
