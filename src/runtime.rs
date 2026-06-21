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
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use std::thread;
use tokio::runtime::Runtime as TokioRuntime;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::db::Db;
use crate::llm::LlmClient;
use crate::models::{
    Conversation, DashboardStats, GradeEntry, LlmProvider, Message, RagDocument, ScheduledTask,
    Settings, Student, ToolCallRecord,
};
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
    NewConversation {
        agent_id: String,
        student_id: Option<Uuid>,
        title: String,
    },
    LoadMessages(Uuid),
    DeleteConversation(Uuid),
    // AI
    SendMessage {
        conversation_id: Uuid,
        agent_id: String,
        student_id: Option<Uuid>,
        text: String,
    },
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
    // RAG
    LoadRagDocuments,
    SaveRagDocument(RagDocument),
    DeleteRagDocument(Uuid),
    // Stats
    LoadStats,
    // Settings
    LoadSettings,
    SaveSettings(Settings),
    // Backup / restore
    ExportBackup,
    ImportBackup(crate::models::FullBackup),
}

/// Results delivered back to the UI.
#[derive(Debug, Clone)]
pub enum Event {
    Students(Vec<Student>),
    StudentsSaved,
    StudentDeleted,
    Grades(Uuid, Vec<GradeEntry>),
    StudentsImported {
        added: usize,
    },
    Conversations(Vec<Conversation>),
    ConversationCreated(Conversation),
    ConversationDeleted,
    Messages(Uuid, Vec<Message>),
    // AI streaming
    StreamStart {
        conversation_id: Uuid,
        message_id: Uuid,
    },
    StreamToken {
        conversation_id: Uuid,
        message_id: Uuid,
        delta: String,
    },
    StreamTool {
        conversation_id: Uuid,
        message_id: Uuid,
        call: ToolCallRecord,
    },
    StreamDone {
        conversation_id: Uuid,
        message_id: Uuid,
    },
    StreamError {
        conversation_id: Uuid,
        error: String,
    },
    Tasks(Vec<ScheduledTask>),
    TaskSaved,
    TaskDeleted,
    Providers(Vec<LlmProvider>),
    ProviderSaved,
    ProviderDeleted,
    RagDocuments(Vec<RagDocument>),
    RagDocumentSaved,
    RagDocumentDeleted,
    Stats(DashboardStats),
    BackupReady(crate::models::FullBackup),
    Settings(Settings),
    Toast {
        kind: ToastKind,
        msg: String,
    },
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
        // Derive the master key from a random per-install salt so an
        // attacker who copies just the database file can't reuse a public
        // passphrase to decrypt sensitive columns.
        let data_dir = db_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."));
        let salt = crate::privacy::load_or_create_salt(data_dir)?;
        let cipher = Cipher::from_passphrase(&machine_passphrase(&db_path), &salt);
        let audit = db_path
            .parent()
            .and_then(|p| crate::audit::AuditLog::open(p).ok())
            .map(std::sync::Arc::new);
        Self::launch_with(db, cipher, audit)
    }

    pub fn launch_with(
        db: Db,
        cipher: Cipher,
        audit: Option<std::sync::Arc<crate::audit::AuditLog>>,
    ) -> anyhow::Result<(Self, Cipher)> {
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
                let settings = db.load_settings().unwrap_or_default();
                // PII Shield: we don't unlock the encrypted mapping at
                // startup (it needs a password the user types in).
                // The engine stays in `enabled = false` state until
                // the user unlocks it via the Privacy page.
                let pii = parking_lot::Mutex::new(crate::pii_shield::PrivacyEngine::default());
                let ctx = Arc::new(RuntimeCtx {
                    db,
                    cipher: cipher_for_thread,
                    redactor: Redactor::new(),
                    llm: LlmClient::new(),
                    pii,
                    cancel_tokens: RwLock::new(HashMap::new()),
                    settings: RwLock::new(settings),
                    audit,
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

        Ok((
            Self {
                handle,
                _join: Some(join),
            },
            cipher,
        ))
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
    /// PII Shield 假名化引擎（v0.1.0-rc.1 核心隐私功能）。所有
    /// 出站到 LLM 的文本都会先经过 `pii.anonymize`。
    pub pii: parking_lot::Mutex<crate::pii_shield::PrivacyEngine>,
    /// Per-conversation cancellation tokens so the UI can abort an in-flight turn.
    pub cancel_tokens: RwLock<HashMap<Uuid, CancellationToken>>,
    /// Cached application settings; kept in sync by `SaveSettings` commands.
    pub settings: RwLock<Settings>,
    /// Append-only audit log for security-sensitive operations. Optional
    /// because tests may construct a `RuntimeCtx` without an audit log.
    pub audit: Option<std::sync::Arc<crate::audit::AuditLog>>,
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
    use Command::{
        AddGrade, CancelConversation, DeleteConversation, DeleteProvider, DeleteRagDocument,
        DeleteStudent, DeleteTask, ExportBackup, ImportBackup, ImportStudentsCsv,
        LoadConversations, LoadGrades, LoadMessages, LoadProviders, LoadRagDocuments, LoadSettings,
        LoadStats, LoadStudents, LoadTasks, NewConversation, RunTaskNow, SaveProvider,
        SaveRagDocument, SaveSettings, SaveStudent, SaveTask, SendMessage,
    };
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
            let existed = ctx.db.list_students()?.iter().any(|x| x.id == s.id);
            ctx.db.upsert_student(&s)?;
            if let Some(audit) = &ctx.audit {
                if existed {
                    audit.log(
                        crate::audit::AuditKind::StudentUpdate,
                        format!("{} ({})", s.name, s.id),
                    );
                } else {
                    audit.log(
                        crate::audit::AuditKind::StudentCreate,
                        format!("{} ({})", s.name, s.id),
                    );
                }
            }
            let _ = evt_tx.send(Event::StudentsSaved);
            let v = ctx.db.list_students()?;
            let _ = evt_tx.send(Event::Students(v));
        }
        DeleteStudent(id) => {
            let name = ctx
                .db
                .list_students()?
                .iter()
                .find(|s| s.id == id)
                .map_or_else(|| id.to_string(), |s| s.name.clone());
            ctx.db.delete_student(id)?;
            if let Some(audit) = &ctx.audit {
                audit.log(
                    crate::audit::AuditKind::StudentDelete,
                    format!("{name} ({id})"),
                );
            }
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
        NewConversation {
            agent_id,
            student_id,
            title,
        } => {
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
        DeleteConversation(id) => {
            ctx.db.delete_conversation(id)?;
            let _ = evt_tx.send(Event::ConversationDeleted);
            let v = ctx.db.list_conversations()?;
            let _ = evt_tx.send(Event::Conversations(v));
        }
        SendMessage {
            conversation_id,
            agent_id,
            student_id,
            text,
        } => {
            // Persist the user message and immediately refresh the UI so the
            // sent message appears before the assistant starts streaming.
            let now = chrono::Utc::now();
            let user_msg = crate::models::Message {
                id: uuid::Uuid::new_v4(),
                conversation_id,
                role: crate::models::Role::User,
                content: text.clone(),
                tool_calls: vec![],
                created_at: now,
            };
            ctx.db.insert_message(&user_msg)?;
            let _ = ctx.db.touch_conversation(conversation_id);
            let history = ctx.db.messages_for(conversation_id)?;
            let _ = evt_tx.send(Event::Messages(conversation_id, history));

            let token = CancellationToken::new();
            ctx.cancel_tokens
                .write()
                .insert(conversation_id, token.clone());
            if let Err(e) = crate::ai::run_turn(
                ctx.clone(),
                evt_tx.clone(),
                conversation_id,
                agent_id,
                student_id,
                token,
            )
            .await
            {
                let _ = evt_tx.send(Event::StreamError {
                    conversation_id,
                    error: e.to_string(),
                });
            }
            ctx.cancel_tokens.write().remove(&conversation_id);
        }
        CancelConversation(id) => {
            let token = ctx.cancel_tokens.read().get(&id).cloned();
            if let Some(token) = token {
                token.cancel();
                let _ = evt_tx.send(Event::Toast {
                    kind: ToastKind::Info,
                    msg: "已请求停止生成".into(),
                });
            }
        }
        LoadTasks => {
            let v = ctx.db.list_tasks()?;
            let _ = evt_tx.send(Event::Tasks(v));
        }
        SaveTask(mut t) => {
            t.next_run = crate::scheduler::next_fire(&t.cron_expr, chrono::Utc::now()).ok();
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
                // Insert the task prompt as the user message, then run the turn.
                let user_msg = crate::models::Message {
                    id: uuid::Uuid::new_v4(),
                    conversation_id: conv.id,
                    role: crate::models::Role::User,
                    content: t.prompt.clone(),
                    tool_calls: vec![],
                    created_at: now,
                };
                ctx.db.insert_message(&user_msg)?;
                let _ = ctx.db.touch_conversation(conv.id);
                let history = ctx.db.messages_for(conv.id)?;
                let _ = evt_tx.send(Event::Messages(conv.id, history));
                let token = CancellationToken::new();
                ctx.cancel_tokens.write().insert(conv.id, token.clone());
                let res = crate::ai::run_turn(
                    ctx.clone(),
                    evt_tx.clone(),
                    conv.id,
                    t.agent_id,
                    None,
                    token,
                )
                .await;
                ctx.cancel_tokens.write().remove(&conv.id);
                res?;
            }
        }
        LoadProviders => {
            let v = ctx.db.list_providers()?;
            let _ = evt_tx.send(Event::Providers(v));
        }
        SaveProvider(mut p) => {
            let existed = ctx.db.list_providers()?.iter().any(|x| x.id == p.id);
            if let Some(k) = p.api_key.as_ref() {
                if !k.is_empty() && !k.starts_with("enc:") {
                    let enc = ctx.cipher.encrypt_str(k)?;
                    p.api_key = Some(format!("enc:{enc}"));
                }
            }
            ctx.db.upsert_provider(&p)?;
            if let Some(audit) = &ctx.audit {
                if existed {
                    audit.log(
                        crate::audit::AuditKind::ProviderUpdate,
                        format!("{} ({})", p.name, p.id),
                    );
                } else {
                    audit.log(
                        crate::audit::AuditKind::ProviderCreate,
                        format!("{} ({})", p.name, p.id),
                    );
                }
            }
            let _ = evt_tx.send(Event::ProviderSaved);
            let v = ctx.db.list_providers()?;
            let _ = evt_tx.send(Event::Providers(v));
        }
        DeleteProvider(id) => {
            let name = ctx
                .db
                .list_providers()?
                .iter()
                .find(|p| p.id == *id)
                .map_or_else(|| id.clone(), |p| p.name.clone());
            ctx.db.delete_provider(&id)?;
            if let Some(audit) = &ctx.audit {
                audit.log(
                    crate::audit::AuditKind::ProviderDelete,
                    format!("{name} ({id})"),
                );
            }
            let _ = evt_tx.send(Event::ProviderDeleted);
            let v = ctx.db.list_providers()?;
            let _ = evt_tx.send(Event::Providers(v));
        }
        LoadRagDocuments => {
            let v = ctx.db.list_rag_documents()?;
            let _ = evt_tx.send(Event::RagDocuments(v));
        }
        SaveRagDocument(d) => {
            ctx.db.upsert_rag_document(&d)?;
            let _ = evt_tx.send(Event::RagDocumentSaved);
            let v = ctx.db.list_rag_documents()?;
            let _ = evt_tx.send(Event::RagDocuments(v));
        }
        DeleteRagDocument(id) => {
            ctx.db.delete_rag_document(id)?;
            let _ = evt_tx.send(Event::RagDocumentDeleted);
            let v = ctx.db.list_rag_documents()?;
            let _ = evt_tx.send(Event::RagDocuments(v));
        }
        LoadStats => {
            let s = ctx.db.dashboard_stats()?;
            let _ = evt_tx.send(Event::Stats(s));
        }
        LoadSettings => {
            // Echo the latest persisted settings back to the UI so it can
            // pick up any changes a sibling process (or a manual edit of
            // the DB) made since startup. We also refresh the in-memory
            // copy held by the runtime, which the AI loop reads from.
            let s = ctx.db.load_settings().unwrap_or_default();
            *ctx.settings.write() = s.clone();
            let _ = evt_tx.send(Event::Settings(s));
        }
        SaveSettings(s) => {
            ctx.db.save_settings(&s)?;
            *ctx.settings.write() = s.clone();
            let _ = evt_tx.send(Event::Settings(s));
        }
        ExportBackup => match ctx.db.export_full() {
            Ok(backup) => {
                if let Some(audit) = &ctx.audit {
                    audit.log_with(
                        crate::audit::AuditKind::BackupExport,
                        format!(
                            "{} 学生 / {} 会话 / {} 消息",
                            backup.students.len(),
                            backup.conversations.len(),
                            backup.messages.len()
                        ),
                        serde_json::json!({
                            "students": backup.students.len(),
                            "conversations": backup.conversations.len(),
                            "messages": backup.messages.len(),
                        }),
                    );
                }
                let _ = evt_tx.send(Event::BackupReady(backup));
            }
            Err(e) => {
                let _ = evt_tx.send(Event::Toast {
                    kind: ToastKind::Error,
                    msg: format!("备份失败: {e}"),
                });
            }
        },
        ImportBackup(backup) => {
            if backup.schema_version != crate::models::FullBackup::CURRENT_SCHEMA_VERSION {
                let _ = evt_tx.send(Event::Toast {
                    kind: ToastKind::Error,
                    msg: format!(
                        "备份版本不匹配（备份 v{}，需要 v{}）",
                        backup.schema_version,
                        crate::models::FullBackup::CURRENT_SCHEMA_VERSION
                    ),
                });
                return Ok(());
            }
            match ctx.db.import_full(&backup) {
                Ok(()) => {
                    if let Some(audit) = &ctx.audit {
                        audit.log_with(
                            crate::audit::AuditKind::BackupRestore,
                            format!(
                                "{} 学生 / {} 会话",
                                backup.students.len(),
                                backup.conversations.len()
                            ),
                            serde_json::json!({ "schema_version": backup.schema_version }),
                        );
                    }
                    let _ = evt_tx.send(Event::Toast {
                        kind: ToastKind::Success,
                        msg: format!(
                            "已恢复：{} 名学生，{} 条会话，{} 条消息",
                            backup.students.len(),
                            backup.conversations.len(),
                            backup.messages.len()
                        ),
                    });
                    // Reload everything the UI caches.
                    let _ = evt_tx.send(Event::Students(ctx.db.list_students()?));
                    let _ = evt_tx.send(Event::Conversations(ctx.db.list_conversations()?));
                    let _ = evt_tx.send(Event::Tasks(ctx.db.list_tasks()?));
                    let _ = evt_tx.send(Event::Providers(ctx.db.list_providers()?));
                    let _ = evt_tx.send(Event::RagDocuments(ctx.db.list_rag_documents()?));
                    let _ = evt_tx.send(Event::Stats(ctx.db.dashboard_stats()?));
                }
                Err(e) => {
                    let _ = evt_tx.send(Event::Toast {
                        kind: ToastKind::Error,
                        msg: format!("恢复失败: {e}"),
                    });
                }
            }
        }
    }
    Ok(())
}

/// Decrypt a stored field for display (used by the UI on demand).
#[allow(dead_code)]
pub fn decrypt_field(cipher: &Cipher, v: &str) -> String {
    if let Some(rest) = v.strip_prefix("enc:") {
        cipher
            .decrypt_str(rest)
            .unwrap_or_else(|_| "[解密失败]".into())
    } else {
        v.to_string()
    }
}
