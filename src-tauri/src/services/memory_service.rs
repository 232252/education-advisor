//! 跨会话记忆服务
//!
//! 为 Agent 提供长期记忆能力：
//! - AgentHarness 启动时读取最近 N 条记忆，注入 System Prompt。
//! - Agent 运行结束后，把关键事实写回记忆表。
//! - 前端可通过 command 查看/删除记忆。
//!
//! 记忆类型：
//! - `fact`: 客观事实（如“张三数学成绩持续下滑”）。
//! - `preference`: 用户偏好（如“邵老师喜欢周报在周五下午生成”）。
//! - `summary`: 会话摘要。

use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{AppError, Result};
use crate::services::db::DbService;

/// 单条记忆记录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryRecord {
    pub id: String,
    #[serde(rename = "agentId")]
    pub agent_id: String,
    pub kind: MemoryKind,
    #[serde(rename = "content")]
    pub content_json: String,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sourceRunId")]
    pub source_run_id: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "lastAccessedAt")]
    pub last_accessed_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Fact,
    Preference,
    Summary,
}

impl std::fmt::Display for MemoryKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            MemoryKind::Fact => write!(f, "fact"),
            MemoryKind::Preference => write!(f, "preference"),
            MemoryKind::Summary => write!(f, "summary"),
        }
    }
}

/// 创建记忆请求
#[derive(Debug, Clone, Deserialize)]
pub struct CreateMemoryRequest {
    pub agent_id: String,
    pub kind: MemoryKind,
    pub content_json: String,
    pub source_run_id: Option<String>,
}

/// 记忆服务
#[derive(Clone)]
pub struct MemoryService {
    db: Arc<Mutex<DbService>>,
}

impl MemoryService {
    pub fn new(db: Arc<Mutex<DbService>>) -> Self {
        Self { db }
    }

    /// 列出某 agent 的最近 N 条记忆
    pub async fn list_for_agent(
        &self,
        agent_id: &str,
        limit: usize,
    ) -> Result<Vec<AgentMemoryRecord>> {
        let db_guard = self.db.lock().await;
        let conn = db_guard.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, agent_id, kind, content_json, source_run_id, created_at, last_accessed_at
             FROM agent_memory
             WHERE agent_id = ?
             ORDER BY last_accessed_at DESC
             LIMIT ?",
        )?;
        let rows = stmt.query_map(params![agent_id, limit as i64], |row| {
            Ok(AgentMemoryRecord {
                id: row.get(0)?,
                agent_id: row.get(1)?,
                kind: match row.get::<_, String>(2)?.as_str() {
                    "fact" => MemoryKind::Fact,
                    "preference" => MemoryKind::Preference,
                    "summary" => MemoryKind::Summary,
                    _ => MemoryKind::Fact, // 兜底
                },
                content_json: row.get(3)?,
                source_run_id: row.get(4)?,
                created_at: row.get(5)?,
                last_accessed_at: row.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| AppError::Db(e.to_string()))?);
        }
        Ok(out)
    }

    /// 创建一条记忆
    pub async fn create(&self, req: &CreateMemoryRequest) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let db_guard = self.db.lock().await;
        let conn = db_guard.conn.lock().await;
        conn.execute(
            "INSERT INTO agent_memory
             (id, agent_id, kind, content_json, source_run_id, created_at, last_accessed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                req.agent_id,
                req.kind.to_string(),
                req.content_json,
                req.source_run_id,
                now,
                now,
            ],
        )?;
        Ok(id)
    }

    /// 删除一条记忆
    pub async fn delete(&self, id: &str) -> Result<()> {
        let db_guard = self.db.lock().await;
        let conn = db_guard.conn.lock().await;
        conn.execute("DELETE FROM agent_memory WHERE id = ?", params![id])?;
        Ok(())
    }

    /// 删除某 agent 的全部记忆
    pub async fn delete_by_agent(&self, agent_id: &str) -> Result<usize> {
        let db_guard = self.db.lock().await;
        let conn = db_guard.conn.lock().await;
        let n = conn.execute("DELETE FROM agent_memory WHERE agent_id = ?", params![agent_id])?;
        Ok(n)
    }

    /// 更新最后访问时间
    pub async fn touch(&self, id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let db_guard = self.db.lock().await;
        let conn = db_guard.conn.lock().await;
        conn.execute(
            "UPDATE agent_memory SET last_accessed_at = ? WHERE id = ?",
            params![now, id],
        )?;
        Ok(())
    }

    /// 把记忆列表渲染为可注入 prompt 的文本
    pub fn render_memory_prompt(memories: &[AgentMemoryRecord]) -> String {
        if memories.is_empty() {
            return String::new();
        }
        let mut out = String::from("\n[跨会话记忆]\n");
        for m in memories.iter().rev() {
            out.push_str(&format!("- [{}] {}\n", m.kind, m.content_json));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (DbService, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let db = DbService::open(&dir.path().join("test.db")).unwrap();
        (db, dir)
    }

    #[tokio::test]
    async fn memory_round_trip() {
        let (db, _dir) = setup();
        let db = Arc::new(Mutex::new(db));
        let svc = MemoryService::new(db);

        let req = CreateMemoryRequest {
            agent_id: "main".into(),
            kind: MemoryKind::Fact,
            content_json: r#"{"student":"张三","fact":"数学成绩下滑"}"#.into(),
            source_run_id: Some("run-1".into()),
        };
        let id = svc.create(&req).await.unwrap();

        let list = svc.list_for_agent("main", 10).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, id);
        assert_eq!(list[0].kind, MemoryKind::Fact);

        svc.delete(&id).await.unwrap();
        let list = svc.list_for_agent("main", 10).await.unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn render_memory_prompt_empty() {
        assert_eq!(MemoryService::render_memory_prompt(&[]), "");
    }

    #[test]
    fn render_memory_prompt_non_empty() {
        let m = AgentMemoryRecord {
            id: "m1".into(),
            agent_id: "main".into(),
            kind: MemoryKind::Preference,
            content_json: r#"{"key":"theme","value":"dark"}"#.into(),
            source_run_id: None,
            created_at: 0,
            last_accessed_at: 0,
        };
        let s = MemoryService::render_memory_prompt(&[m]);
        assert!(s.contains("跨会话记忆"));
        assert!(s.contains("theme"));
    }
}
