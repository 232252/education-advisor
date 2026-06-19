//! System tray integration: minimize-to-tray, tray menu, and click handling.
//!
//! The tray icon is created on the main thread (required on macOS and for the
//! GTK event loop on Linux). Menu events are polled each frame from egui's
//! update loop. If the platform doesn't support tray icons (or dependencies are
//! missing), the app gracefully falls back to a normal window.

use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    TrayIcon, TrayIconBuilder, TrayIconEvent,
};

const MENU_SHOW: &str = "ea.show";
const MENU_HIDE: &str = "ea.hide";
const MENU_QUIT: &str = "ea.quit";

pub struct TrayHandle {
    #[allow(dead_code)]
    tray: TrayIcon,
}

/// Try to build a tray icon and menu. Returns `None` on unsupported platforms or
/// missing system libraries (e.g., libappindicator on Linux).
pub fn build_tray() -> Option<TrayHandle> {
    let menu = Menu::new();
    let show_i = MenuItem::with_id(MENU_SHOW, "显示窗口", true, None);
    let hide_i = MenuItem::with_id(MENU_HIDE, "隐藏窗口", true, None);
    let quit_i = MenuItem::with_id(MENU_QUIT, "退出", true, None);
    let _ = menu.append(&show_i);
    let _ = menu.append(&hide_i);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&quit_i);

    let (rgba, width, height) = crate::theme::app_icon_rgba();
    let icon = tray_icon::Icon::from_rgba(rgba, width, height).ok()?;

    let tray = TrayIconBuilder::new()
        .with_tooltip("Education Advisor")
        .with_icon(icon)
        .with_menu(Box::new(menu))
        .build()
        .ok()?;

    Some(TrayHandle { tray })
}

/// Poll pending tray events and apply window commands.
pub fn poll_events(ctx: &eframe::egui::Context, visible: &mut bool) -> Option<TrayAction> {
    // Tray icon left-click toggles visibility.
    while let Ok(event) = TrayIconEvent::receiver().try_recv() {
        if matches!(event, tray_icon::TrayIconEvent::Click { .. }) {
            toggle_visibility(ctx, visible);
        }
    }

    while let Ok(event) = MenuEvent::receiver().try_recv() {
        match event.id().as_ref() {
            MENU_SHOW => {
                ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Visible(true));
                *visible = true;
            }
            MENU_HIDE => {
                ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Visible(false));
                *visible = false;
            }
            MENU_QUIT => return Some(TrayAction::Quit),
            _ => {}
        }
    }
    None
}

fn toggle_visibility(ctx: &eframe::egui::Context, visible: &mut bool) {
    let next = !*visible;
    ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Visible(next));
    if next {
        ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Focus);
    }
    *visible = next;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    Quit,
}
