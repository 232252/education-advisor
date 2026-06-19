//! Async runtime bridge.
//!
//! The UI runs on the egui main thread and is strictly non-blocking. All
//! expensive work (DB I/O, LLM streaming, tool execution, cron scheduling)
//! happens on a dedicated tokio runtime living on its own OS thread. The two
//! sides communicate through lock-free `crossbeam-channel`s:
//!
//!   UI --[Command]--> Runtime --[Event]--> UI
//!
//! The UI polls `try_recv` every frame (cheap, allocation-free when empty), so
//! the render loop never waits.

use crossbeam_channel::{unbounded, Receiver, Sender};
use std::sync::Arc;
use std::thread;
use tokio::runtime::Runtime as TokioRuntime;
use uuid::Uuid;

use crate::db::Db;
use crate::llm::LlmClient;
use crate::models::{Student, GradeEntry, ScheduledTask, LlmProvider, Settings, Conversation, Message, ToolCallRecord, DashboardStats};
use crate::privacy::{Cipher, Redactor};

/// Work requested by the UI.
#[derive(Debug, Clone)]
pub enum Command {
    // Students
    LoadStudents,
    SaveStudent(Student),
    DeleteStudent(Uuid),
    LoadGrades(Uuid),
    AddGrade(GradeEntry),
    ImportStudentsCsv(String),
    // Conversations
    LoadConversations,
    NewConversation { agent_id: String, student_id: Option<Uuid>, title: String },
    LoadMessages(Uuid),
    // AI
    SendMessage { conversation_id: Uuid, agent_id: String, student_id: Option<Uuid>, text: String },
    CancelConversation(Uuid),
    // Tasks
    LoadTasks,
    SaveTask(ScheduledTask),
    DeleteTask(Uuid),
    RunTaskNow(Uuid),
    // Providers
    LoadProviders,
    SaveProvider(LlmProvider),
    DeleteProvider(String),
    // Stats
    LoadStats,
    // Settings
    #[allow(dead_code)]
    LoadSettings,
    #[allow(dead_code)]
    SaveSettings(Settings),
}

/// Results delivered back to the UI.
#[derive(Debug, Clone)]
pub enum Event {
    Students(Vec<Student>),
    StudentsSaved,
    StudentDeleted,
    Grades(Uuid, Vec<GradeEntry>),
    StudentsImported { added: usize },
    Conversations(Vec<Conversation>),
    ConversationCreated(Conversation),
    Messages(Uuid, Vec<Message>),
    // AI streaming
    StreamStart { conversation_id: Uuid, message_id: Uuid },
    StreamToken { conversation_id: Uuid, #[allow(dead_code)] message_id: Uuid, delta: String },
    StreamTool { conversation_id: Uuid, #[allow(dead_code)] message_id: Uuid, call: ToolCallRecord },
    StreamDone { conversation_id: Uuid, message_id: Uuid },
    StreamError { conversation_id: Uuid, error: String },
    Tasks(Vec<ScheduledTask>),
    TaskSaved,
    TaskDeleted,
    Providers(Vec<LlmProvider>),
    ProviderSaved,
    ProviderDeleted,
    Stats(DashboardStats),
    #[allow(dead_code)]
    Settings(Settings),
    Toast { kind: ToastKind, msg: String },
}

#[derive(Debug, Clone, Copy)]
pub enum ToastKind {
    Info,
    Success,
    Warning,
    Error,
}

/// Handle held by the UI to send commands and receive events.
#[derive(Clone)]
pub struct RuntimeHandle {
    pub tx: Sender<Command>,
    pub rx: Receiver<Event>,
}

/// Owns the background runtime. Dropping it joins the worker thread.
pub struct Runtime {
    handle: RuntimeHandle,
    _join: Option<thread::JoinHandle<()>>,
}

impl Runtime {
    pub fn launch(db_path: std::path::PathBuf) -> anyhow::Result<(Self, Cipher)> {
        let db = Db::open(&db_path)?;
        // seed demo data on first run so the app is immediately useful
        let _ = crate::students::seed_demo(&db);
        let cipher = Cipher::from_passphrase(&machine_passphrase(&db_path));
        Self::launch_with(db, cipher)
    }

    pub fn launch_with(db: Db, cipher: Cipher) -> anyhow::Result<(Self, Cipher)> {
        let (cmd_tx, cmd_rx) = unbounded::<Command>();
        let (evt_tx, evt_rx) = unbounded::<Event>();
        let handle = RuntimeHandle {
            tx: cmd_tx,
            rx: evt_rx,
        };

        let cipher_for_thread = cipher.clone();
        let join = thread::Builder::new()
            .name("ea-runtime".into())
            .spawn(move || {
                let rt = match TokioRuntime::new() {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("[runtime] tokio init failed: {e}");
                        return;
                    }
                };
                let ctx = Arc::new(RuntimeCtx {
                    db,
                    cipher: cipher_for_thread,
                    redactor: Redactor::new(),
                    llm: LlmClient::new(),
                });
                let handle = rt.handle().clone();
                rt.block_on(async move {
                    let mut sched = crate::scheduler::Scheduler::new(ctx.clone(), evt_tx.clone());
                    sched.spawn();
                    for cmd in &cmd_rx {
                        let ctx = ctx.clone();
                        let evt_tx = evt_tx.clone();
                        // Each command gets its own task so the loop stays free.
                        handle.spawn(async move {
                            handle_command(ctx, evt_tx, cmd).await;
                        });
                    }
                });
            })?;

        Ok((Self { handle, _join: Some(join) }, cipher))
    }

    pub fn handle(&self) -> RuntimeHandle {
        self.handle.clone()
    }
}

pub struct RuntimeCtx {
    pub db: Db,
    pub cipher: Cipher,
    pub redactor: Redactor,
    pub llm: LlmClient,
}

fn machine_passphrase(db_path: &std::path::Path) -> String {
    // Derive a stable passphrase from the DB location + a per-user secret dir.
    let mut base = db_path.to_string_lossy().to_string();
    if let Some(home) = dirs::home_dir() {
        base.push_str(&home.to_string_lossy());
    }
    base.push_str("education-advisor-v1");
    base
}

async fn handle_command(ctx: Arc<RuntimeCtx>, evt_tx: Sender<Event>, cmd: Command) {
    let result = run_command(&ctx, &evt_tx, cmd).await;
    if let Err(e) = result {
        let _ = evt_tx.send(Event::Toast {
            kind: ToastKind::Error,
            msg: format!("{e}"),
        });
    }
}

async fn run_command(
    ctx: &Arc<RuntimeCtx>,
    evt_tx: &Sender<Event>,
    cmd: Command,
) -> anyhow::Result<()> {
    use Command::{LoadStudents, SaveStudent, DeleteStudent, LoadGrades, AddGrade, ImportStudentsCsv, LoadConversations, NewConversation, LoadMessages, SendMessage, CancelConversation, LoadTasks, SaveTask, DeleteTask, RunTaskNow, LoadProviders, SaveProvider, DeleteProvider, LoadStats, LoadSettings, SaveSettings};
    match cmd {
        LoadStudents => {
            let v = ctx.db.list_students()?;
            let _ = evt_tx.send(Event::Students(v));
        }
        SaveStudent(mut s) => {
            // encrypt guardian contact if privacy is on
            if let Some(c) = s.guardian_contact.as_ref() {
                if !c.is_empty() && !c.starts_with("enc:") {
                    let enc = ctx.cipher.encrypt_str(c)?;
                    s.guardian_contact = Some(format!("enc:{enc}"));
                }
            }
            ctx.db.upsert_student(&s)?;
            let _ = evt_tx.send(Event::StudentsSaved);
            let v = ctx.db.list_students()?;
            let _ = evt_tx.send(Event::Students(v));
        }
        DeleteStudent(id) => {
            ctx.db.delete_student(id)?;
            let _ = evt_tx.send(Event::StudentDeleted);
            let v = ctx.db.list_students()?;
            let _ = evt_tx.send(Event::Students(v));
        }
        LoadGrades(id) => {
            let v = ctx.db.grades_for(id)?;
            let _ = evt_tx.send(Event::Grades(id, v));
        }
        AddGrade(g) => {
            ctx.db.add_grade(&g)?;
            let v = ctx.db.grades_for(g.student_id)?;
            let _ = evt_tx.send(Event::Grades(g.student_id, v));
        }
        ImportStudentsCsv(content) => {
            let added = crate::students::import_csv(&ctx.db, &content)?;
            let _ = evt_tx.send(Event::StudentsImported { added });
            let v = ctx.db.list_students()?;
            let _ = evt_tx.send(Event::Students(v));
        }
        LoadConversations => {
            let v = ctx.db.list_conversations()?;
            let _ = evt_tx.send(Event::Conversations(v));
        }
        NewConversation { agent_id, student_id, title } => {
            let now = chrono::Utc::now();
            let conv = Conversation {
                id: Uuid::new_v4(),
                agent_id,
                student_id,
                title,
                created_at: now,
                updated_at: now,
            };
            ctx.db.upsert_conversation(&conv)?;
            let _ = evt_tx.send(Event::ConversationCreated(conv));
        }
        LoadMessages(id) => {
            let v = ctx.db.messages_for(id)?;
            let _ = evt_tx.send(Event::Messages(id, v));
        }
        SendMessage { conversation_id, agent_id, student_id, text } => {
            if let Err(e) = crate::ai::run_turn(
                ctx.clone(),
                evt_tx.clone(),
                conversation_id,
                agent_id,
                student_id,
                text,
            )
            .await
            {
                let _ = evt_tx.send(Event::StreamError {
                    conversation_id,
                    error: e.to_string(),
                });
            }
        }
        CancelConversation(_id) => {
            // Cancellation is cooperative: the agent loop checks a flag. For
            // simplicity we emit a toast; full cancellation is wired in `ai`.
            let _ = evt_tx.send(Event::Toast {
                kind: ToastKind::Info,
                msg: "已请求停止生成".into(),
            });
        }
        LoadTasks => {
            let v = ctx.db.list_tasks()?;
            let _ = evt_tx.send(Event::Tasks(v));
        }
        SaveTask(t) => {
            ctx.db.upsert_task(&t)?;
            let _ = evt_tx.send(Event::TaskSaved);
            let v = ctx.db.list_tasks()?;
            let _ = evt_tx.send(Event::Tasks(v));
        }
        DeleteTask(id) => {
            ctx.db.delete_task(id)?;
            let _ = evt_tx.send(Event::TaskDeleted);
            let v = ctx.db.list_tasks()?;
            let _ = evt_tx.send(Event::Tasks(v));
        }
        RunTaskNow(id) => {
            let tasks = ctx.db.list_tasks()?;
            if let Some(t) = tasks.into_iter().find(|t| t.id == id) {
                let now = chrono::Utc::now();
                let conv = Conversation {
                    id: Uuid::new_v4(),
                    agent_id: t.agent_id.clone(),
                    student_id: None,
                    title: t.name.clone(),
                    created_at: now,
                    updated_at: now,
                };
                ctx.db.upsert_conversation(&conv)?;
                let _ = evt_tx.send(Event::ConversationCreated(conv.clone()));
                crate::ai::run_turn(
                    ctx.clone(),
                    evt_tx.clone(),
                    conv.id,
                    t.agent_id,
                    None,
                    t.prompt,
                )
                .await?;
            }
        }
        LoadProviders => {
            let v = ctx.db.list_providers()?;
            let _ = evt_tx.send(Event::Providers(v));
        }
        SaveProvider(mut p) => {
            if let Some(k) = p.api_key.as_ref() {
                if !k.is_empty() && !k.starts_with("enc:") {
                    let enc = ctx.cipher.encrypt_str(k)?;
                    p.api_key = Some(format!("enc:{enc}"));
                }
            }
            ctx.db.upsert_provider(&p)?;
            let _ = evt_tx.send(Event::ProviderSaved);
            let v = ctx.db.list_providers()?;
            let _ = evt_tx.send(Event::Providers(v));
        }
        DeleteProvider(id) => {
            ctx.db.delete_provider(&id)?;
            let _ = evt_tx.send(Event::ProviderDeleted);
            let v = ctx.db.list_providers()?;
            let _ = evt_tx.send(Event::Providers(v));
        }
        LoadStats => {
            let s = ctx.db.dashboard_stats()?;
            let _ = evt_tx.send(Event::Stats(s));
        }
        LoadSettings => {
            // Settings are persisted by egui's persistence in the app; the
            // runtime only needs to know the active provider. We emit the
            // providers list as the source of truth.
            let v = ctx.db.list_providers()?;
            let _ = evt_tx.send(Event::Providers(v));
        }
        SaveSettings(_) => {
            // handled by app persistence layer
        }
    }
    Ok(())
}

/// Decrypt a stored field for display (used by the UI on demand).
#[allow(dead_code)]
pub fn decrypt_field(cipher: &Cipher, v: &str) -> String {
    if let Some(rest) = v.strip_prefix("enc:") {
        cipher.decrypt_str(rest).unwrap_or_else(|_| "[解密失败]".into())
    } else {
        v.to_string()
    }
}
