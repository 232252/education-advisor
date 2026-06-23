//! The application root: owns all UI state, the runtime handle, theme, and the
//! event pump that drains background results into iced's update loop.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use iced::widget::{column, container, row, scrollable, text};
use iced::{Alignment, Background, Degrees, Element, Font, Gradient, Length, Subscription, Task};
use iced::gradient;
use parking_lot::RwLock;
use uuid::Uuid;

use crate::models::{
    Conversation, DashboardStats, LlmProvider, Message as ChatMessage, Role, ScheduledTask,
    Settings, Student, ThemeMode, ToolCallRecord,
};
use crate::privacy::Cipher;
use crate::runtime::{Event, RuntimeHandle, ToastKind};
use crate::theme::Theme;
use crate::ui;

/// CJK font family loaded at startup.
pub const CJK_FONT: Font = Font::with_name("Noto Sans SC");

/// Top-level navigation targets.
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
    pub const fn icon(self) -> &'static str {
        match self {
            Self::Dashboard => "◎",
            Self::Chat => "✉",
            Self::Students => "☺",
            Self::Agents => "⚙",
            Self::AgentHistory => "⌚",
            Self::Models => "◆",
            Self::Skills => "★",
            Self::Scheduler => "⏰",
            Self::Rag => "📚",
            Self::Privacy => "🔒",
            Self::Settings => "✦",
        }
    }
}

/// A transient toast notification.
#[derive(Clone)]
pub struct Toast {
    pub kind: ToastKind,
    pub msg: String,
    pub born: std::time::Instant,
    pub ttl: Duration,
}

pub struct App {
    pub runtime: RuntimeHandle,
    pub cipher: Cipher,
    pub theme: Theme,
    pub settings: Settings,
    pub page: Page,
    pub sidebar_collapsed: bool,

    // cached domain data
    pub students: Arc<RwLock<Vec<Student>>>,
    pub conversations: Arc<RwLock<Vec<Conversation>>>,
    pub messages: HashMap<Uuid, Vec<ChatMessage>>,
    pub messages_last_used: HashMap<Uuid, u64>,
    pub tasks: Arc<RwLock<Vec<ScheduledTask>>>,
    pub providers: Arc<RwLock<Vec<LlmProvider>>>,
    pub rag_documents: Arc<RwLock<Vec<crate::models::RagDocument>>>,
    pub stats: Arc<RwLock<Option<DashboardStats>>>,

    // streaming state per conversation
    pub streaming: HashMap<Uuid, StreamState>,

    // UI-local state
    pub toasts: Vec<Toast>,
    pub selected_student: Option<Uuid>,
    pub selected_conversation: Option<Uuid>,
    pub active_agent: String,
    pub chat_input: String,

    // page-local state
    pub ui_state: ui::UiState,

    // PII Shield
    pub pii: parking_lot::Mutex<crate::pii_shield::PrivacyEngine>,
}

#[derive(Clone)]
pub struct StreamState {
    pub current_message_id: Option<Uuid>,
    pub buffer: String,
    pub tool_calls: Vec<ToolCallRecord>,
    pub active: bool,
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

const STREAM_ZOMBIE_TTL: Duration = Duration::from_secs(60);
const MESSAGES_LRU_CAP: usize = 20;
const MESSAGES_EVICT_BATCH: usize = 5;

static MESSAGES_TICK: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn next_tick() -> u64 {
    MESSAGES_TICK.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

fn enforce_messages_lru(
    map: &mut HashMap<Uuid, Vec<ChatMessage>>,
    last_used: &mut HashMap<Uuid, u64>,
) {
    if map.len() <= MESSAGES_LRU_CAP {
        return;
    }
    last_used.retain(|id, _| map.contains_key(id));
    for id in map.keys() {
        last_used.entry(*id).or_insert(0);
    }
    let mut entries: Vec<(Uuid, u64)> = last_used.iter().map(|(id, t)| (*id, *t)).collect();
    entries.sort_by_key(|(_, t)| *t);
    let target = MESSAGES_LRU_CAP.saturating_sub(MESSAGES_EVICT_BATCH);
    let to_evict = map.len().saturating_sub(target);
    for (id, _) in entries.iter().take(to_evict) {
        map.remove(id);
        last_used.remove(id);
    }
}

/// All messages handled by the iced update loop.
#[derive(Debug, Clone)]
pub enum Message {
    // Navigation
    Navigate(Page),
    ToggleSidebar,
    ToggleTheme,
    // Chat
    ChatInputChanged(String),
    SendChat,
    NewConversation,
    NewConversationAgentChanged(String),
    NewConversationTitleChanged(String),
    SelectConversation(Uuid),
    DeleteConversation(Uuid),
    CancelGeneration,
    // Students
    StudentFilterChanged(String),
    SelectStudent(Uuid),
    EditStudent(Option<Student>),
    SaveStudent,
    DeleteStudent(Uuid),
    StudentFieldChanged(StudentField),
    AddGrade,
    GradeSubjectChanged(String),
    GradeScoreChanged(String),
    ImportStudents(String),
    ToggleImport,
    StudentDetailTab(usize),
    SaveNotes(Uuid, String),
    // Tasks
    EditTask(Option<ScheduledTask>),
    SaveTask,
    DeleteTask(Uuid),
    RunTaskNow(Uuid),
    TaskFieldChanged(TaskField),
    // Providers
    EditProvider(Option<LlmProvider>),
    SaveProvider,
    DeleteProvider(String),
    ProviderFieldChanged(ProviderField),
    // RAG
    RagQueryChanged(String),
    RagQuery,
    SaveRagDocument(String, String),
    DeleteRagDocument(Uuid),
    RagOpenAddDocument,
    RagCloseAddDocument,
    RagNewTitleChanged(String),
    RagNewContentChanged(String),
    // Settings
    SaveSettings,
    SettingsThemeChanged(ThemeMode),
    SettingsTemperatureChanged(f32),
    SettingsMaxIterChanged(u32),
    SettingsActiveProviderChanged(String),
    ExportBackup,
    ImportBackup,
    // Agents
    SetActiveAgent(String),
    NavigateToChat(uuid::Uuid),
    // PII
    PiiInit(String),
    PiiUnlock(String),
    PiiLock,
    PiiPasswordChanged(String),
    PiiDialogClose,
    PiiOpenUnlock,
    PiiOpenMappings,
    // Runtime events
    Runtime(Event),
    // Tick (for animations / toast cleanup)
    Tick,
    // File dialog results
    BackupSaved(String),
    BackupLoadResult(crate::models::FullBackup),
    // No-op
    None,
}

#[derive(Debug, Clone)]
pub enum StudentField {
    Name(String),
    Gender(String),
    Grade(String),
    Class(String),
    IdNumber(String),
    GuardianName(String),
    GuardianContact(String),
    GuardianRelation(String),
    HomeAddress(String),
    EmergencyContact(String),
    RiskLevel(crate::models::RiskLevel),
    Gpa(f32),
    Notes(String),
    AddTag(String),
    RemoveTag(String),
}

#[derive(Debug, Clone)]
pub enum TaskField {
    Name(String),
    CronExpr(String),
    AgentId(String),
    Prompt(String),
    Enabled(bool),
}

#[derive(Debug, Clone)]
pub enum ProviderField {
    Name(String),
    Kind(crate::models::ProviderKind),
    BaseUrl(String),
    ApiKey(String),
    Model(String),
    Enabled(bool),
}

impl App {
    pub fn new() -> (Self, Task<Message>) {
        let db_path = db_path();

        let settings = if let Ok(db) = crate::db::Db::open(&db_path) {
            db.load_settings().unwrap_or_default()
        } else {
            Settings::default()
        };

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

        // seed initial data loads
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

        let app = Self {
            runtime,
            cipher,
            theme,
            settings: settings.clone(),
            page: Page::Dashboard,
            sidebar_collapsed: settings.sidebar_collapsed,
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
            ui_state: ui::UiState::default(),
            pii: parking_lot::Mutex::new(crate::pii_shield::PrivacyEngine::default()),
        };

        // Load the CJK font on startup.
        let font_task = iced::font::load(include_bytes!("../assets/fonts/NotoSansSC-Regular.otf"))
            .map(|_| Message::None);

        (app, font_task)
    }

    pub fn theme(&self) -> iced::Theme {
        if self.theme.dark {
            iced::Theme::Dark
        } else {
            iced::Theme::Light
        }
    }

    pub fn subscription(&self) -> Subscription<Message> {
        let rx = self.runtime.rx.clone();
        let runtime_sub = Subscription::run_with(
            RuntimeSub(rx),
            runtime_stream,
        );
        let tick = iced::time::every(Duration::from_millis(200)).map(|_| Message::Tick);
        Subscription::batch(vec![runtime_sub, tick])
    }

    pub fn push_toast(&mut self, kind: ToastKind, msg: impl Into<String>) {
        self.toasts.push(Toast {
            kind,
            msg: msg.into(),
            born: std::time::Instant::now(),
            ttl: Duration::from_millis(3500),
        });
        if self.toasts.len() > 5 {
            self.toasts.remove(0);
        }
    }

    pub fn navigate(&mut self, page: Page) {
        self.page = page;
    }

    fn drain_events(&mut self, evt: Event) {
        use Event::*;
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
            }
            StreamToken {
                conversation_id,
                message_id,
                delta,
            } => {
                if let Some(st) = self.streaming.get_mut(&conversation_id) {
                    if st.current_message_id == Some(message_id) {
                        st.buffer.push_str(&delta);
                        st.last_touched = std::time::Instant::now();
                    }
                }
            }
            StreamTool {
                conversation_id,
                message_id,
                call,
            } => {
                if let Some(st) = self.streaming.get_mut(&conversation_id) {
                    if st.current_message_id.is_some() && st.current_message_id != Some(message_id)
                    {
                        return;
                    }
                    st.last_touched = std::time::Instant::now();
                    let key = (message_id, call.name.as_str());
                    let existing_idx = st
                        .tool_calls
                        .iter()
                        .position(|t| (t.message_id, t.name.as_str()) == key);
                    match existing_idx {
                        Some(idx) if call.result.is_empty() => {
                            st.tool_calls[idx] = ToolCallRecord { message_id, ..call };
                        }
                        Some(idx) => {
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
            }
            StreamDone {
                conversation_id,
                message_id,
            } => {
                if let Some(st) = self.streaming.remove(&conversation_id) {
                    let content = st.buffer;
                    let tcs = st.tool_calls;
                    let now = chrono::Utc::now();
                    let msg = ChatMessage {
                        id: message_id,
                        conversation_id,
                        role: Role::Assistant,
                        content,
                        tool_calls: tcs,
                        created_at: now,
                    };
                    self.messages.entry(conversation_id).or_default().push(msg);
                    self.messages_last_used.insert(conversation_id, next_tick());
                }
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::LoadConversations);
            }
            StreamError {
                conversation_id,
                error,
            } => {
                self.streaming.remove(&conversation_id);
                self.push_toast(ToastKind::Error, error);
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
                let default_name = format!(
                    "education-advisor-backup-{}.json",
                    backup.created_at.format("%Y%m%d-%H%M%S")
                );
                let default_name_for_dialog = default_name.clone();
                // Serialize first
                let backup_json = match serde_json::to_string_pretty(&backup) {
                    Ok(s) => s,
                    Err(e) => {
                        self.push_toast(ToastKind::Error, format!("序列化失败: {e}"));
                        return;
                    }
                };
                // Write to default download dir
                let default_path = dirs::download_dir()
                    .unwrap_or_else(|| std::path::PathBuf::from("."))
                    .join(&default_name);
                if let Err(e) = std::fs::write(&default_path, &backup_json) {
                    self.push_toast(ToastKind::Error, format!("默认路径写入失败: {e}"));
                } else {
                    self.push_toast(
                        ToastKind::Success,
                        format!("备份已保存到 {}", default_path.display()),
                    );
                }
                // Also open save dialog; if user picks a path, write there too
                let backup_json_for_dialog = backup_json.clone();
                let _ = Task::perform(
                    async move {
                        rfd::AsyncFileDialog::new()
                            .set_file_name(&default_name_for_dialog)
                            .add_filter("JSON", &["json"])
                            .save_file()
                            .await
                    },
                    move |path| {
                        if let Some(p) = path {
                            let path_str = p.path().to_string_lossy().to_string();
                            let _ = std::fs::write(p.path(), &backup_json_for_dialog);
                            Message::BackupSaved(path_str)
                        } else {
                            Message::None
                        }
                    },
                );
            }
            Settings(s) => {
                if s != self.settings {
                    self.settings = s;
                    self.theme = match self.settings.theme {
                        ThemeMode::Dark => Theme::dark(),
                        ThemeMode::Light => Theme::light(),
                    };
                }
            }
            Toast { kind, msg } => self.push_toast(kind, msg),
        }
    }

    pub fn update(&mut self, msg: Message) -> Task<Message> {
        match msg {
            Message::None => {}
            Message::SetActiveAgent(id) => {
                self.active_agent = id;
                self.push_toast(crate::runtime::ToastKind::Info, "已切换活跃代理".to_string());
            }
            Message::NavigateToChat(conv_id) => {
                self.page = Page::Chat;
                self.selected_conversation = Some(conv_id);
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::LoadMessages(conv_id));
            }
            Message::Tick => {
                // Clean up zombie streaming entries
                self.streaming
                    .retain(|_, st| st.last_touched.elapsed() < STREAM_ZOMBIE_TTL);
                enforce_messages_lru(&mut self.messages, &mut self.messages_last_used);
                // Purge expired toasts
                let now = std::time::Instant::now();
                self.toasts.retain(|t| now.duration_since(t.born) < t.ttl);
            }
            Message::Navigate(page) => self.navigate(page),
            Message::ToggleSidebar => {
                self.sidebar_collapsed = !self.sidebar_collapsed;
                self.settings.sidebar_collapsed = self.sidebar_collapsed;
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::SaveSettings(self.settings.clone()));
            }
            Message::ToggleTheme => {
                self.settings.theme = match self.settings.theme {
                    ThemeMode::Dark => ThemeMode::Light,
                    ThemeMode::Light => ThemeMode::Dark,
                };
                self.theme = match self.settings.theme {
                    ThemeMode::Dark => Theme::dark(),
                    ThemeMode::Light => Theme::light(),
                };
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::SaveSettings(self.settings.clone()));
            }
            Message::Runtime(evt) => self.drain_events(evt),
            Message::ChatInputChanged(s) => self.chat_input = s,
            Message::SendChat => {
                if let Some(conv_id) = self.selected_conversation {
                    let text = std::mem::take(&mut self.chat_input);
                    if !text.trim().is_empty() {
                        let _ = self.runtime.tx.send(crate::runtime::Command::SendMessage {
                            conversation_id: conv_id,
                            agent_id: self.active_agent.clone(),
                            student_id: None,
                            text,
                        });
                    }
                }
            }
            Message::NewConversation => {
                let agent_id = if self.ui_state.new_conversation_agent.is_empty() {
                    "main".to_string()
                } else {
                    self.ui_state.new_conversation_agent.clone()
                };
                let title = if self.ui_state.new_conversation_title.is_empty() {
                    format!("新对话 · {}", chrono::Local::now().format("%m-%d %H:%M"))
                } else {
                    self.ui_state.new_conversation_title.clone()
                };
                let _ = self.runtime.tx.send(crate::runtime::Command::NewConversation {
                    agent_id,
                    student_id: None,
                    title,
                });
                self.ui_state.new_conversation_title.clear();
            }
            Message::NewConversationAgentChanged(s) => {
                self.ui_state.new_conversation_agent = s;
            }
            Message::NewConversationTitleChanged(s) => {
                self.ui_state.new_conversation_title = s;
            }
            Message::SelectConversation(id) => {
                self.selected_conversation = Some(id);
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::LoadMessages(id));
            }
            Message::DeleteConversation(id) => {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::DeleteConversation(id));
            }
            Message::CancelGeneration => {
                let active: Vec<Uuid> = self
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
            // Students
            Message::StudentFilterChanged(s) => self.ui_state.student_filter = s,
            Message::SelectStudent(id) => {
                self.selected_student = Some(id);
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::LoadGrades(id));
            }
            Message::EditStudent(maybe) => self.ui_state.editing_student = maybe,
            Message::SaveStudent => {
                if let Some(s) = self.ui_state.editing_student.take() {
                    let _ = self
                        .runtime
                        .tx
                        .send(crate::runtime::Command::SaveStudent(s));
                }
            }
            Message::DeleteStudent(id) => {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::DeleteStudent(id));
            }
            Message::StudentFieldChanged(f) => {
                if let Some(s) = &mut self.ui_state.editing_student {
                    match f {
                        StudentField::Name(v) => s.name = v,
                        StudentField::Gender(v) => s.gender = if v.is_empty() { None } else { Some(v) },
                        StudentField::Grade(v) => s.grade = v,
                        StudentField::Class(v) => s.class = v,
                        StudentField::IdNumber(v) => s.id_number = if v.is_empty() { None } else { Some(v) },
                        StudentField::GuardianName(v) => s.guardian_name = if v.is_empty() { None } else { Some(v) },
                        StudentField::GuardianContact(v) => s.guardian_contact = if v.is_empty() { None } else { Some(v) },
                        StudentField::GuardianRelation(v) => s.guardian_relation = if v.is_empty() { None } else { Some(v) },
                        StudentField::HomeAddress(v) => s.home_address = if v.is_empty() { None } else { Some(v) },
                        StudentField::EmergencyContact(v) => s.emergency_contact = if v.is_empty() { None } else { Some(v) },
                        StudentField::RiskLevel(v) => s.risk_level = v,
                        StudentField::Gpa(v) => s.gpa = Some(v),
                        StudentField::Notes(v) => s.notes = if v.is_empty() { None } else { Some(v) },
                        StudentField::AddTag(v) => {
                            if !v.is_empty() && !s.tags.contains(&v) {
                                s.tags.push(v);
                            }
                        }
                        StudentField::RemoveTag(v) => s.tags.retain(|t| t != &v),
                    }
                }
            }
            Message::AddGrade => {
                if let Some(id) = self.selected_student {
                    let subject = self.ui_state.new_grade_subject.clone();
                    let score_str = self.ui_state.new_grade_score.clone();
                    if let Ok(score) = score_str.parse::<f32>() {
                        let g = crate::models::GradeEntry {
                            id: Uuid::new_v4(),
                            student_id: id,
                            subject,
                            score,
                            max_score: 100.0,
                            exam_date: chrono::Local::now().date_naive(),
                            recorded_at: chrono::Utc::now(),
                        };
                        let _ = self.runtime.tx.send(crate::runtime::Command::AddGrade(g));
                        self.ui_state.new_grade_subject.clear();
                        self.ui_state.new_grade_score.clear();
                    }
                }
            }
            Message::GradeSubjectChanged(s) => self.ui_state.new_grade_subject = s,
            Message::GradeScoreChanged(s) => self.ui_state.new_grade_score = s,
            Message::ImportStudents(content) => {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::ImportStudentsCsv(content));
                self.ui_state.show_import = false;
            }
            Message::ToggleImport => {
                self.ui_state.show_import = !self.ui_state.show_import;
            }
            Message::StudentDetailTab(tab) => self.ui_state.student_detail_tab = tab,
            Message::SaveNotes(id, notes) => {
                if let Some(s) = self.students.write().iter_mut().find(|s| s.id == id) {
                    s.notes = if notes.is_empty() { None } else { Some(notes.clone()) };
                    s.notes_modified_at = Some(chrono::Utc::now());
                    let clone = s.clone();
                    let _ = self
                        .runtime
                        .tx
                        .send(crate::runtime::Command::SaveStudent(clone));
                }
            }
            // Tasks
            Message::EditTask(maybe) => self.ui_state.editing_task = maybe,
            Message::SaveTask => {
                if let Some(t) = self.ui_state.editing_task.take() {
                    let _ = self.runtime.tx.send(crate::runtime::Command::SaveTask(t));
                }
            }
            Message::DeleteTask(id) => {
                let _ = self.runtime.tx.send(crate::runtime::Command::DeleteTask(id));
            }
            Message::RunTaskNow(id) => {
                let _ = self.runtime.tx.send(crate::runtime::Command::RunTaskNow(id));
            }
            Message::TaskFieldChanged(f) => {
                if let Some(t) = &mut self.ui_state.editing_task {
                    match f {
                        TaskField::Name(v) => t.name = v,
                        TaskField::CronExpr(v) => t.cron_expr = v,
                        TaskField::AgentId(v) => t.agent_id = v,
                        TaskField::Prompt(v) => t.prompt = v,
                        TaskField::Enabled(v) => t.enabled = v,
                    }
                }
            }
            // Providers
            Message::EditProvider(maybe) => self.ui_state.editing_provider = maybe,
            Message::SaveProvider => {
                if let Some(p) = self.ui_state.editing_provider.take() {
                    let _ = self.runtime.tx.send(crate::runtime::Command::SaveProvider(p));
                }
            }
            Message::DeleteProvider(id) => {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::DeleteProvider(id));
            }
            Message::ProviderFieldChanged(f) => {
                if let Some(p) = &mut self.ui_state.editing_provider {
                    match f {
                        ProviderField::Name(v) => p.name = v,
                        ProviderField::Kind(v) => p.kind = v,
                        ProviderField::BaseUrl(v) => p.base_url = v,
                        ProviderField::ApiKey(v) => p.api_key = if v.is_empty() { None } else { Some(v) },
                        ProviderField::Model(v) => p.model = v,
                        ProviderField::Enabled(v) => p.enabled = v,
                    }
                }
            }
            // RAG
            Message::RagQueryChanged(s) => self.ui_state.rag_query = s,
            Message::RagQuery => {
                let q = self.ui_state.rag_query.clone();
                if !q.is_empty() {
                    let docs = self.rag_documents.read().clone();
                    let hits = crate::embedding::Corpus::from_documents(&docs)
                        .search_text(&q, 5);
                    let results = hits
                        .into_iter()
                        .map(|h| (h.document_id, h.chunk_id, h.score, h.chunk_text))
                        .collect();
                    self.ui_state.rag_results = results;
                }
            }
            Message::SaveRagDocument(title, content) => {
                let doc_id = Uuid::new_v4();
                let chunks: Vec<crate::models::RagChunk> = crate::embedding::chunk_text(&content)
                    .into_iter()
                    .map(|text| {
                        let embedding = crate::embedding::embed_text(&text);
                        crate::models::RagChunk {
                            id: Uuid::new_v4(),
                            document_id: doc_id,
                            text,
                            embedding,
                        }
                    })
                    .collect();
                let doc = crate::models::RagDocument {
                    id: doc_id,
                    title,
                    content: content.clone(),
                    chunks,
                    created_at: chrono::Utc::now(),
                };
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::SaveRagDocument(doc));
            }
            Message::DeleteRagDocument(id) => {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::DeleteRagDocument(id));
            }
            Message::RagOpenAddDocument => {
                self.ui_state.rag_adding_document = true;
                self.ui_state.rag_new_title.clear();
                self.ui_state.rag_new_content.clear();
            }
            Message::RagCloseAddDocument => {
                self.ui_state.rag_adding_document = false;
                self.ui_state.rag_new_title.clear();
                self.ui_state.rag_new_content.clear();
            }
            Message::RagNewTitleChanged(s) => self.ui_state.rag_new_title = s,
            Message::RagNewContentChanged(s) => self.ui_state.rag_new_content = s,
            // Settings
            Message::SaveSettings => {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::SaveSettings(self.settings.clone()));
            }
            Message::SettingsThemeChanged(t) => {
                self.settings.theme = t;
                self.theme = match t {
                    ThemeMode::Dark => Theme::dark(),
                    ThemeMode::Light => Theme::light(),
                };
            }
            Message::SettingsTemperatureChanged(v) => self.settings.temperature = v,
            Message::SettingsMaxIterChanged(v) => self.settings.max_tool_iterations = v,
            Message::SettingsActiveProviderChanged(id) => {
                self.settings.active_provider_id = Some(id);
            }
            Message::ExportBackup => {
                let _ = self.runtime.tx.send(crate::runtime::Command::ExportBackup);
            }
            Message::ImportBackup => {
                // Open file dialog in a background task
                return Task::perform(
                    async {
                        rfd::AsyncFileDialog::new()
                            .add_filter("JSON", &["json"])
                            .pick_file()
                            .await
                    },
                    |path| match path {
                        Some(p) => {
                            let path = p.path().to_path_buf();
                            match std::fs::read_to_string(&path) {
                                Ok(s) => match serde_json::from_str::<crate::models::FullBackup>(&s) {
                                    Ok(b) => Message::BackupLoadResult(b),
                                    Err(e) => Message::None,
                                },
                                Err(_) => Message::None,
                            }
                        }
                        None => Message::None,
                    },
                );
            }
            Message::BackupSaved(path) => {
                self.push_toast(ToastKind::Success, format!("备份已保存到 {path}"));
            }
            Message::BackupLoadResult(backup) => {
                let _ = self
                    .runtime
                    .tx
                    .send(crate::runtime::Command::ImportBackup(backup));
            }
            // PII
            Message::PiiInit(pass) => {
                if pass.is_empty() {
                    self.ui_state.pii_dialog.last_error = Some("请输入密码".into());
                    self.ui_state.pii_dialog.last_info = None;
                } else {
                    let dir = self
                        .ui_state
                        .pii_dialog
                        .data_dir
                        .clone()
                        .unwrap_or_else(|| {
                            let mut p =
                                dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
                            p.push("education-advisor");
                            p
                        });
                    let (result, count) = {
                        let mut pii = self.pii.lock();
                        let result = pii.init(&dir, &pass);
                        let count = if result.is_ok() { pii.mapping_count() } else { 0 };
                        (result, count)
                    };
                    match result {
                        Ok(()) => {
                            self.ui_state.pii_dialog.last_error = None;
                            self.ui_state.pii_dialog.last_info =
                                Some(format!("成功：已初始化（{count} 条映射）"));
                            self.push_toast(ToastKind::Success, "PII Shield 已初始化");
                        }
                        Err(e) => {
                            self.ui_state.pii_dialog.last_error = Some(format!("{e}"));
                            self.ui_state.pii_dialog.last_info = None;
                            self.push_toast(ToastKind::Error, format!("初始化失败: {e}"));
                        }
                    }
                    self.ui_state.pii_dialog.password.clear();
                }
            }
            Message::PiiUnlock(pass) => {
                if pass.is_empty() {
                    self.ui_state.pii_dialog.last_error = Some("请输入密码".into());
                    self.ui_state.pii_dialog.last_info = None;
                } else {
                    let dir = self
                        .ui_state
                        .pii_dialog
                        .data_dir
                        .clone()
                        .unwrap_or_else(|| {
                            let mut p =
                                dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
                            p.push("education-advisor");
                            p
                        });
                    let (result, count) = {
                        let mut pii = self.pii.lock();
                        let result = pii.load(&dir, &pass);
                        let count = if result.is_ok() { pii.mapping_count() } else { 0 };
                        (result, count)
                    };
                    match result {
                        Ok(()) => {
                            self.ui_state.pii_dialog.last_error = None;
                            self.ui_state.pii_dialog.last_info =
                                Some(format!("成功：已加载 {count} 条映射"));
                            self.push_toast(ToastKind::Success, "PII Shield 已解锁");
                        }
                        Err(e) => {
                            self.ui_state.pii_dialog.last_error = Some(format!("{e}"));
                            self.ui_state.pii_dialog.last_info = None;
                            self.push_toast(ToastKind::Error, format!("解锁失败: {e}"));
                        }
                    }
                    self.ui_state.pii_dialog.password.clear();
                }
            }
            Message::PiiLock => {
                {
                    let mut pii = self.pii.lock();
                    pii.set_enabled(false);
                }
                self.push_toast(ToastKind::Info, "PII Shield 已锁定");
            }
            Message::PiiPasswordChanged(s) => {
                self.ui_state.pii_dialog.password = s;
            }
            Message::PiiDialogClose => {
                self.ui_state.pii_dialog.close();
                self.ui_state.pii_dialog.password.clear();
            }
            Message::PiiOpenUnlock => {
                self.ui_state.pii_dialog.open_unlock();
            }
            Message::PiiOpenMappings => {
                self.ui_state.pii_dialog.open_mappings();
            }
        }
        Task::none()
    }

    pub fn view(&self) -> Element<Message> {
        let theme = &self.theme;

        let topbar = ui::topbar::view(self);

        let sidebar = ui::sidebar::view(self);

        let content = scrollable(
            container(self.view_page())
                .padding(16)
                .width(Length::Fill)
                .height(Length::Fill),
        )
        .width(Length::Fill)
        .height(Length::Fill)
        .style(move |_, _| ui::style::scrollable(theme));

        let bg_gradient = Gradient::Linear(gradient::Linear::new(Degrees(180.0))
            .add_stop(0.0, theme.bg_gradient_from)
            .add_stop(1.0, theme.bg_gradient_to));

        let body = container(
            row![sidebar, content]
                .width(Length::Fill)
                .height(Length::Fill)
                .align_y(Alignment::Start),
        )
        .width(Length::Fill)
        .height(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(Background::Gradient(bg_gradient.clone())),
            ..Default::default()
        });

        let toasts = ui::toast::view(self);

        let main_stack = column![topbar, body, toasts]
            .width(Length::Fill)
            .height(Length::Fill);

        // PII Shield dialog overlay (modal) — use iced::widget::Stack for proper overlay
        if let Some(dialog) = ui::pii_dialog::view(self) {
            iced::widget::Stack::new()
                .push(main_stack)
                .push(
                    container(dialog)
                        .width(Length::Fill)
                        .height(Length::Fill)
                        .center_x(Length::Fill)
                        .center_y(Length::Fill)
                        .style(move |_: &iced::Theme| iced::widget::container::Style {
                            background: Some(iced::Background::Color(iced::Color {
                                a: 0.5,
                                ..iced::Color::BLACK
                            })),
                            ..Default::default()
                        }),
                )
                .into()
        } else {
            main_stack.into()
        }
    }

    fn view_page(&self) -> Element<Message> {
        match self.page {
            Page::Dashboard => ui::dashboard::view(self),
            Page::Students => ui::students::view(self),
            Page::Agents => ui::agents_page::view(self),
            Page::AgentHistory => ui::agent_history_page::view(self),
            Page::Chat => ui::chat::view(self),
            Page::Scheduler => ui::scheduler_page::view(self),
            Page::Rag => ui::rag_page::view(self),
            Page::Models => ui::models_page::view(self),
            Page::Skills => ui::skills_page::view(self),
            Page::Privacy => ui::privacy_page::view(self),
            Page::Settings => ui::settings_page::view(self),
        }
    }
}

fn db_path() -> std::path::PathBuf {
    let mut p = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    p.push("education-advisor");
    let _ = std::fs::create_dir_all(&p);
    p.push("ea.db");
    p
}

/// Wrapper around the runtime receiver so it can be used as the `data`
/// argument of [`Subscription::run_with`]. The `Hash` implementation uses a
/// fixed identifier so every call produces the same subscription id (matching
/// the behaviour of the previous `run_with_id("runtime", …)` call).
struct RuntimeSub(crossbeam_channel::Receiver<Event>);

impl Hash for RuntimeSub {
    fn hash<H: Hasher>(&self, state: &mut H) {
        "runtime".hash(state);
    }
}

/// Builds the runtime event stream for [`Subscription::run_with`].
fn runtime_stream(
    data: &RuntimeSub,
) -> impl futures_util::Stream<Item = Message> {
    let rx = data.0.clone();
    stream::unfold(rx, |rx| async move {
        loop {
            match rx.try_recv() {
                Ok(evt) => return Some((Message::Runtime(evt), rx)),
                Err(crossbeam_channel::TryRecvError::Empty) => {
                    tokio::time::sleep(Duration::from_millis(16)).await;
                }
                Err(crossbeam_channel::TryRecvError::Disconnected) => {
                    return None;
                }
            }
        }
    })
}
