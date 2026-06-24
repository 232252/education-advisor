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

use eframe::egui::{self, Align, FontId, Layout, Rounding, Stroke, Vec2};

use crate::app::App;
use crate::ui::widgets::panel_title;

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

/// Bug #14 — 缓存默认数据目录，避免每帧 `data_dir_default()` 重复
/// 拼接路径 + `dirs::data_dir()` 一次系统调用。
fn data_dir_cached(state: &mut PiiDialogState) -> std::path::PathBuf {
    if let Some(p) = state.data_dir.as_ref() {
        return p.clone();
    }
    let p = data_dir_default();
    state.data_dir = Some(p.clone());
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
    let frame = egui::Frame::none()
        .fill(theme.surface)
        .stroke(Stroke::new(1.0, theme.border))
        .rounding(Rounding::same(20.0))
        .inner_margin(egui::Margin::same(16.0));
    egui::Window::new("PII Shield 初始化 / 解锁")
        .open(&mut open)
        .resizable(false)
        .collapsible(false)
        .frame(frame)
        .show(ctx, |ui| {
            panel_title(ui, &theme, "PII Shield 初始化 / 解锁");
            ui.add_space(8.0);
            let cached_dir = data_dir_cached(&mut app.ui_state.pii_dialog);
            let pii_exists = cached_dir.join("privacy").join("mapping.enc").exists();
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
                let mut path_str = cached_dir.display().to_string();
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
                    // Bug #19 — 取消时也要清空密码。
                    secure_zero(&mut app.ui_state.pii_dialog.password);
                }
            });
        });
    if !open {
        // Bug #19 — 窗口被关掉时清掉密码，避免常驻内存。
        secure_zero(&mut app.ui_state.pii_dialog.password);
        app.ui_state.pii_dialog.show_unlock = false;
    }
}

/// Bug #10 — 真正干活的入口。
///
/// 之前的实现把整段 init/load 全跑在 UI 线程：派生 AES 密钥 → 读盘
/// → AES-GCM 解密 → JSON 反序列化 → 构建双向映射，几万条映射时
/// 可以轻松卡 100~500ms，整张界面完全不能动。
///
/// 现在的实现：
///   1) UI 线程起一个独立 OS 线程（"pii-unlock"），把密码 clone 一份
///      传进去；
///   2) 线程内完成全部重活，构造好一个 `PrivacyEngine`，把引擎本身
///      通过 `mpsc::channel` 一次性回传给 UI；
///   3) UI 线程 `recv_timeout(15s)` 等结果；超时则报错，避免永远卡住；
///   4) 拿到引擎后，直接调 `engine.replace_with(...)` 把内部状态
///      一次性 swap 进 `app.pii`，**不再**二次 init/load；
///   5) 密码无论成功失败都立刻 `secure_zero` 清零。
///
/// 这样 UI 线程在等待期间还能响应系统消息（虽然 `recv` 会阻塞几
/// 百 ms，但比"完全卡死"好太多），重活也只跑一次。
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

    // channel 一次性传递 (engine | error)。
    let (tx, rx) = std::sync::mpsc::channel::<Result<crate::pii_shield::PrivacyEngine, String>>();
    let dir_for_thread = dir.clone();
    let mut pwd_for_thread = pwd.clone();
    let join = std::thread::Builder::new()
        .name("pii-unlock".into())
        .spawn(move || {
            // 线程内部做完整的 init/load；结束时把本地密码 buffer 立刻清零。
            let mut engine = crate::pii_shield::PrivacyEngine::default();
            let exists = crate::pii_shield::PrivacyEngine::is_initialized(&dir_for_thread);
            let result = if exists {
                engine.load(&dir_for_thread, &pwd_for_thread)
            } else {
                engine.init(&dir_for_thread, &pwd_for_thread)
            };
            secure_zero_string(&mut pwd_for_thread);
            match result {
                Ok(()) => {
                    engine.set_enabled(true);
                    let _ = tx.send(Ok(engine));
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("{e}")));
                }
            }
        });
    if let Err(e) = join {
        app.ui_state.pii_dialog.last_error = Some(format!("无法启动解锁线程: {e}"));
        secure_zero(&mut app.ui_state.pii_dialog.password);
        return;
    }

    // 阻塞等结果，但带超时，避免后端永远不响应把 UI 卡死。
    match rx.recv_timeout(std::time::Duration::from_secs(15)) {
        Ok(Ok(engine)) => {
            let count = engine.mapping_count();
            // 一次性 swap：UI 线程不重跑 init/load。
            app.pii.lock().replace_with(engine);
            app.ui_state.pii_dialog.last_error = None;
            app.ui_state.pii_dialog.last_info = Some(format!("成功：已加载 {count} 条映射"));
        }
        Ok(Err(err)) => {
            app.ui_state.pii_dialog.last_error = Some(err);
            app.ui_state.pii_dialog.last_info = None;
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            app.ui_state.pii_dialog.last_error = Some("PII 解锁超时（15s）".into());
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            app.ui_state.pii_dialog.last_error = Some("PII 解锁线程异常退出".into());
        }
    }
    // Bug #19 — 操作完成后立刻清空密码 buffer（防止常驻内存）。
    secure_zero(&mut app.ui_state.pii_dialog.password);
}

/// Bug #19 — 操作完成后立刻清空密码 buffer（防止常驻内存）。
///
/// 注：crate 启用了 `#![forbid(unsafe_code)]`，不能用 `as_bytes_mut()` 直接
/// 把底层 buffer 写零。安全 Rust 下退而求其次：把字符串内容替换为等长零字节
/// 再 `shrink_to_fit()`，让 allocator 立刻回收原 buffer —— 密码至少不再通过
/// `String` API 可访问；旧 buffer 的物理页最终会被 allocator / OS 在下次
/// 分配时清零或覆写，对常规桌面应用足够。
fn secure_zero(s: &mut String) {
    fill_with_zeros(s);
    s.clear();
    s.shrink_to_fit();
}

/// 线程内部使用的密码清零（不 shrink_to_fit，避免 allocator 路径里有意外拷贝）。
fn secure_zero_string(s: &mut String) {
    fill_with_zeros(s);
    s.clear();
}

/// 把 `String` 的可见内容覆写成等长零字节（不做 `unsafe` 写底层 buffer，
/// 而是通过 `replace_range` 把 UTF-8 安全的零字节内容塞进去，再交给外层 clear）。
fn fill_with_zeros(s: &mut String) {
    let len = s.len();
    if len == 0 {
        return;
    }
    // 用 ASCII 空格作为"占位零字节"（安全可见内容）；外层 clear 后会立即丢弃，
    // 所以占位符具体是什么字节不影响安全性 —— 关键是触发一次新分配并丢弃旧 buffer。
    let zeros: Vec<u8> = vec![b' '; len];
    if let Ok(zs) = std::str::from_utf8(&zeros) {
        s.replace_range(.., zs);
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
    let frame = egui::Frame::none()
        .fill(theme.surface)
        .stroke(Stroke::new(1.0, theme.border))
        .rounding(Rounding::same(20.0))
        .inner_margin(egui::Margin::same(16.0));
    egui::Window::new("PII Shield 映射表")
        .open(&mut open)
        .resizable(true)
        .default_width(420.0)
        .frame(frame)
        .show(ctx, |ui| {
            panel_title(ui, &theme, "PII Shield 映射表");
            ui.add_space(8.0);
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
