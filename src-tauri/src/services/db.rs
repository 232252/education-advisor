//! SQLite 持久化服务 — rusqlite 重写自 `src/main/services/db-service.ts`。
//!
//! 三张表完全沿用原 Electron 版本 schema (字段名/约束/索引一一对应),
//! 以便用户从 Electron 版迁移时数据可直接复用。
//!
//! 并发模型: 单连接 + `tokio::sync::Mutex` 包裹 (better-sqlite3 也是同步单连接)。
//! 写操作 < 1ms, 不会成为瓶颈。

use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{AppError, Result};

// =============================================================
// 数据记录 (与 db-service.ts 的 interface 完全一致)
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecutionRecord {
    pub id: Option<i64>,
    pub agent_id: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub status: String, // running|success|failure|aborted
    pub prompt: Option<String>,
    pub output: Option<String>,
    pub error: Option<String>,
    pub tokens_input: Option<i64>,
    pub tokens_output: Option<i64>,
    pub cost_total: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronLogRecord {
    pub id: Option<i64>,
    pub task_id: String,
    pub level: String, // info|warn|error|debug
    pub message: String,
    pub timestamp: i64,
    pub metadata: Option<String>, // JSON string
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageRecord {
    pub id: Option<i64>,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub thinking: Option<String>,
    pub tool_calls: Option<String>,
    pub timestamp: i64,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub token_input: Option<i64>,
    pub token_output: Option<i64>,
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionRecord {
    pub id: String,
    pub title: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
}

// =============================================================
// DbService
// =============================================================

pub struct DbService {
    pub(crate) conn: Mutex<Connection>,
}

impl DbService {
    /// 打开/创建数据库。返回裸 `DbService`, 由调用方按需包装成 `Arc<Mutex<DbService>>`
    /// (AppState 用 `Arc<Mutex<>>` 包裹以便跨 command 共享)。
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        // 性能 pragma (与 better-sqlite3 默认同步级对齐)
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;
        Self::migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// 建表 (idempotent)。schema 与 db-service.ts 一一对应。
    fn migrate(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL DEFAULT 'default',
                role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
                content TEXT NOT NULL,
                thinking TEXT,
                tool_calls TEXT,
                timestamp INTEGER NOT NULL,
                provider TEXT,
                model TEXT,
                token_input INTEGER,
                token_output INTEGER,
                cost REAL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '新对话',
                provider TEXT,
                model TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                message_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at);

            CREATE TABLE IF NOT EXISTS agent_executions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_id TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                status TEXT NOT NULL CHECK(status IN ('running','success','failure','aborted')),
                prompt TEXT,
                output TEXT,
                error TEXT,
                tokens_input INTEGER,
                tokens_output INTEGER,
                cost_total REAL
            );
            CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_id ON agent_executions(agent_id);
            CREATE INDEX IF NOT EXISTS idx_agent_executions_started_at ON agent_executions(started_at);

            CREATE TABLE IF NOT EXISTS cron_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                level TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
                message TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_cron_logs_task_id ON cron_logs(task_id);
            CREATE INDEX IF NOT EXISTS idx_cron_logs_timestamp ON cron_logs(timestamp);

            -- ===== Harness 三表 (阶段二新增, 与 eaa/electron 旧版无 schema 冲突) =====
            -- 顶层 run 记录 (替代原 agent_executions 中 run_id 维度的功能,
            -- 旧 agent_executions 保留向后兼容)。
            CREATE TABLE IF NOT EXISTS agent_runs (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                prompt TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('running','success','failure','aborted')),
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                rounds INTEGER NOT NULL DEFAULT 0,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cost_usd_micros INTEGER NOT NULL DEFAULT 0,
                final_text TEXT,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id ON agent_runs(agent_id);
            CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at);
            CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

            -- ReAct 步骤
            CREATE TABLE IF NOT EXISTS agent_run_steps (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('plan','act','observe','reflect','final_answer')),
                state_json TEXT NOT NULL DEFAULT '{}',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id ON agent_run_steps(run_id);

            -- 工具调用 (含 HITL 状态)
            CREATE TABLE IF NOT EXISTS agent_run_tool_calls (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                args_json TEXT NOT NULL,
                result_json TEXT,
                status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','executed','failed')),
                approved_by TEXT,
                started_at INTEGER NOT NULL,
                finished_at INTEGER,
                FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
                FOREIGN KEY (step_id) REFERENCES agent_run_steps(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_agent_run_tool_calls_run_id ON agent_run_tool_calls(run_id);
            CREATE INDEX IF NOT EXISTS idx_agent_run_tool_calls_step_id ON agent_run_tool_calls(step_id);
            CREATE INDEX IF NOT EXISTS idx_agent_run_tool_calls_status ON agent_run_tool_calls(status);
            ",
        )?;
        tracing::info!("db migrated: 7 tables ready");
        Ok(())
    }

    // ----- Agent executions -----

    pub async fn insert_execution(&self, rec: &AgentExecutionRecord) -> Result<i64> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO agent_executions
             (agent_id, started_at, finished_at, status, prompt, output, error,
              tokens_input, tokens_output, cost_total)
             VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![
                rec.agent_id,
                rec.started_at,
                rec.finished_at,
                rec.status,
                rec.prompt,
                rec.output,
                rec.error,
                rec.tokens_input,
                rec.tokens_output,
                rec.cost_total,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub async fn update_execution(&self, id: i64, rec: &AgentExecutionRecord) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE agent_executions SET
                finished_at=?, status=?, output=?, error=?,
                tokens_input=?, tokens_output=?, cost_total=?
             WHERE id=?",
            params![
                rec.finished_at,
                rec.status,
                rec.output,
                rec.error,
                rec.tokens_input,
                rec.tokens_output,
                rec.cost_total,
                id,
            ],
        )?;
        Ok(())
    }

    pub async fn get_execution_history(
        &self,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<AgentExecutionRecord>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, started_at, finished_at, status, prompt, output, error,
                    tokens_input, tokens_output, cost_total
             FROM agent_executions WHERE agent_id=? ORDER BY started_at DESC LIMIT ?",
        )?;
        let rows = stmt.query_map(params![agent_id, limit], |row| {
            Ok(AgentExecutionRecord {
                id: Some(row.get(0)?),
                agent_id: row.get(1)?,
                started_at: row.get(2)?,
                finished_at: row.get(3)?,
                status: row.get(4)?,
                prompt: row.get(5)?,
                output: row.get(6)?,
                error: row.get(7)?,
                tokens_input: row.get(8)?,
                tokens_output: row.get(9)?,
                cost_total: row.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(out)
    }

    pub async fn get_all_executions(
        &self,
        status: Option<&str>,
        agent_id: Option<&str>,
        since_ms: Option<i64>,
        limit: i64,
    ) -> Result<Vec<AgentExecutionRecord>> {
        let conn = self.conn.lock().await;
        let mut sql = String::from(
            "SELECT id, agent_id, started_at, finished_at, status, prompt, output, error,
                    tokens_input, tokens_output, cost_total
             FROM agent_executions WHERE 1=1",
        );
        let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(s) = status {
            sql.push_str(" AND status=?");
            args.push(Box::new(s.to_string()));
        }
        if let Some(a) = agent_id {
            sql.push_str(" AND agent_id=?");
            args.push(Box::new(a.to_string()));
        }
        if let Some(t) = since_ms {
            sql.push_str(" AND started_at>=?");
            args.push(Box::new(t));
        }
        sql.push_str(" ORDER BY started_at DESC LIMIT ?");
        args.push(Box::new(limit));
        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(AgentExecutionRecord {
                id: Some(row.get(0)?),
                agent_id: row.get(1)?,
                started_at: row.get(2)?,
                finished_at: row.get(3)?,
                status: row.get(4)?,
                prompt: row.get(5)?,
                output: row.get(6)?,
                error: row.get(7)?,
                tokens_input: row.get(8)?,
                tokens_output: row.get(9)?,
                cost_total: row.get(10)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(out)
    }

    // ----- Chat messages & sessions -----

    pub async fn save_message(&self, msg: &ChatMessageRecord) -> Result<i64> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO chat_messages
             (session_id, role, content, thinking, tool_calls, timestamp,
              provider, model, token_input, token_output, cost)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            params![
                msg.session_id,
                msg.role,
                msg.content,
                msg.thinking,
                msg.tool_calls,
                msg.timestamp,
                msg.provider,
                msg.model,
                msg.token_input,
                msg.token_output,
                msg.cost,
            ],
        )?;
        let id = conn.last_insert_rowid();
        // upsert session
        conn.execute(
            "INSERT INTO chat_sessions (id, title, created_at, updated_at, message_count)
             VALUES (?, '新对话', ?, ?, 0)
             ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",
            params![msg.session_id, msg.timestamp, msg.timestamp],
        )?;
        conn.execute(
            "UPDATE chat_sessions SET message_count = message_count + 1, updated_at=? WHERE id=?",
            params![msg.timestamp, msg.session_id],
        )?;
        Ok(id)
    }

    pub async fn load_messages(&self, session_id: Option<&str>) -> Result<Vec<serde_json::Value>> {
        let conn = self.conn.lock().await;
        let (sql, sid): (&str, String) = match session_id {
            Some(s) => ("WHERE session_id=? ORDER BY timestamp ASC", s.to_string()),
            None => ("ORDER BY timestamp ASC", String::new()),
        };
        let sql = format!(
            "SELECT id, session_id, role, content, thinking, tool_calls, timestamp,
                    provider, model, token_input, token_output, cost
             FROM chat_messages {sql}"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = if session_id.is_some() {
            stmt.query_map(params![sid], row_to_json)?
                .collect::<Vec<_>>()
        } else {
            stmt.query_map([], row_to_json)?.collect::<Vec<_>>()
        };
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(out)
    }

    pub async fn delete_session(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM chat_messages WHERE session_id=?",
            params![session_id],
        )?;
        conn.execute("DELETE FROM chat_sessions WHERE id=?", params![session_id])?;
        Ok(())
    }

    pub async fn list_sessions(&self) -> Result<Vec<ChatSessionRecord>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, title, provider, model, created_at, updated_at, message_count
             FROM chat_sessions ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ChatSessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                provider: row.get(2)?,
                model: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                message_count: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(out)
    }

    // ----- Cron logs -----

    pub async fn insert_cron_log(&self, rec: &CronLogRecord) -> Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO cron_logs (task_id, level, message, timestamp, metadata)
             VALUES (?,?,?,?,?)",
            params![
                rec.task_id,
                rec.level,
                rec.message,
                rec.timestamp,
                rec.metadata
            ],
        )?;
        Ok(())
    }

    pub async fn get_cron_logs(&self, task_id: Option<&str>) -> Result<Vec<CronLogRecord>> {
        let conn = self.conn.lock().await;
        let mut out = Vec::new();
        if let Some(tid) = task_id {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, level, message, timestamp, metadata
                 FROM cron_logs WHERE task_id=? ORDER BY timestamp DESC LIMIT 500",
            )?;
            for r in stmt.query_map(params![tid], cron_log_row)? {
                out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, task_id, level, message, timestamp, metadata
                 FROM cron_logs ORDER BY timestamp DESC LIMIT 500",
            )?;
            for r in stmt.query_map([], cron_log_row)? {
                out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
            }
        }
        Ok(out)
    }
}

// helper: 把行映射成前端友好的 JSON (key 用 camelCase 对齐 TS 字段)
fn row_to_json(row: &rusqlite::Row) -> rusqlite::Result<serde_json::Value> {
    Ok(serde_json::json!({
        "id": row.get::<_, Option<i64>>(0)?,
        "sessionId": row.get::<_, String>(1)?,
        "role": row.get::<_, String>(2)?,
        "content": row.get::<_, String>(3)?,
        "thinking": row.get::<_, Option<String>>(4)?,
        "toolCalls": row.get::<_, Option<String>>(5)?,
        "timestamp": row.get::<_, i64>(6)?,
        "provider": row.get::<_, Option<String>>(7)?,
        "model": row.get::<_, Option<String>>(8)?,
        "tokenInput": row.get::<_, Option<i64>>(9)?,
        "tokenOutput": row.get::<_, Option<i64>>(10)?,
        "cost": row.get::<_, Option<f64>>(11)?,
    }))
}

fn cron_log_row(row: &rusqlite::Row) -> rusqlite::Result<CronLogRecord> {
    Ok(CronLogRecord {
        id: Some(row.get(0)?),
        task_id: row.get(1)?,
        level: row.get(2)?,
        message: row.get(3)?,
        timestamp: row.get(4)?,
        metadata: row.get(5)?,
    })
}
