//! 状态外化 — 把 agent 运行时的 step / tool_call 持久化到 SQLite
//!
//! # 三张表 (由 `db::DbService::migrate` 在阶段二 Round 7 创建)
//! - `agent_runs`: 顶层运行记录 (run_id, agent_id, status, 资源用量, 起止时间)
//! - `agent_run_steps`: ReAct 步骤 (Plan/Act/Observe/Reflect/FinalAnswer), 含状态快照 JSON
//! - `agent_run_tool_calls`: 工具调用 (step_id, name, args, result, status, HITL 批准人)
//!
//! # 内存态
//! `InMemoryRunState` 缓存当前正在运行的 run, 避免每步都查 DB。
//! step 完成时通过 `record_*` 同步到 DB。
//!
//! # 阶段二职责边界
//! 阶段二只做"持久化步骤 + 工具调用"。
//! Guardrails 集成 + 跨重启恢复留到阶段三/五。

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::error::{AppError, Result};
use crate::services::db::DbService;
use crate::harness::error::HarnessError;

// =============================================================
// Records (与 db.rs 的 migrate SQL 一一对应)
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunRecord {
    pub id: String,
    pub agent_id: String,
    pub prompt: String,
    pub status: String, // running | success | failure | aborted
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub rounds: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd_micros: i64, // 单位: 1e-6 USD
    pub final_text: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    Plan,
    Act,
    Observe,
    Reflect,
    FinalAnswer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStepRecord {
    pub id: String,
    pub run_id: String,
    pub seq: i64,
    pub kind: StepKind,
    pub state_json: String, // 该步骤的状态快照
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Pending,
    Approved,
    Rejected,
    Executed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentToolCallRecord {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub tool_name: String,
    pub args_json: String,
    pub result_json: Option<String>,
    pub status: ToolCallStatus,
    pub approved_by: Option<String>,
    pub started_at: i64,
    pub finished_at: Option<i64>,
}

// =============================================================
// StateStore — 状态外化门面
// =============================================================

#[derive(Clone)]
pub struct StateStore {
    db: Arc<Mutex<DbService>>,
    /// 当前正在运行的 run 的内存态缓存 (run_id -> 内存态)
    live: Arc<Mutex<Option<InMemoryRunState>>>,
}

/// 正在运行的 run 的内存态缓存。
///
/// `agent_id` / `started_at` 在内存中暂存, 供将来扩展
/// (例如: 阶段四的 metrics 探针、阶段五的 memory 上下文回溯),
/// 当前阶段 DB 已是真源, 故允许 dead_code。
#[derive(Debug)]
#[allow(dead_code)]
struct InMemoryRunState {
    run_id: String,
    agent_id: String,
    started_at: i64,
    next_seq: i64,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd_micros: i64,
}

impl StateStore {
    pub fn new(db: Arc<Mutex<DbService>>) -> Self {
        Self {
            db,
            live: Arc::new(Mutex::new(None)),
        }
    }

    /// 启动一个新 run, 返回 run_id
    pub async fn start_run(&self, agent_id: &str, prompt: &str) -> Result<String> {
        let run_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let rec = AgentRunRecord {
            id: run_id.clone(),
            agent_id: agent_id.to_string(),
            prompt: prompt.to_string(),
            status: "running".into(),
            started_at: now,
            finished_at: None,
            rounds: 0,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd_micros: 0,
            final_text: None,
            error: None,
        };
        self.insert_run(&rec).await?;
        let mut g = self.live.lock().await;
        *g = Some(InMemoryRunState {
            run_id: rec.id,
            agent_id: rec.agent_id,
            started_at: rec.started_at,
            next_seq: 0,
            input_tokens: 0,
            output_tokens: 0,
            cost_usd_micros: 0,
        });
        Ok(run_id)
    }

    /// 累加 token 用量 (在 LLM 响应后调)
    pub async fn add_usage(&self, in_tok: i64, out_tok: i64, cost_micros: i64) -> Result<()> {
        let mut g = self.live.lock().await;
        if let Some(live) = g.as_mut() {
            live.input_tokens += in_tok;
            live.output_tokens += out_tok;
            live.cost_usd_micros += cost_micros;
        }
        Ok(())
    }

    /// 记录一个 ReAct step
    pub async fn record_step(
        &self,
        kind: StepKind,
        state_json: &serde_json::Value,
    ) -> Result<String> {
        let mut g = self.live.lock().await;
        let live = g.as_mut().ok_or_else(|| {
            AppError::NotInitialized("StateStore: 当前无 active run, 不能 record_step".into())
        })?;
        let step_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();
        let rec = AgentStepRecord {
            id: step_id.clone(),
            run_id: live.run_id.clone(),
            seq: live.next_seq,
            kind,
            state_json: serde_json::to_string(state_json).unwrap_or_default(),
            created_at: now,
        };
        live.next_seq += 1;
        self.insert_step(&rec).await?;
        Ok(step_id)
    }

    /// 记录一次工具调用
    #[allow(clippy::too_many_arguments)]
    pub async fn record_tool_call(
        &self,
        step_id: &str,
        tool_name: &str,
        args: &serde_json::Value,
        status: ToolCallStatus,
        approved_by: Option<&str>,
        started_at: i64,
        finished_at: Option<i64>,
        result: Option<&serde_json::Value>,
    ) -> Result<String> {
        let g = self.live.lock().await;
        let live = g.as_ref().ok_or_else(|| {
            AppError::NotInitialized("StateStore: 当前无 active run".into())
        })?;
        let id = uuid::Uuid::new_v4().to_string();
        let rec = AgentToolCallRecord {
            id: id.clone(),
            run_id: live.run_id.clone(),
            step_id: step_id.to_string(),
            tool_name: tool_name.to_string(),
            args_json: serde_json::to_string(args).unwrap_or_default(),
            result_json: result.map(|v| serde_json::to_string(v).unwrap_or_default()),
            status,
            approved_by: approved_by.map(|s| s.to_string()),
            started_at,
            finished_at,
        };
        self.insert_tool_call(&rec).await?;
        Ok(id)
    }

    /// 完成 run
    pub async fn finish_run(
        &self,
        status: &str,
        final_text: Option<&str>,
        error: Option<&str>,
    ) -> Result<()> {
        let (run_id, in_tok, out_tok, cost) = {
            let mut g = self.live.lock().await;
            let live = g.take().ok_or_else(|| {
                AppError::NotInitialized("StateStore: 无 active run 可 finish".into())
            })?;
            (live.run_id, live.input_tokens, live.output_tokens, live.cost_usd_micros)
        };
        let now = chrono::Utc::now().timestamp_millis();
        let db_svc = self.db.lock().await;
        let conn = db_svc.conn.lock().await;
        conn.execute(
            "UPDATE agent_runs SET status=?, finished_at=?, final_text=?, error=?,
                                  input_tokens=?, output_tokens=?, cost_usd_micros=?
             WHERE id=?",
            rusqlite::params![status, now, final_text, error, in_tok, out_tok, cost, run_id],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    /// 取当前 run_id (没有则 None)
    pub async fn current_run_id(&self) -> Option<String> {
        self.live.lock().await.as_ref().map(|l| l.run_id.clone())
    }

    // ---- 低层 DB 写 (与 db.rs 的 SQL 对齐) ----

    async fn insert_run(&self, rec: &AgentRunRecord) -> Result<()> {
        let db_svc = self.db.lock().await;
        let conn = db_svc.conn.lock().await;
        conn.execute(
            "INSERT INTO agent_runs (id, agent_id, prompt, status, started_at,
                                     rounds, input_tokens, output_tokens, cost_usd_micros)
             VALUES (?,?,?,?,?,?,?,?,?)",
            rusqlite::params![
                rec.id,
                rec.agent_id,
                rec.prompt,
                rec.status,
                rec.started_at,
                rec.rounds,
                rec.input_tokens,
                rec.output_tokens,
                rec.cost_usd_micros,
            ],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    async fn insert_step(&self, rec: &AgentStepRecord) -> Result<()> {
        let db_svc = self.db.lock().await;
        let conn = db_svc.conn.lock().await;
        conn.execute(
            "INSERT INTO agent_run_steps (id, run_id, seq, kind, state_json, created_at)
             VALUES (?,?,?,?,?,?)",
            rusqlite::params![
                rec.id,
                rec.run_id,
                rec.seq,
                serde_json::to_string(&rec.kind).unwrap_or_default().trim_matches('"'),
                rec.state_json,
                rec.created_at,
            ],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }

    async fn insert_tool_call(&self, rec: &AgentToolCallRecord) -> Result<()> {
        let db_svc = self.db.lock().await;
        let conn = db_svc.conn.lock().await;
        conn.execute(
            "INSERT INTO agent_run_tool_calls
             (id, run_id, step_id, tool_name, args_json, result_json, status,
              approved_by, started_at, finished_at)
             VALUES (?,?,?,?,?,?,?,?,?,?)",
            rusqlite::params![
                rec.id,
                rec.run_id,
                rec.step_id,
                rec.tool_name,
                rec.args_json,
                rec.result_json,
                serde_json::to_string(&rec.status).unwrap_or_default().trim_matches('"'),
                rec.approved_by,
                rec.started_at,
                rec.finished_at,
            ],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;
        Ok(())
    }
}

// HarnessError → Result 桥接 (供 harness 内 ? 使用)
impl From<HarnessError> for AppError {
    fn from(e: HarnessError) -> Self {
        AppError::Agent(e.to_string())
    }
}