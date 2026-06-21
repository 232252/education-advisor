//! The application root: owns all UI state, the runtime handle, theme, and the
//! event pump that drains background results into the render loop each frame.

use std::collections::HashMap;
use std::sync::Arc;

use eframe::egui;
use eframe::egui::{Context, Frame, Margin, Vec2};
use parking_lot::RwLock;

use crate::models::{
    Conversation, DashboardStats, LlmProvider, Message, Role, ScheduledTask, Settings, Student,
    ThemeMode, ToolCallRecord, ToolStatus,
};
use crate::privacy::Cipher;
use crate::runtime::{Event, RuntimeHandle, ToastKind};
use crate::theme::Theme;

/// Top-level navigation targets, matching the original React app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Page {
    Dashboard,
    Chat,
    Students,
    Agents,
    AgentHistory,
    Models,
    Skills,
    Scheduler,
    Rag,
    Privacy,
    Settings,
}

impl Page {
    pub const ALL: [Self; 11] = [
        Self::Dashboard,
        Self::Chat,
        Self::Students,
        Self::Agents,
        Self::AgentHistory,
        Self::Models,
        Self::Skills,
        Self::Scheduler,
        Self::Rag,
        Self::Privacy,
        Self::Settings,
    ];
    pub const fn label(self) -> &'static str {
        match self {
            Self::Dashboard => "总览",
            Self::Chat => "对话",
            Self::Students => "学生档案",
            Self::Agents => "AI 代理",
            Self::AgentHistory => "执行历史",
            Self::Models => "模型",
            Self::Skills => "技能",
            Self::Scheduler => "定时任务",
            Self::Rag => "知识库",
            Self::Privacy => "隐私",
            Self::Settings => "设置",
        }
    }
}

/// A transient toast notification.
#[derive(Clone)]
pub struct Toast {
    pub kind: ToastKind,
    pub msg: String,
    pub born: std::time::Instant,
    pub ttl: std::time::Duration,
}

pub struct App {
    pub runtime: RuntimeHandle,
    pub cipher: Cipher,
    pub theme: Theme,
    pub settings: Settings,
    pub page: Page,
    pub page_anim: crate::util::Anim,
    pub sidebar_collapsed: bool,
    pub sidebar_anim: crate::util::Anim,

    // cached domain data
    pub students: Arc<RwLock<Vec<Student>>>,
    pub conversations: Arc<RwLock<Vec<Conversation>>>,
    pub messages: HashMap<uuid::Uuid, Vec<Message>>,
    pub tasks: Arc<RwLock<Vec<ScheduledTask>>>,
    pub providers: Arc<RwLock<Vec<LlmProvider>>>,
    pub rag_documents: Arc<RwLock<Vec<crate::models::RagDocument>>>,
    pub stats: Arc<RwLock<Option<DashboardStats>>>,

    // streaming state per conversation
    pub streaming: HashMap<uuid::Uuid, StreamState>,

    // UI-local state
    pub toasts: Vec<Toast>,
    pub selected_student: Option<uuid::Uuid>,
    pub selected_conversation: Option<uuid::Uuid>,
    pub active_agent: String,
    pub chat_input: String,
    pub last_dt: f32,

    // page-local state owned by ui modules via a shared bag
    pub ui_state: crate::ui::UiState,

    // tray integration
    #[allow(dead_code)]
    pub tray: Option<crate::tray::TrayHandle>,
    pub window_visible: bool,
}

#[derive(Default, Clone)]
pub struct StreamState {
    pub current_message_id: Option<uuid::Uuid>,
    pub buffer: String,
    pub tool_calls: Vec<ToolCallRecord>,
    pub active: bool,
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        // ---- fonts: ship a CJK-capable font so Chinese renders everywhere ----
        install_fonts(&cc.egui_ctx);

        // ---- launch background runtime ----
        let db_path = db_path();

        // ---- persistence: eframe storage first, DB fallback ----
        let settings = cc
            .storage
            .and_then(|s| eframe::get_value::<Settings>(s, eframe::APP_KEY))
            .or_else(|| {
                if let Ok(db) = crate::db::Db::open(&db_path) {
                    db.load_settings().ok()
                } else {
                    None
                }
            })
            .unwrap_or_default();
        let (runtime, cipher) = match crate::runtime::Runtime::launch(db_path) {
            Ok((rt, cipher)) => (rt.handle(), cipher),
            Err(e) => {
                eprintln!("[startup] runtime launch failed: {e}, falling back to in-memory DB");
                let db = crate::db::Db::open_in_memory().expect("in-memory db");
                let cipher = crate::privacy::Cipher::random();
                let (rt, _) =
                    crate::runtime::Runtime::launch_with(db, cipher.clone()).expect("launch");
                (rt.handle(), cipher)
            }
        };

        // seed demo data on first run
        let _ = runtime.tx.send(crate::runtime::Command::LoadStudents);
        let _ = runtime.tx.send(crate::runtime::Command::LoadConversations);
        let _ = runtime.tx.send(crate::runtime::Command::LoadTasks);
        let _ = runtime.tx.send(crate::runtime::Command::LoadProviders);
        let _ = runtime.tx.send(crate::runtime::Command::LoadRagDocuments);
        let _ = runtime.tx.send(crate::runtime::Command::LoadStats);

        let theme = match settings.theme {
            ThemeMode::Dark => Theme::dark(),
            ThemeMode::Light => Theme::light(),
        };

        let tray = crate::tray::build_tray();
        let app = Self {
            runtime,
            cipher,
            theme,
            settings: settings.clone(),
            page: Page::Dashboard,
            page_anim: crate::util::Anim::new(1.0, 350),
            sidebar_collapsed: settings.sidebar_collapsed,
            sidebar_anim: crate::util::Anim::new(
                if settings.sidebar_collapsed { 0.0 } else { 1.0 },
                300,
            ),
            students: Arc::new(RwLock::new(Vec::new())),
            conversations: Arc::new(RwLock::new(Vec::new())),
            messages: HashMap::new(),
            tasks: Arc::new(RwLock::new(Vec::new())),
            providers: Arc::new(RwLock::new(Vec::new())),
            rag_documents: Arc::new(RwLock::new(Vec::new())),
            stats: Arc::new(RwLock::new(None)),
            streaming: HashMap::new(),
            toasts: Vec::new(),
            selected_student: None,
            selected_conversation: None,
            active_agent: "main".into(),
            chat_input: String::new(),
            last_dt: 0.0,
            ui_state: crate::ui::UiState::default(),
            tray,
            window_visible: true,
        };
        app.apply_theme(&cc.egui_ctx);
        app
    }

    pub fn apply_theme(&self, ctx: &Context) {
        let t = &self.theme;
        let mut style = (*ctx.style()).clone();
        style.spacing.item_spacing = Vec2::new(8.0, 8.0);
        style.spacing.window_margin = Margin::same(10.0);
        style.visuals = if t.dark {
            egui::Visuals::dark()
        } else {
            egui::Visuals::light()
        };
        style.visuals.window_fill = t.elevated;
        style.visuals.faint_bg_color = t.surface;
        style.visuals.extreme_bg_color = t.bg;
        style.visuals.widgets.noninteractive.bg_fill = t.surface;
        style.visuals.widgets.noninteractive.fg_stroke = egui::Stroke::new(1.0, t.text);
        style.visuals.widgets.hovered.bg_fill = t.accent_dim;
        style.visuals.widgets.hovered.fg_stroke = egui::Stroke::new(1.0, t.accent_hover);
        style.visuals.widgets.active.bg_fill = t.accent;
        style.visuals.widgets.active.fg_stroke = egui::Stroke::new(1.0, t.text);
        style.visuals.selection.bg_fill = t.accent;
        style.visuals.selection.stroke = egui::Stroke::new(1.0, t.text);
        style.visuals.window_stroke = egui::Stroke::new(1.0, t.border);
        ctx.set_style(style);
        ctx.request_repaint();
    }

    pub(crate) fn toggle_theme(&mut self, ctx: &Context) {
        self.settings.theme = match self.settings.theme {
            ThemeMode::Dark => ThemeMode::Light,
            ThemeMode::Light => ThemeMode::Dark,
        };
        self.theme = match self.settings.theme {
            ThemeMode::Dark => Theme::dark(),
            ThemeMode::Light => Theme::light(),
        };
        self.apply_theme(ctx);
    }

    fn drain_events(&mut self, ctx: &Context) {
        use Event::{
            ConversationCreated, ConversationDeleted, Conversations, Grades, Messages,
            ProviderDeleted, ProviderSaved, Providers, RagDocumentDeleted, RagDocumentSaved,
            RagDocuments, Settings, Stats, StreamDone, StreamError, StreamStart, StreamToken,
            StreamTool, StudentDeleted, Students, StudentsImported, StudentsSaved, TaskDeleted,
            TaskSaved, Tasks, Toast,
        };
        while let Ok(evt) = self.runtime.rx.try_recv() {
            match evt {
                Students(v) => *self.students.write() = v,
                StudentsSaved => self.push_toast(ToastKind::Success, "学生已保存"),
                StudentDeleted => self.push_toast(ToastKind::Success, "学生已删除"),
                Grades(id, v) => {
                    self.ui_state.grades.insert(id, v);
                }
                StudentsImported { added } => {
                    self.push_toast(ToastKind::Success, format!("已导入 {added} 名学生"));
                }
                Conversations(v) => *self.conversations.write() = v,
                ConversationCreated(c) => {
                    let mut convs = self.conversations.write();
                    if !convs.iter().any(|x| x.id == c.id) {
                        convs.insert(0, c.clone());
                    }
                    self.selected_conversation = Some(c.id);
                    let _ = self
                        .runtime
                        .tx
                        .send(crate::runtime::Command::LoadMessages(c.id));
                }
                ConversationDeleted => {
                    self.push_toast(ToastKind::Success, "会话已删除");
                }
                Messages(id, v) => {
                    self.messages.insert(id, v);
                }
                StreamStart {
                    conversation_id,
                    message_id,
                } => {
                    let st = self.streaming.entry(conversation_id).or_default();
                    st.current_message_id = Some(message_id);
                    st.buffer.clear();
                    st.tool_calls.clear();
                    st.active = true;
                    ctx.request_repaint();
                }
                StreamToken {
                    conversation_id,
                    message_id: _,
                    delta,
                } => {
                    if let Some(st) = self.streaming.get_mut(&conversation_id) {
                        st.buffer.push_str(&delta);
                    }
                    ctx.request_repaint();
                }
                StreamTool {
                    conversation_id,
                    message_id,
                    call,
                } => {
                    if let Some(st) = self.streaming.get_mut(&conversation_id) {
                        // The same logical tool call may arrive in two phases:
                        //   1) "Running" with empty result (start)
                        //   2) "Success"/"Failed" with the populated result (end)
                        // Identify the phase by result emptiness and the current
                        // status, then either update the matching entry or
                        // append a new one. We key by (message_id, name) so that
                        // two distinct tool calls with the same name in the same
                        // message are tracked separately (e.g. two
                        // `lookup_student` calls in one assistant turn).
                        let key = (message_id, call.name.as_str());
                        let existing_idx = st
                            .tool_calls
                            .iter()
                            .position(|t| (t.message_id, t.name.as_str()) == key);
                        match existing_idx {
                            Some(idx) if call.result.is_empty() => {
                                // Phase 1 (start) — replace placeholder if any,
                                // otherwise update in-place.
                                st.tool_calls[idx] = ToolCallRecord {
                                    message_id,
                                    ..call
                                };
                            }
                            Some(idx) => {
                                // Phase 2 (end) — keep the recorded duration from
                                // the start phase, only update result/status.
                                let start_dur = st.tool_calls[idx].duration_ms;
                                st.tool_calls[idx] = ToolCallRecord {
                                    message_id,
                                    duration_ms: if call.duration_ms == 0 {
                                        start_dur
                                    } else {
                                        call.duration_ms
                                    },
                                    ..call
                                };
                            }
                            None => {
                                st.tool_calls.push(ToolCallRecord {
                                    message_id,
                                    ..call
                                });
                            }
                        }
                    }
                    ctx.request_repaint();
                }
                StreamDone {
                    conversation_id,
                    message_id,
                } => {
                    if let Some(st) = self.streaming.get_mut(&conversation_id) {
                        // finalize: move buffer into messages list
                        let content = std::mem::take(&mut st.buffer);
                        let tcs = std::mem::take(&mut st.tool_calls);
                        st.active = false;
                        st.current_message_id = None;
                        let now = chrono::Utc::now();
                        let msg = Message {
                            id: message_id,
                            conversation_id,
                            role: Role::Assistant,
                            content,
                            tool_calls: tcs,
                            created_at: now,
                        };
                        self.messages.entry(conversation_id).or_default().push(msg);
                    }
                    // refresh conversation list order
                    let _ = self
                        .runtime
                        .tx
                        .send(crate::runtime::Command::LoadConversations);
                    ctx.request_repaint();
                }
                StreamError {
                    conversation_id,
                    error,
                } => {
                    if let Some(st) = self.streaming.get_mut(&conversation_id) {
                        st.active = false;
                    }
                    self.push_toast(ToastKind::Error, error);
                    ctx.request_repaint();
                }
                Tasks(v) => *self.tasks.write() = v,
                TaskSaved => self.push_toast(ToastKind::Success, "任务已保存"),
                TaskDeleted => self.push_toast(ToastKind::Success, "任务已删除"),
                Providers(v) => *self.providers.write() = v,
                ProviderSaved => self.push_toast(ToastKind::Success, "提供商已保存"),
                ProviderDeleted => self.push_toast(ToastKind::Success, "提供商已删除"),
                RagDocuments(v) => *self.rag_documents.write() = v,
                RagDocumentSaved => self.push_toast(ToastKind::Success, "文档已加入知识库"),
                RagDocumentDeleted => self.push_toast(ToastKind::Success, "文档已删除"),
                Stats(s) => *self.stats.write() = Some(s),
                Settings(s) => {
                    // The runtime confirms a persisted Settings write (e.g.
                    // triggered by `eframe::App::save`). Mirror it locally so
                    // any UI that reads `app.settings` between events sees the
                    // authoritative copy. Skip if the values are identical to
                    // avoid an unnecessary style recomputation.
                    if s != self.settings {
                        self.settings = s;
                        self.theme = match self.settings.theme {
                            ThemeMode::Dark => Theme::dark(),
                            ThemeMode::Light => Theme::light(),
                        };
                        self.apply_theme(ctx);
                    }
                }
                Toast { kind, msg } => self.push_toast(kind, msg),
            }
        }
    }

    pub(crate) fn push_toast(&mut self, kind: ToastKind, msg: impl Into<String>) {
        self.toasts.push(Toast {
            kind,
            msg: msg.into(),
            born: std::time::Instant::now(),
            ttl: std::time::Duration::from_millis(3500),
        });
        if self.toasts.len() > 5 {
            self.toasts.remove(0);
        }
    }

    pub(crate) fn navigate(&mut self, page: Page) {
        if self.page != page {
            self.page = page;
            self.page_anim = crate::util::Anim::new(0.0, 320);
            self.page_anim.set_target(1.0, 320);
        }
    }
}

impl eframe::App for App {
    fn update(&mut self, ctx: &Context, _frame: &mut eframe::Frame) {
        self.last_dt = ctx.input(|i| i.stable_dt.min(0.05));

        // ─── Keyboard shortcuts ─────────────────────────────────────────
        // Ctrl/Cmd + <digit> = jump to the n-th navigation slot
        // Ctrl/Cmd + B       = toggle sidebar
        // Ctrl/Cmd + ,       = Settings
        // Ctrl/Cmd + K       = Chat
        // Ctrl/Cmd + L       = focus chat input (handled in chat page)
        // Esc                = cancel any in-flight AI generation
        let input = ctx.input(|i| i.clone());
        let cmd_or_ctrl = input.modifiers.command || input.modifiers.ctrl;
        if cmd_or_ctrl && !input.modifiers.alt && !input.modifiers.shift {
            // Digit keys: egui exposes Key::Num1..Num9 + Key::Num0.
            const DIGIT_KEYS: [egui::Key; 10] = [
                egui::Key::Num1,
                egui::Key::Num2,
                egui::Key::Num3,
                egui::Key::Num4,
                egui::Key::Num5,
                egui::Key::Num6,
                egui::Key::Num7,
                egui::Key::Num8,
                egui::Key::Num9,
                egui::Key::Num0,
            ];
            let mut navigated: Option<Page> = None;
            for (idx, k) in DIGIT_KEYS.iter().enumerate() {
                if input.key_pressed(*k) {
                    // 1..9 → first nine pages, 0 → tenth page.
                    let slot = if idx < 9 { idx } else { 9 };
                    if let Some(p) = Page::ALL.get(slot) {
                        navigated = Some(*p);
                    }
                    break;
                }
            }
            if navigated.is_none() {
                if input.key_pressed(egui::Key::B) {
                    self.sidebar_collapsed = !self.sidebar_collapsed;
                    self.settings.sidebar_collapsed = self.sidebar_collapsed;
                } else if input.key_pressed(egui::Key::Comma) {
                    navigated = Some(Page::Settings);
                } else if input.key_pressed(egui::Key::K) {
                    navigated = Some(Page::Chat);
                }
            }
            if let Some(p) = navigated {
                self.navigate(p);
            }
        }
        if input.key_pressed(egui::Key::Escape) {
            // Cancel every in-flight AI generation (typically just one).
            let active: Vec<uuid::Uuid> = self
                .streaming
                .iter()
                .filter(|(_, st)| st.active)
                .map(|(id, _)| *id)
                .collect();
            for id in active {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::CancelConversation(id));
            }
        }

        // Tray menu events: show/hide/quit.
        if crate::tray::poll_events(ctx, &mut self.window_visible)
            == Some(crate::tray::TrayAction::Quit)
        {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }

        // Intercept close when tray is active: hide instead of quitting.
        let close_requested = ctx.input(|i| i.viewport().close_requested());
        if close_requested && self.tray.is_some() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
            self.window_visible = false;
        }

        self.drain_events(ctx);

        // subtle gradient background
        paint_gradient_bg(ctx, &self.theme);

        // top bar
        crate::ui::topbar::show(self, ctx);

        // body: sidebar + content
        let screen_w = ctx.screen_rect().width();
        let min_sidebar = 64.0_f32.min(screen_w * 0.18);
        let sidebar_width = self
            .sidebar_anim
            .value()
            .max(0.0)
            .mul_add(200.0, min_sidebar);
        egui::SidePanel::left("sidebar")
            .resizable(false)
            .exact_width(sidebar_width)
            .frame(
                Frame::none()
                    .fill(self.theme.bg_elevated)
                    .inner_margin(Margin::same(0.0)),
            )
            .show(ctx, |ui| {
                crate::ui::sidebar::show(self, ui);
            });

        egui::CentralPanel::default()
            .frame(
                Frame::none()
                    .fill(self.theme.bg)
                    .inner_margin(Margin::same(16.0)),
            )
            .show(ctx, |ui| {
                let alpha = self.page_anim.value();
                let opacity = alpha.clamp(0.0, 1.0);
                let offset = (1.0 - opacity) * 16.0;
                ui.add_space(offset);
                ui.allocate_ui_with_layout(
                    ui.max_rect().size() - Vec2::new(0.0, offset),
                    egui::Layout::top_down(egui::Align::LEFT),
                    |ui| {
                        ui.set_opacity(opacity);
                        match self.page {
                            Page::Dashboard => crate::ui::dashboard::show(self, ui),
                            Page::Students => crate::ui::students_page::show(self, ui),
                            Page::Agents => crate::ui::agents_page::show(self, ui),
                            Page::AgentHistory => crate::ui::agent_history_page::show(self, ui),
                            Page::Chat => crate::ui::chat::show(self, ui),
                            Page::Scheduler => crate::ui::scheduler_page::show(self, ui),
                            Page::Rag => crate::ui::rag_page::show(self, ui),
                            Page::Models => crate::ui::models_page::show(self, ui),
                            Page::Skills => crate::ui::skills_page::show(self, ui),
                            Page::Privacy => crate::ui::privacy_page::show(self, ui),
                            Page::Settings => crate::ui::settings_page::show(self, ui),
                        }
                    },
                );
            });

        // toasts overlay
        crate::ui::toast::show(self, ctx);

        // keep repainting while animating or streaming
        let animating = !self.page_anim.done()
            || !self.sidebar_anim.done()
            || self.streaming.values().any(|s| s.active);
        if animating {
            ctx.request_repaint();
        }
        // purge expired toasts
        let now = std::time::Instant::now();
        self.toasts.retain(|t| now.duration_since(t.born) < t.ttl);
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        self.settings.sidebar_collapsed = self.sidebar_collapsed;
        eframe::set_value(storage, eframe::APP_KEY, &self.settings);
        // Persist settings to DB as well so window geometry survives re-installs.
        let _ = self
            .runtime
            .tx
            .send(crate::runtime::Command::SaveSettings(self.settings.clone()));
    }
}

fn paint_gradient_bg(ctx: &Context, theme: &Theme) {
    let rect = ctx.screen_rect();
    let painter = ctx.layer_painter(egui::LayerId::background());
    // Draw a vertical gradient using a series of horizontal lines.
    let steps = 64;
    let h = rect.height();
    for i in 0..steps {
        let y0 = h.mul_add(i as f32 / steps as f32, rect.min.y);
        let y1 = h.mul_add((i + 1) as f32 / steps as f32, rect.min.y);
        let t = (i as f32 / steps as f32).clamp(0.0, 1.0);
        let color = Theme::lerp(theme.bg_gradient_from, theme.bg_gradient_to, t);
        painter.rect_filled(
            egui::Rect::from_min_max(egui::pos2(rect.min.x, y0), egui::pos2(rect.max.x, y1)),
            0.0,
            color,
        );
    }
}

fn db_path() -> std::path::PathBuf {
    let mut p = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    p.push("education-advisor");
    let _ = std::fs::create_dir_all(&p);
    p.push("ea.db");
    p
}

fn install_fonts(ctx: &Context) {
    let mut fonts = egui::FontDefinitions::default();
    // Try to install a system CJK font so Chinese glyphs render. We probe a few
    // common paths; if none exist we fall back to egui's default (Latin only).
    let candidates: &[&str] = &[
        // Linux
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc",
        "/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc",
        // macOS
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        // Windows
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    ];
    for path in candidates {
        if let Ok(data) = std::fs::read(path) {
            fonts
                .font_data
                .insert("cjk".into(), egui::FontData::from_owned(data));
            fonts
                .families
                .entry(egui::FontFamily::Proportional)
                .or_default()
                .insert(0, "cjk".into());
            fonts
                .families
                .entry(egui::FontFamily::Monospace)
                .or_default()
                .push("cjk".into());
            break;
        }
    }
    ctx.set_fonts(fonts);
}
