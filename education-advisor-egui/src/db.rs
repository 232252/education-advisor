//! `SQLite` persistence layer.
//!
//! All schema lives in code and is migrated on startup. Sensitive fields are
//! encrypted by the caller before reaching this layer, so the DB only ever
//! stores ciphertext for PII.

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::sync::Arc;
use uuid::Uuid;

use crate::models::{
    Conversation, DashboardStats, GradeEntry, LlmProvider, Message, ProviderKind, RagChunk,
    RagDocument, RiskLevel, Role, ScheduledTask, Settings, Student, ToolCallRecord,
};

/// Thread-safe database handle. The connection is guarded by a mutex; all
/// access happens on the background runtime thread, never on the UI thread.
#[derive(Clone)]
pub struct Db {
    conn: Arc<parking_lot::Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &std::path::Path) -> Result<Self> {
        let conn = Connection::open(path).with_context(|| format!("open {}", path.display()))?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
        )?;
        let db = Self {
            conn: Arc::new(parking_lot::Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: Arc::new(parking_lot::Mutex::new(conn)),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let c = self.conn.lock();
        c.execute_batch(
            "CREATE TABLE IF NOT EXISTS students (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                gender TEXT,
                grade TEXT NOT NULL,
                class TEXT NOT NULL,
                id_number TEXT,
                birth_date TEXT,
                enrollment_date TEXT,
                guardian_name TEXT,
                guardian_contact TEXT,
                guardian_relation TEXT,
                home_address TEXT,
                emergency_contact TEXT,
                risk_level INTEGER NOT NULL,
                gpa REAL,
                tags TEXT NOT NULL DEFAULT '[]',
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS grades (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL,
                subject TEXT NOT NULL,
                score REAL NOT NULL,
                max_score REAL NOT NULL,
                exam_date TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                student_id TEXT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role INTEGER NOT NULL,
                content TEXT NOT NULL,
                tool_calls TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                cron_expr TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                prompt TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                last_run TEXT,
                next_run TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind INTEGER NOT NULL,
                base_url TEXT NOT NULL,
                api_key TEXT,
                model TEXT NOT NULL,
                enabled INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_students_risk ON students(risk_level);
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rag_documents (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rag_chunks (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL,
                text TEXT NOT NULL,
                embedding TEXT NOT NULL,
                FOREIGN KEY(document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
            );",
        )?;
        Ok(())
    }

    // ---- Students ----
    pub fn upsert_student(&self, s: &Student) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT OR REPLACE INTO students
             (id,name,gender,grade,class,id_number,birth_date,enrollment_date,guardian_name,guardian_contact,guardian_relation,home_address,emergency_contact,risk_level,gpa,tags,notes,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            params![
                s.id.to_string(),
                s.name,
                s.gender,
                s.grade,
                s.class,
                s.id_number,
                s.birth_date.map(|d| d.to_string()),
                s.enrollment_date.map(|d| d.to_string()),
                s.guardian_name,
                s.guardian_contact,
                s.guardian_relation,
                s.home_address,
                s.emergency_contact,
                s.risk_level as i64,
                s.gpa,
                serde_json::to_string(&s.tags).unwrap_or_default(),
                s.notes,
                s.created_at.to_rfc3339(),
                s.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn list_students(&self) -> Result<Vec<Student>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM students ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], row_to_student)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_student(&self, id: Uuid) -> Result<()> {
        let c = self.conn.lock();
        c.execute("DELETE FROM students WHERE id=?", params![id.to_string()])?;
        Ok(())
    }

    // ---- Grades ----
    pub fn add_grade(&self, g: &GradeEntry) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT OR REPLACE INTO grades (id,student_id,subject,score,max_score,exam_date,recorded_at)
             VALUES (?,?,?,?,?,?,?)",
            params![
                g.id.to_string(),
                g.student_id.to_string(),
                g.subject,
                g.score,
                g.max_score,
                g.exam_date.to_string(),
                g.recorded_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn grades_for(&self, student_id: Uuid) -> Result<Vec<GradeEntry>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM grades WHERE student_id=? ORDER BY exam_date")?;
        let rows = stmt.query_map(params![student_id.to_string()], row_to_grade)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    #[allow(dead_code)]
    pub fn all_grades(&self) -> Result<Vec<GradeEntry>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM grades ORDER BY exam_date")?;
        let rows = stmt.query_map([], row_to_grade)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    // ---- Conversations & messages ----
    pub fn touch_conversation(&self, id: Uuid) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "UPDATE conversations SET updated_at=? WHERE id=?",
            params![chrono::Utc::now().to_rfc3339(), id.to_string()],
        )?;
        Ok(())
    }

    pub fn upsert_conversation(&self, conv: &Conversation) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT OR REPLACE INTO conversations (id,agent_id,student_id,title,created_at,updated_at)
             VALUES (?,?,?,?,?,?)",
            params![
                conv.id.to_string(),
                conv.agent_id,
                conv.student_id.map(|s| s.to_string()),
                conv.title,
                conv.created_at.to_rfc3339(),
                conv.updated_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn list_conversations(&self) -> Result<Vec<Conversation>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM conversations ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], row_to_conversation)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_conversation(&self, id: Uuid) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "DELETE FROM conversations WHERE id=?",
            params![id.to_string()],
        )?;
        Ok(())
    }

    pub fn insert_message(&self, m: &Message) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT OR REPLACE INTO messages (id,conversation_id,role,content,tool_calls,created_at)
             VALUES (?,?,?,?,?,?)",
            params![
                m.id.to_string(),
                m.conversation_id.to_string(),
                m.role as i64,
                m.content,
                serde_json::to_string(&m.tool_calls).unwrap_or_default(),
                m.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn messages_for(&self, conversation_id: Uuid) -> Result<Vec<Message>> {
        let c = self.conn.lock();
        let mut stmt =
            c.prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at")?;
        let rows = stmt.query_map(params![conversation_id.to_string()], row_to_message)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    // ---- Tasks ----
    pub fn upsert_task(&self, t: &ScheduledTask) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT OR REPLACE INTO tasks (id,name,cron_expr,agent_id,prompt,enabled,last_run,next_run,created_at)
             VALUES (?,?,?,?,?,?,?,?,?)",
            params![
                t.id.to_string(),
                t.name,
                t.cron_expr,
                t.agent_id,
                t.prompt,
                i64::from(t.enabled),
                t.last_run.map(|d| d.to_rfc3339()),
                t.next_run.map(|d| d.to_rfc3339()),
                t.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn list_tasks(&self) -> Result<Vec<ScheduledTask>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM tasks ORDER BY created_at")?;
        let rows = stmt.query_map([], row_to_task)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_task(&self, id: Uuid) -> Result<()> {
        let c = self.conn.lock();
        c.execute("DELETE FROM tasks WHERE id=?", params![id.to_string()])?;
        Ok(())
    }

    // ---- Providers ----
    pub fn upsert_provider(&self, p: &LlmProvider) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT OR REPLACE INTO providers (id,name,kind,base_url,api_key,model,enabled)
             VALUES (?,?,?,?,?,?,?)",
            params![
                p.id,
                p.name,
                p.kind as i64,
                p.base_url,
                p.api_key,
                p.model,
                i64::from(p.enabled)
            ],
        )?;
        Ok(())
    }

    pub fn list_providers(&self) -> Result<Vec<LlmProvider>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM providers ORDER BY name")?;
        let rows = stmt.query_map([], row_to_provider)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn delete_provider(&self, id: &str) -> Result<()> {
        let c = self.conn.lock();
        c.execute("DELETE FROM providers WHERE id=?", params![id])?;
        Ok(())
    }

    // ---- Stats ----
    pub fn dashboard_stats(&self) -> Result<DashboardStats> {
        let c = self.conn.lock();
        let total: i64 = c
            .query_row("SELECT COUNT(*) FROM students", [], |r| r.get(0))
            .unwrap_or(0);
        let mut risk = [0usize; 4];
        let mut stmt =
            c.prepare("SELECT risk_level, COUNT(*) FROM students GROUP BY risk_level")?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)? as usize, r.get::<_, i64>(1)? as usize))
        })?;
        for row in rows {
            let (lvl, cnt) = row?;
            if lvl < 4 {
                risk[lvl] = cnt;
            }
        }
        let avg_gpa: f64 = c
            .query_row(
                "SELECT AVG(gpa) FROM students WHERE gpa IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        let today = Utc::now().date_naive();
        let convs_today: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM conversations WHERE date(updated_at)=date(?)",
                params![today.to_string()],
                |r| r.get(0),
            )
            .unwrap_or(0);
        let tool_calls: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE content LIKE '%tool%'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);

        // grade trend by month
        let mut trend = Vec::new();
        let mut stmt = c.prepare(
            "SELECT strftime('%Y-%m', exam_date) AS m, AVG(score/max_score) FROM grades GROUP BY m ORDER BY m LIMIT 12",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0).unwrap_or_default(),
                r.get::<_, f64>(1).unwrap_or(0.0) as f32,
            ))
        })?;
        for row in rows {
            trend.push(row?);
        }

        // agent activity from conversations
        let mut agent_activity = Vec::new();
        let mut stmt = c.prepare(
            "SELECT agent_id, COUNT(*) FROM conversations GROUP BY agent_id ORDER BY COUNT(*) DESC LIMIT 8",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0).unwrap_or_default(),
                r.get::<_, i64>(1).unwrap_or(0) as u32,
            ))
        })?;
        for row in rows {
            agent_activity.push(row?);
        }

        Ok(DashboardStats {
            total_students: total as usize,
            risk_distribution: risk,
            avg_gpa: avg_gpa as f32,
            conversations_today: convs_today as usize,
            tool_calls_total: tool_calls as usize,
            agent_activity,
            grade_trend: trend,
        })
    }

    // ---- Settings ----
    pub fn save_settings(&self, s: &Settings) -> Result<()> {
        let c = self.conn.lock();
        let value = serde_json::to_string(s).unwrap_or_default();
        c.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            params!["app", value],
        )?;
        Ok(())
    }

    pub fn load_settings(&self) -> Result<Settings> {
        let c = self.conn.lock();
        let value: Option<String> = c
            .query_row(
                "SELECT value FROM settings WHERE key=?",
                params!["app"],
                |r| r.get(0),
            )
            .optional()?;
        match value {
            Some(v) => serde_json::from_str(&v).map_err(Into::into),
            None => Ok(Settings::default()),
        }
    }

    // ---- RAG documents ----
    pub fn upsert_rag_document(&self, d: &RagDocument) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "INSERT OR REPLACE INTO rag_documents (id, title, content, created_at) VALUES (?,?,?,?)",
            params![d.id.to_string(), d.title, d.content, d.created_at.to_rfc3339()],
        )?;
        c.execute(
            "DELETE FROM rag_chunks WHERE document_id=?",
            params![d.id.to_string()],
        )?;
        for chunk in &d.chunks {
            c.execute(
                "INSERT OR REPLACE INTO rag_chunks (id, document_id, text, embedding) VALUES (?,?,?,?)",
                params![
                    chunk.id.to_string(),
                    chunk.document_id.to_string(),
                    chunk.text,
                    serde_json::to_string(&chunk.embedding).unwrap_or_default(),
                ],
            )?;
        }
        Ok(())
    }

    pub fn list_rag_documents(&self) -> Result<Vec<RagDocument>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM rag_documents ORDER BY created_at DESC")?;
        let docs: Result<Vec<RagDocument>, _> = stmt.query_map([], row_to_rag_document)?.collect();
        let mut docs = docs?;
        for d in &mut docs {
            d.chunks = self.rag_chunks_for(d.id)?;
        }
        Ok(docs)
    }

    pub fn delete_rag_document(&self, id: Uuid) -> Result<()> {
        let c = self.conn.lock();
        c.execute(
            "DELETE FROM rag_documents WHERE id=?",
            params![id.to_string()],
        )?;
        Ok(())
    }

    fn rag_chunks_for(&self, document_id: Uuid) -> Result<Vec<RagChunk>> {
        let c = self.conn.lock();
        let mut stmt = c.prepare("SELECT * FROM rag_chunks WHERE document_id=?")?;
        let rows = stmt.query_map(params![document_id.to_string()], row_to_rag_chunk)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

// ---- Row mappers ----

fn row_to_student(r: &rusqlite::Row) -> rusqlite::Result<Student> {
    let id: String = r.get("id")?;
    let birth: Option<String> = r.get("birth_date")?;
    let enroll: Option<String> = r.get("enrollment_date")?;
    let tags_json: String = r.get("tags")?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Student {
        id: Uuid::parse_str(&id).unwrap_or_default(),
        name: r.get("name")?,
        gender: r.get("gender")?,
        grade: r.get("grade")?,
        class: r.get("class")?,
        id_number: r.get("id_number")?,
        birth_date: birth.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok()),
        enrollment_date: enroll.and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok()),
        guardian_name: r.get("guardian_name")?,
        guardian_contact: r.get("guardian_contact")?,
        guardian_relation: r.get("guardian_relation")?,
        home_address: r.get("home_address")?,
        emergency_contact: r.get("emergency_contact")?,
        risk_level: {
            let v: i64 = r.get("risk_level")?;
            match v {
                1 => RiskLevel::Medium,
                2 => RiskLevel::High,
                3 => RiskLevel::Critical,
                _ => RiskLevel::Low,
            }
        },
        gpa: r.get("gpa")?,
        tags,
        notes: r.get("notes")?,
        created_at: DateTime::parse_from_rfc3339(&r.get::<_, String>("created_at")?)
            .map_or_else(|_| Utc::now(), |d| d.with_timezone(&Utc)),
        updated_at: DateTime::parse_from_rfc3339(&r.get::<_, String>("updated_at")?)
            .map_or_else(|_| Utc::now(), |d| d.with_timezone(&Utc)),
    })
}

fn row_to_grade(r: &rusqlite::Row) -> rusqlite::Result<GradeEntry> {
    let id: String = r.get("id")?;
    let sid: String = r.get("student_id")?;
    let date: String = r.get("exam_date")?;
    Ok(GradeEntry {
        id: Uuid::parse_str(&id).unwrap_or_default(),
        student_id: Uuid::parse_str(&sid).unwrap_or_default(),
        subject: r.get("subject")?,
        score: r.get("score")?,
        max_score: r.get("max_score")?,
        exam_date: NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .unwrap_or_else(|_| Utc::now().date_naive()),
        recorded_at: DateTime::parse_from_rfc3339(&r.get::<_, String>("recorded_at")?)
            .map_or_else(|_| Utc::now(), |d| d.with_timezone(&Utc)),
    })
}

fn row_to_conversation(r: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    let sid: Option<String> = r.get("student_id")?;
    Ok(Conversation {
        id: Uuid::parse_str(&r.get::<_, String>("id")?).unwrap_or_default(),
        agent_id: r.get("agent_id")?,
        student_id: sid.and_then(|s| Uuid::parse_str(&s).ok()),
        title: r.get("title")?,
        created_at: parse_ts(r.get::<_, String>("created_at")?),
        updated_at: parse_ts(r.get::<_, String>("updated_at")?),
    })
}

fn row_to_message(r: &rusqlite::Row) -> rusqlite::Result<Message> {
    let role_i: i64 = r.get("role")?;
    let tc_json: String = r.get("tool_calls")?;
    let tool_calls: Vec<ToolCallRecord> = serde_json::from_str(&tc_json).unwrap_or_default();
    Ok(Message {
        id: Uuid::parse_str(&r.get::<_, String>("id")?).unwrap_or_default(),
        conversation_id: Uuid::parse_str(&r.get::<_, String>("conversation_id")?)
            .unwrap_or_default(),
        role: match role_i {
            1 => Role::Assistant,
            2 => Role::System,
            3 => Role::Tool,
            _ => Role::User,
        },
        content: r.get("content")?,
        tool_calls,
        created_at: parse_ts(r.get::<_, String>("created_at")?),
    })
}

fn row_to_task(r: &rusqlite::Row) -> rusqlite::Result<ScheduledTask> {
    let last: Option<String> = r.get("last_run")?;
    let next: Option<String> = r.get("next_run")?;
    let enabled: i64 = r.get("enabled")?;
    Ok(ScheduledTask {
        id: Uuid::parse_str(&r.get::<_, String>("id")?).unwrap_or_default(),
        name: r.get("name")?,
        cron_expr: r.get("cron_expr")?,
        agent_id: r.get("agent_id")?,
        prompt: r.get("prompt")?,
        enabled: enabled != 0,
        last_run: last
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&Utc)),
        next_run: next
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&Utc)),
        created_at: parse_ts(r.get::<_, String>("created_at")?),
    })
}

fn row_to_provider(r: &rusqlite::Row) -> rusqlite::Result<LlmProvider> {
    let kind_i: i64 = r.get("kind")?;
    let enabled: i64 = r.get("enabled")?;
    Ok(LlmProvider {
        id: r.get("id")?,
        name: r.get("name")?,
        kind: match kind_i {
            1 => ProviderKind::Anthropic,
            2 => ProviderKind::Gemini,
            3 => ProviderKind::OpenRouter,
            4 => ProviderKind::Ollama,
            5 => ProviderKind::Custom,
            _ => ProviderKind::OpenAi,
        },
        base_url: r.get("base_url")?,
        api_key: r.get("api_key")?,
        model: r.get("model")?,
        enabled: enabled != 0,
    })
}

fn parse_ts(s: String) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&s).map_or_else(|_| Utc::now(), |d| d.with_timezone(&Utc))
}

fn row_to_rag_document(r: &rusqlite::Row) -> rusqlite::Result<RagDocument> {
    let id: String = r.get("id")?;
    Ok(RagDocument {
        id: Uuid::parse_str(&id).unwrap_or_default(),
        title: r.get("title")?,
        content: r.get("content")?,
        chunks: vec![],
        created_at: parse_ts(r.get::<_, String>("created_at")?),
    })
}

fn row_to_rag_chunk(r: &rusqlite::Row) -> rusqlite::Result<RagChunk> {
    let id: String = r.get("id")?;
    let document_id: String = r.get("document_id")?;
    let emb_json: String = r.get("embedding")?;
    let embedding = serde_json::from_str(&emb_json).unwrap_or_default();
    Ok(RagChunk {
        id: Uuid::parse_str(&id).unwrap_or_default(),
        document_id: Uuid::parse_str(&document_id).unwrap_or_default(),
        text: r.get("text")?,
        embedding,
    })
}
