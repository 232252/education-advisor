//! PII Shield dialogs.
//!
//! The Privacy page exposes two entry points into the PII Shield engine:
//!
//! 1. "初始化 / 解锁" — open [`show_unlock_dialog`] which lets the user
//!    either initialize a brand-new engine with a fresh password, or
//!    unlock an existing encrypted mapping file with the password it
//!    was created with.
//! 2. "查看映射" — open [`show_mappings_view`] which lists every
//!    `(entity_type, alias, real_name)` triple currently in memory.
//!
//! Both dialogs read/write through `App::pii`, which holds the shared
//! `parking_lot::Mutex<PrivacyEngine>`.
//!
//! `#[allow(dead_code)]` covers the state-management helpers
//! (`open_unlock`, `open_mappings`) that the public free functions
//! (`open_unlock_dialog`, `open_mappings_view`) currently call into
//! instead of going through `UiState` directly.

#![allow(dead_code)]

use eframe::egui::{self, Align, FontId, Layout, Vec2};

use crate::app::App;

#[derive(Default)]
pub struct PiiDialogState {
    pub show_unlock: bool,
    pub show_mappings: bool,
    /// Password input for initialize / unlock.
    pub password: String,
    /// Path to the data dir the user is initializing. Defaults to
    /// `dirs::data_dir()/education-advisor` and is filled in lazily.
    pub data_dir: Option<std::path::PathBuf>,
    pub last_error: Option<String>,
    pub last_info: Option<String>,
}

impl PiiDialogState {
    pub fn open_unlock(&mut self) {
        self.show_unlock = true;
        self.password.clear();
        self.last_error = None;
        self.last_info = None;
    }
    pub fn open_mappings(&mut self) {
        self.show_mappings = true;
    }
    pub fn close(&mut self) {
        self.show_unlock = false;
        self.show_mappings = false;
    }
}

pub fn open_unlock_dialog(app: &mut App) {
    app.ui_state.pii_dialog.show_unlock = true;
    app.ui_state.pii_dialog.password.clear();
    app.ui_state.pii_dialog.last_error = None;
    app.ui_state.pii_dialog.last_info = None;
}

pub fn open_mappings_view(app: &mut App) {
    app.ui_state.pii_dialog.show_mappings = true;
}

fn data_dir_default() -> std::path::PathBuf {
    let mut p = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    p.push("education-advisor");
    p
}

/// Render both dialogs if they are open. Call this at the end of the
/// privacy page so the windows draw on top of the page.
pub fn show(app: &mut App, ctx: &egui::Context) {
    if app.ui_state.pii_dialog.show_unlock {
        show_unlock_dialog(app, ctx);
    }
    if app.ui_state.pii_dialog.show_mappings {
        show_mappings_view(app, ctx);
    }
}

fn show_unlock_dialog(app: &mut App, ctx: &egui::Context) {
    let mut open = true;
    let theme = app.theme.clone();
    egui::Window::new("PII Shield 初始化 / 解锁")
        .open(&mut open)
        .resizable(false)
        .collapsible(false)
        .show(ctx, |ui| {
            let pii_exists = app
                .ui_state
                .pii_dialog
                .data_dir
                .clone()
                .unwrap_or_else(data_dir_default)
                .join("privacy")
                .join("mapping.enc")
                .exists();
            ui.label(
                egui::RichText::new(if pii_exists {
                    "检测到已存在的加密映射表：输入密码解锁。"
                } else {
                    "首次使用：设置一个密码以创建加密映射表（密码丢失不可恢复）。"
                })
                .font(FontId::proportional(12.0))
                .color(theme.text),
            );
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.label("数据目录:");
                let mut path_str = app
                    .ui_state
                    .pii_dialog
                    .data_dir
                    .clone()
                    .unwrap_or_else(data_dir_default)
                    .display()
                    .to_string();
                ui.text_edit_singleline(&mut path_str);
                app.ui_state.pii_dialog.data_dir = Some(std::path::PathBuf::from(path_str));
            });
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                ui.label("密码:");
                ui.add(
                    egui::TextEdit::singleline(&mut app.ui_state.pii_dialog.password)
                        .password(true)
                        .hint_text("输入密码")
                        .desired_width(220.0),
                );
            });
            ui.add_space(6.0);
            if let Some(err) = &app.ui_state.pii_dialog.last_error {
                ui.colored_label(theme.danger, format!("❌ {err}"));
            }
            if let Some(info) = &app.ui_state.pii_dialog.last_info {
                ui.colored_label(theme.success, format!("✓ {info}"));
            }
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                if ui.button("初始化 / 解锁").clicked() {
                    try_init_or_unlock(app);
                }
                if ui.button("取消").clicked() {
                    app.ui_state.pii_dialog.close();
                }
            });
        });
    if !open {
        app.ui_state.pii_dialog.show_unlock = false;
    }
}

fn try_init_or_unlock(app: &mut App) {
    let dir = app
        .ui_state
        .pii_dialog
        .data_dir
        .clone()
        .unwrap_or_else(data_dir_default);
    let pwd = app.ui_state.pii_dialog.password.clone();
    if pwd.is_empty() {
        app.ui_state.pii_dialog.last_error = Some("请输入密码".into());
        return;
    }
    let mut pii = app.pii.lock();
    let exists = crate::pii_shield::PrivacyEngine::is_initialized(&dir);
    let result = if exists {
        pii.load(&dir, &pwd)
    } else {
        pii.init(&dir, &pwd)
    };
    match result {
        Ok(()) => {
            pii.set_enabled(true);
            app.ui_state.pii_dialog.last_error = None;
            app.ui_state.pii_dialog.last_info =
                Some(format!("成功：已加载 {} 条映射", pii.mapping_count()));
        }
        Err(e) => {
            app.ui_state.pii_dialog.last_error = Some(format!("{e}"));
            app.ui_state.pii_dialog.last_info = None;
        }
    }
}

fn show_mappings_view(app: &mut App, ctx: &egui::Context) {
    let mut open = true;
    let theme = app.theme.clone();
    let pii = app.pii.lock();
    let entries = pii.list_mappings();
    let enabled = pii.enabled;
    let count = pii.mapping_count();
    drop(pii);
    egui::Window::new("PII Shield 映射表")
        .open(&mut open)
        .resizable(true)
        .default_width(420.0)
        .show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(if enabled {
                        "● 引擎已启用"
                    } else {
                        "○ 引擎未启用"
                    })
                    .color(if enabled {
                        theme.success
                    } else {
                        theme.warning
                    })
                    .strong(),
                );
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    ui.label(format!("共 {count} 条"));
                });
            });
            ui.add_space(4.0);
            egui::ScrollArea::vertical()
                .max_height(360.0)
                .show(ui, |ui| {
                    egui::Grid::new("pii_grid")
                        .num_columns(3)
                        .spacing(Vec2::new(12.0, 4.0))
                        .striped(true)
                        .show(ui, |ui| {
                            ui.label(
                                egui::RichText::new("类型")
                                    .font(FontId::proportional(11.0))
                                    .strong(),
                            );
                            ui.label(
                                egui::RichText::new("化名")
                                    .font(FontId::proportional(11.0))
                                    .strong(),
                            );
                            ui.label(
                                egui::RichText::new("真名")
                                    .font(FontId::proportional(11.0))
                                    .strong(),
                            );
                            ui.end_row();
                            for e in &entries {
                                ui.label(&e.entity_type);
                                ui.label(
                                    egui::RichText::new(&e.alias)
                                        .color(theme.accent)
                                        .monospace(),
                                );
                                ui.label(&e.real_name);
                                ui.end_row();
                            }
                        });
                });
        });
    if !open {
        app.ui_state.pii_dialog.show_mappings = false;
    }
}

/// Convenience: used by chat and history views to deanonymize a
/// single message before display. The engine stays unlocked
/// (`enabled = true`) for the lifetime of the application once the
/// user has authenticated, so this is a cheap lookup.
#[allow(dead_code)]
pub fn deanonymize_for_display(app: &App, text: &str) -> String {
    let pii = app.pii.lock();
    pii.deanonymize(text)
}
