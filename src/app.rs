//! The application root: owns all UI state, the runtime handle, theme, and the
//! event pump that drains background results into the render loop each frame.

use std::collections::HashMap;
use std::sync::Arc;

use eframe::egui;
use eframe::egui::{Context, Frame, Margin, Vec2};
use parking_lot::RwLock;

use crate::models::{
    Conversation, DashboardStats, LlmProvider, Message, Role, ScheduledTask, Settings, Student,
    ThemeMode, ToolCallRecord,
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
    /// Bug #8 — messages 的 LRU 时间戳跟踪表。
    pub messages_last_used: HashMap<uuid::Uuid, u64>,
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

    // PII Shield — 假名化引擎（v0.1.0-rc.1 核心隐私功能）。
    // 启动时尝试自动加载已存在的映射文件；如果用户首次使用，
    // 则保持 enabled=false，UI 提供"解锁 / 初始化"入口。
    pub pii: parking_lot::Mutex<crate::pii_shield::PrivacyEngine>,
}

#[derive(Clone)]
pub struct StreamState {
    pub current_message_id: Option<uuid::Uuid>,
    pub buffer: String,
    pub tool_calls: Vec<ToolCallRecord>,
    pub active: bool,
    /// Bug #7 — 标记本条 streaming 状态最后一次被刷新的时间；
    /// `drain_events` 会定期清理超过一定时长未刷新的条目，避免
    /// 因网络/UI 卡顿造成的"僵尸"条目无限堆积。
    pub last_touched: std::time::Instant,
}

impl Default for StreamState {
    fn default() -> Self {
        Self {
            current_message_id: None,
            buffer: String::new(),
            tool_calls: Vec::new(),
            active: false,
            last_touched: std::time::Instant::now(),
        }
    }
}

/// Bug #7 — streaming 条目超过该时长未刷新即视为"僵尸"被清理。
/// 60s 足以覆盖任何正常的 token/tool 间隔（普通 LLM 流式 30~60 token/s
/// 不会断流 60s），同时把"网络卡住 / runtime 崩溃 / StreamDone/Error
/// 因通道背压丢失"等异常场景的条目兜底回收，避免内存泄漏。
const STREAM_ZOMBIE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

/// Bug #8 — messages 缓存 LRU 上限：超过此数量的会话会被驱逐最久未使用
/// 的条目。
const MESSAGES_LRU_CAP: usize = 20;
const MESSAGES_EVICT_BATCH: usize = 5;

/// Bug #8 — 全局单调 tick，作为 LRU 时间戳。
static MESSAGES_TICK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn next_tick() -> u64 {
    MESSAGES_TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Bug #8 — 驱逐超量条目。
///
/// - 若 `last_used` 有孤儿（map 里存在但 last_used 没记录），优先用
///   `last_used` 的最小 tick 当作"未知时间戳"回填，再统一排序驱逐。
/// - 若 `map` 仍有 `last_used` 缺失的条目（极端情况），把它们的 tick
///   视为 0（即最早），保证也会被驱逐。
fn enforce_messages_lru(
    map: &mut HashMap<uuid::Uuid, Vec<Message>>,
    last_used: &mut HashMap<uuid::Uuid, u64>,
) {
    if map.len() <= MESSAGES_LRU_CAP {
        return;
    }
    // 同步 last_used：删除 map 里已经不存在的；为 map 里的孤儿补 0
    // tick（确保它们会被优先驱逐）。
    last_used.retain(|id, _| map.contains_key(id));
    for id in map.keys() {
        last_used.entry(*id).or_insert(0);
    }
    let mut entries: Vec<(uuid::Uuid, u64)> = last_used
        .iter()
        .map(|(id, t)| (*id, *t))
        .collect();
    entries.sort_by_key(|(_, t)| *t);
    // 目标容量 = MESSAGES_LRU_CAP - evict_batch（留下 5 个槽位吸收
    // 下一次增长，避免每帧都做 evict 的抖动）。
    let target = MESSAGES_LRU_CAP.saturating_sub(MESSAGES_EVICT_BATCH);
    let to_evict = map.len().saturating_sub(target);
    for (id, _) in entries.iter().take(to_evict) {
        map.remove(id);
        last_used.remove(id);
    }
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
                    crate::runtime::Runtime::launch_with(db, cipher.clone(), None).expect("launch");
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
        let _ = runtime.tx.send(crate::runtime::Command::LoadSettings);

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
            messages_last_used: HashMap::new(),
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
            pii: parking_lot::Mutex::new(crate::pii_shield::PrivacyEngine::default()),
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
            BackupReady, ConversationCreated, ConversationDeleted, Conversations, Grades, Messages,
            ProviderDeleted, ProviderSaved, Providers, RagDocumentDeleted, RagDocumentSaved,
            RagDocuments, Settings, Stats, StreamDone, StreamError, StreamStart, StreamToken,
            StreamTool, StudentDeleted, Students, StudentsImported, StudentsSaved, TaskDeleted,
            TaskSaved, Tasks, Toast,
        };
        // Bug #7 — 在拉事件前先清扫超时未刷新的 streaming 僵尸条目。
        // 判定标准：`active` 且 `now - last_touched >= STREAM_ZOMBIE_TTL`。
        // （inactive 的条目在 StreamDone/Error 已经 remove 了，正常路径
        // 不会出现 `active=false` 长期驻留；这里多一道防护即可。）
        self.streaming.retain(|_, st| {
            st.last_touched.elapsed() < STREAM_ZOMBIE_TTL
        });
        // Bug #8 — 限制 messages 缓存规模（LRU 风格：删除最久未用的会话）。
        enforce_messages_lru(&mut self.messages, &mut self.messages_last_used);

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
                    self.messages_last_used.insert(id, next_tick());
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
                    st.last_touched = std::time::Instant::now();
                    ctx.request_repaint();
                }
                StreamToken {
                    conversation_id,
                    message_id,
                    delta,
                } => {
                    if let Some(st) = self.streaming.get_mut(&conversation_id) {
                        // Cross-check that the runtime is still talking
                        // about the same message we started streaming
                        // (a follow-up turn on the same conversation will
                        // emit a new message id, and we want to discard
                        // stale deltas).
                        if st.current_message_id == Some(message_id) {
                            st.buffer.push_str(&delta);
                            st.last_touched = std::time::Instant::now();
                        }
                    }
                    ctx.request_repaint();
                }
                StreamTool {
                    conversation_id,
                    message_id,
                    call,
                } => {
                    if let Some(st) = self.streaming.get_mut(&conversation_id) {
                        // Discard stale tool events from a previous turn
                        // if the message id no longer matches.
                        if st.current_message_id.is_some()
                            && st.current_message_id != Some(message_id)
                        {
                            return;
                        }
                        st.last_touched = std::time::Instant::now();
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
                                st.tool_calls[idx] = ToolCallRecord { message_id, ..call };
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
                                st.tool_calls.push(ToolCallRecord { message_id, ..call });
                            }
                        }
                    }
                    ctx.request_repaint();
                }
                StreamDone {
                    conversation_id,
                    message_id,
                } => {
                    if let Some(st) = self.streaming.remove(&conversation_id) {
                        // finalize: move buffer into messages list
                        let content = st.buffer;
                        let tcs = st.tool_calls;
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
                        self.messages_last_used
                            .insert(conversation_id, next_tick());
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
                    // Drop the streaming state so the entry doesn't leak.
                    self.streaming.remove(&conversation_id);
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
                BackupReady(backup) => {
                    // Prompt the user for a save location; the actual write
                    // happens off the UI thread via std::fs. (We could push to
                    // the runtime, but the payload is small and synchronous
                    // IO is fine here.)
                    let default_name = format!(
                        "education-advisor-backup-{}.json",
                        backup.created_at.format("%Y%m%d-%H%M%S")
                    );
                    if let Some(path) = rfd::FileDialog::new()
                        .set_file_name(&default_name)
                        .add_filter("JSON", &["json"])
                        .save_file()
                    {
                        match serde_json::to_string_pretty(&backup) {
                            Ok(s) => match std::fs::write(&path, s) {
                                Ok(()) => self.push_toast(
                                    ToastKind::Success,
                                    format!("备份已保存到 {}", path.display()),
                                ),
                                Err(e) => {
                                    self.push_toast(ToastKind::Error, format!("写入失败: {e}"))
                                }
                            },
                            Err(e) => self.push_toast(ToastKind::Error, format!("序列化失败: {e}")),
                        }
                    } else {
                        // User cancelled the dialog — not an error.
                    }
                }
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

        // ── Persist window geometry ──
        // We only write when the rect actually changes to avoid hammering
        // the runtime command channel.
        if let Some(outer) = ctx.input(|i| i.viewport().outer_rect) {
            let new_rect = crate::models::WindowRect {
                x: outer.min.x,
                y: outer.min.y,
                w: outer.width(),
                h: outer.height(),
            };
            if self.settings.window_rect.as_ref() != Some(&new_rect) {
                self.settings.window_rect = Some(new_rect);
            }
        }

        // ─── Keyboard shortcuts ─────────────────────────────────────────
        // Ctrl/Cmd + <digit> = jump to the n-th navigation slot
        // Ctrl/Cmd + B       = toggle sidebar
        // Ctrl/Cmd + ,       = Settings
        // Ctrl/Cmd + K       = Chat
        // Ctrl/Cmd + L       = focus chat input (handled in chat page)
        // Esc                = cancel any in-flight AI generation
        let input = ctx.input(std::clone::Clone::clone);
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
            // We *also* clear the in-memory `streaming` state right away so
            // the UI stops showing the spinner even before the runtime
            // emits its `StreamError` event.
            let active: Vec<uuid::Uuid> = self
                .streaming
                .iter()
                .filter(|(_, st)| st.active)
                .map(|(id, _)| *id)
                .collect();
            for id in active {
                self.streaming.remove(&id);
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::CancelConversation(id));
            }
        }

        // Tray menu events: show/hide/quit/...
        match crate::tray::poll_events(ctx, &mut self.window_visible) {
            Some(crate::tray::TrayAction::Quit) => {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }
            Some(crate::tray::TrayAction::NewChat) => {
                self.navigate(Page::Chat);
            }
            Some(crate::tray::TrayAction::Knowledge) => {
                self.navigate(Page::Rag);
            }
            Some(crate::tray::TrayAction::Backup) => {
                let _ = self.runtime.tx.send(crate::runtime::Command::ExportBackup);
            }
            Some(crate::tray::TrayAction::Show | crate::tray::TrayAction::Hide) | None => {}
        }

        // Intercept close when tray is active: hide instead of quitting.
        let close_requested = ctx.input(|i| i.viewport().close_requested());
        if close_requested && self.tray.is_some() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            ctx.send_viewport_cmd(egui::ViewportCommand::Visible(false));
            self.window_visible = false;
        }

        self.drain_events(ctx);

        // subtle gradient background (Bug #3 — 缓存避免每帧 64 paints)
        if self.window_visible {
            paint_gradient_bg(ctx, &self.theme, &mut self.ui_state);
        }

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
                            Page::Students => crate::ui::students::show(self, ui),
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

        // PII Shield dialogs (initialize / unlock / view mappings).
        // Always drawn on top of every page so the user can unlock
        // from anywhere.
        crate::ui::pii_dialog::show(self, ctx);

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

fn paint_gradient_bg(ctx: &Context, theme: &Theme, ui_state: &mut crate::ui::UiState) {
    let rect = ctx.screen_rect();
    let painter = ctx.layer_painter(egui::LayerId::background());
    // Bug #3 — 缓存键：尺寸或主题变 → 重画；否则只画一个混合背景矩形。
    let key = crate::ui::GradCacheKey {
        w: rect.width() as i32,
        h: rect.height() as i32,
        dark: theme.dark,
    };
    if ui_state.grad_bg_cache_key != Some(key) {
        let steps = 16;
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
        ui_state.grad_bg_cache_key = Some(key);
        ui_state.grad_bg_cache_size = (rect.width(), rect.height());
    } else {
        // 命中缓存：只画 2 个大矩形 (顶/底色)，保留视觉一致但成本 < 1% 原开销。
        let top = theme.bg_gradient_from;
        let bot = theme.bg_gradient_to;
        let mid = Theme::lerp(top, bot, 0.5);
        painter.rect_filled(
            egui::Rect::from_min_max(rect.min, egui::pos2(rect.max.x, rect.center().y)),
            0.0,
            top,
        );
        painter.rect_filled(
            egui::Rect::from_min_max(egui::pos2(rect.min.x, rect.center().y), rect.max),
            0.0,
            Theme::lerp(mid, bot, 0.5),
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
    // Bug #11 — CJK 字体回退：除了已知的固定路径外，
    // 1) 扫描常见字体目录里的中文字体（NotoSans* / *CJK* / simhei / simsun / msyh* 等）
    // 2) 优先用项目自带的 assets/fonts/NotoSansSC-Regular.otf（如有）
    // 3) 若仍找不到，向 stderr 输出一条可观测的提示，方便诊断。
    let mut candidates: Vec<std::path::PathBuf> = vec![
        // 项目自带的打包字体（用户可放 assets/fonts/NotoSansSC-Regular.otf）
        std::path::PathBuf::from("assets/fonts/NotoSansSC-Regular.otf"),
        std::path::PathBuf::from("assets/fonts/NotoSansCJK-Regular.ttc"),
    ];
    // Linux
    candidates.extend(
        [
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
            "/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf",
            "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc",
            "/usr/share/fonts/wenquanyi/wqy-zenhei/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        ]
        .iter()
        .map(std::path::PathBuf::from),
    );
    // macOS
    candidates.extend(
        [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/STHeiti Medium.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/Library/Fonts/Songti.ttc",
        ]
        .iter()
        .map(std::path::PathBuf::from),
    );
    // Windows
    candidates.extend(
        [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/msyh.ttf",
            "C:/Windows/Fonts/msyhbd.ttc",
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/simsun.ttc",
            "C:/Windows/Fonts/simsunb.ttf",
            "C:/Windows/Fonts/simkai.ttf",
            "C:/Windows/Fonts/simfang.ttf",
        ]
        .iter()
        .map(std::path::PathBuf::from),
    );
    // 递归扫描常见字体目录，匹配中文字体文件名。
    for dir in &[
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        "/System/Library/Fonts",
        "/Library/Fonts",
        "C:/Windows/Fonts",
    ] {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                let p = e.path();
                if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                    let lower = name.to_ascii_lowercase();
                    let is_cjk = lower.contains("cjk")
                        || lower.contains("notosanssc")
                        || lower.contains("notosansc")
                        || lower.starts_with("msyh")
                        || lower.starts_with("simhei")
                        || lower.starts_with("simsun")
                        || lower.starts_with("simkai")
                        || lower.starts_with("simfang")
                        || lower.contains("pingfang")
                        || lower.contains("wqy")
                        || lower.contains("hiraginosansgb");
                    if is_cjk {
                        candidates.push(p);
                    }
                }
            }
        }
    }
    let mut installed = false;
    'outer: for path in &candidates {
        if let Ok(data) = std::fs::read(path) {
            fonts
                .font_data
                .insert("cjk".into(), egui::FontData::from_owned(data));
            // 把 cjk 放在 Proportional 家族最前面作为优先 fallback。
            let prop = fonts
                .families
                .entry(egui::FontFamily::Proportional)
                .or_default();
            if !prop.contains(&"cjk".into()) {
                prop.insert(0, "cjk".into());
            }
            let mono = fonts
                .families
                .entry(egui::FontFamily::Monospace)
                .or_default();
            if !mono.contains(&"cjk".into()) {
                mono.push("cjk".into());
            }
            installed = true;
            break 'outer;
        }
    }
    if !installed {
        eprintln!(
            "[fonts] 未找到任何 CJK 字体；中文/日文/韩文将无法正确渲染。\n\
             请在以下任一位置放置 NotoSansSC 或同等 CJK 字体：\n  - assets/fonts/NotoSansSC-Regular.otf\n  - C:/Windows/Fonts/msyh.ttc\n  - /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
        );
    }
    ctx.set_fonts(fonts);
}
