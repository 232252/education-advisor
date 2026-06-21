//! System tray integration: minimize-to-tray, tray menu, and click handling.
//!
//! The tray icon is created on the main thread (required on macOS and for the
//! GTK event loop on Linux). Menu events are polled each frame from egui's
//! update loop. If the platform doesn't support tray icons (or dependencies are
//! missing), the app gracefully falls back to a normal window.

#[cfg(feature = "tray")]
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    TrayIcon, TrayIconBuilder, TrayIconEvent,
};

#[cfg(feature = "tray")]
const MENU_SHOW: &str = "ea.show";
#[cfg(feature = "tray")]
const MENU_HIDE: &str = "ea.hide";
#[cfg(feature = "tray")]
const MENU_NEW_CHAT: &str = "ea.new_chat";
#[cfg(feature = "tray")]
const MENU_KNOWLEDGE: &str = "ea.knowledge";
#[cfg(feature = "tray")]
const MENU_BACKUP: &str = "ea.backup";
#[cfg(feature = "tray")]
const MENU_QUIT: &str = "ea.quit";

/// All actions the tray can request. Most are simple "navigate to" hints
/// that the UI's `update` loop translates into a `navigate` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    Quit,
    Show,
    Hide,
    NewChat,
    Knowledge,
    Backup,
}

#[cfg(feature = "tray")]
pub struct TrayHandle {
    #[allow(dead_code)]
    tray: TrayIcon,
}

#[cfg(not(feature = "tray"))]
pub struct TrayHandle;

/// Try to build a tray icon and menu. Returns `None` on unsupported platforms or
/// missing system libraries (e.g., libappindicator on Linux).
#[cfg(feature = "tray")]
pub fn build_tray() -> Option<TrayHandle> {
    let menu = Menu::new();
    let show_i = MenuItem::with_id(MENU_SHOW, "显示窗口", true, None);
    let hide_i = MenuItem::with_id(MENU_HIDE, "隐藏窗口", true, None);
    let new_chat_i = MenuItem::with_id(MENU_NEW_CHAT, "新建对话", true, None);
    let knowledge_i = MenuItem::with_id(MENU_KNOWLEDGE, "知识库", true, None);
    let backup_i = MenuItem::with_id(MENU_BACKUP, "导出备份…", true, None);
    let quit_i = MenuItem::with_id(MENU_QUIT, "退出", true, None);
    let _ = menu.append(&show_i);
    let _ = menu.append(&hide_i);
    let _ = menu.append(&PredefinedMenuItem::separator());
    let _ = menu.append(&new_chat_i);
    let _ = menu.append(&knowledge_i);
    let _ = menu.append(&backup_i);
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

#[cfg(not(feature = "tray"))]
pub const fn build_tray() -> Option<TrayHandle> {
    None
}

/// Poll pending tray events and apply window commands.
pub fn poll_events(ctx: &eframe::egui::Context, visible: &mut bool) -> Option<TrayAction> {
    #[cfg(feature = "tray")]
    {
        // Tray icon left-click toggles visibility.
        while let Ok(event) = TrayIconEvent::receiver().try_recv() {
            if matches!(event, TrayIconEvent::Click { .. }) {
                toggle_visibility(ctx, visible);
            }
        }

        while let Ok(event) = MenuEvent::receiver().try_recv() {
            match event.id().as_ref() {
                MENU_SHOW => {
                    ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Visible(true));
                    ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Focus);
                    *visible = true;
                    return Some(TrayAction::Show);
                }
                MENU_HIDE => {
                    ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Visible(false));
                    *visible = false;
                    return Some(TrayAction::Hide);
                }
                MENU_NEW_CHAT => return Some(TrayAction::NewChat),
                MENU_KNOWLEDGE => return Some(TrayAction::Knowledge),
                MENU_BACKUP => return Some(TrayAction::Backup),
                MENU_QUIT => return Some(TrayAction::Quit),
                _ => {}
            }
        }
    }
    let _ = (ctx, visible);
    None
}

#[cfg(feature = "tray")]
fn toggle_visibility(ctx: &eframe::egui::Context, visible: &mut bool) {
    let next = !*visible;
    ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Visible(next));
    if next {
        ctx.send_viewport_cmd(eframe::egui::ViewportCommand::Focus);
    }
    *visible = next;
}
