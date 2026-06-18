//! 调度器 — Rust 重写自 `src/main/services/cron-service.ts` (398 行)。
//!
//! 原版用 node-cron; 这里用 tokio-cron-scheduler。功能对齐:
//!   - 任务 CRUD (cron 表达式 + agent_id + payload)
//!   - 启停 (toggle)
//!   - 立即执行 (run_now)
//!   - 每任务日志 (写入 db.cron_logs)
//!   - 热重载 (update 后重新 schedule)
//!   - 状态广播 (emit "cron:status-update")
//!
//! 注意: 实际任务执行需要回调到 agent_service / llm_service, 这里只暴露
//! scheduler 句柄与 add/remove 接口; 真正的"运行 agent"逻辑在 main.rs setup
//! 时通过闭包注入 (保持本模块不依赖 Tauri AppHandle)。

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tokio_cron_scheduler::{Job, JobScheduler};

use crate::error::{AppError, Result};
use crate::services::db::{CronLogRecord, DbService};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CronTask {
    pub id: String,
    pub name: String,
    pub agent_id: String,
    pub cron: String, // 5 字段 cron 表达式
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub payload: serde_json::Value, // 传给 agent 的初始 prompt
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub last_run_at: Option<i64>,
    #[serde(default)]
    pub next_run_at: Option<i64>,
}

/// 任务执行回调: 接收 (task_id, agent_id, payload), 由 main.rs setup 注入。
/// 注入后, 每次 cron tick / run_now 都会真正触发 agent 运行。
pub type TaskRunner = Arc<dyn Fn(String, String, serde_json::Value) + Send + Sync>;

pub struct SchedulerService {
    tasks: HashMap<String, CronTask>,
    scheduler: Option<JobScheduler>,
    /// 任务 id -> scheduler job uuid (用于 remove/update)。
    job_map: HashMap<String, uuid::Uuid>,
    /// 注入的执行回调 (None 时 tick 仅记日志)。
    runner: Option<TaskRunner>,
}

impl Default for SchedulerService {
    fn default() -> Self {
        Self::new()
    }
}

impl SchedulerService {
    pub fn new() -> Self {
        Self {
            tasks: HashMap::new(),
            scheduler: None,
            job_map: HashMap::new(),
            runner: None,
        }
    }

    /// 注入执行回调。main.rs setup 时调用, 把 agent_run_manual 接进来。
    pub fn set_runner(&mut self, runner: TaskRunner) {
        self.runner = Some(runner);
    }

    /// 启动 scheduler。在 setup 时调用一次。
    pub async fn start(&mut self) -> Result<()> {
        let sched = JobScheduler::new()
            .await
            .map_err(|e| AppError::Scheduler(e.to_string()))?;
        sched
            .start()
            .await
            .map_err(|e| AppError::Scheduler(e.to_string()))?;
        self.scheduler = Some(sched);
        tracing::info!(target: "scheduler", "started");
        Ok(())
    }

    pub fn list(&self) -> Vec<CronTask> {
        self.tasks.values().cloned().collect()
    }

    pub fn get(&self, id: &str) -> Option<CronTask> {
        self.tasks.get(id).cloned()
    }

    pub async fn add(&mut self, mut task: CronTask) -> Result<String> {
        if task.id.is_empty() {
            task.id = format!("cron_{}", uuid::Uuid::new_v4().simple());
        }
        task.created_at = chrono::Utc::now().timestamp_millis();
        let id = task.id.clone();
        if task.enabled {
            self.schedule(&task).await?;
        }
        self.tasks.insert(id.clone(), task);
        Ok(id)
    }

    pub async fn remove(&mut self, id: &str) -> Result<()> {
        if let Some(uuid) = self.job_map.remove(id) {
            if let Some(sched) = &self.scheduler {
                let _ = sched.remove(&uuid).await;
            }
        }
        self.tasks.remove(id);
        Ok(())
    }

    pub async fn toggle(&mut self, id: &str, enabled: bool) -> Result<()> {
        let task = self
            .tasks
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound(format!("cron task {id}")))?;
        task.enabled = enabled;
        let t = task.clone();
        if enabled {
            self.schedule(&t).await?;
        } else if let Some(uuid) = self.job_map.remove(id) {
            if let Some(sched) = &self.scheduler {
                let _ = sched.remove(&uuid).await;
            }
        }
        Ok(())
    }

    /// 重新调度 (update 后调用)。
    pub async fn reschedule(&mut self, task: CronTask) -> Result<()> {
        if let Some(uuid) = self.job_map.remove(&task.id) {
            if let Some(sched) = &self.scheduler {
                let _ = sched.remove(&uuid).await;
            }
        }
        if task.enabled {
            self.schedule(&task).await?;
        }
        self.tasks.insert(task.id.clone(), task);
        Ok(())
    }

    /// 立即执行 (不依赖 cron 触发)。记日志 + 调 runner。
    pub async fn run_now(&self, id: &str, db: Arc<Mutex<DbService>>) -> Result<()> {
        let task = self
            .tasks
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("cron task {id}")))?;
        let now = chrono::Utc::now().timestamp_millis();
        db.lock()
            .await
            .insert_cron_log(&CronLogRecord {
                id: None,
                task_id: id.to_string(),
                level: "info".into(),
                message: format!("手动触发 agent={}", task.agent_id),
                timestamp: now,
                metadata: Some(task.payload.to_string()),
            })
            .await?;
        // 真正触发 agent 执行 (runner 已注入)
        if let Some(runner) = &self.runner {
            runner(task.id.clone(), task.agent_id.clone(), task.payload.clone());
        }
        Ok(())
    }

    async fn schedule(&mut self, task: &CronTask) -> Result<()> {
        let sched = self
            .scheduler
            .as_ref()
            .ok_or_else(|| AppError::NotInitialized("scheduler 未启动".into()))?;
        let cron = task.cron.clone();
        let task_id = task.id.clone();
        let agent_id = task.agent_id.clone();
        let payload = task.payload.clone();
        let runner = self.runner.clone();
        let job = Job::new_async(cron.as_str(), move |_uuid, _l| {
            let task_id = task_id.clone();
            let agent_id = agent_id.clone();
            let payload = payload.clone();
            let runner = runner.clone();
            Box::pin(async move {
                tracing::info!(target: "scheduler", "tick task={task_id} agent={agent_id}");
                if let Some(run) = &runner {
                    run(task_id, agent_id, payload);
                }
            })
        })
        .map_err(|e| AppError::Scheduler(format!("cron 表达式无效: {e}")))?;
        let uuid = sched
            .add(job)
            .await
            .map_err(|e| AppError::Scheduler(e.to_string()))?;
        self.job_map.insert(task.id.clone(), uuid);
        Ok(())
    }
}

/// 共享句柄别名。
pub type SharedScheduler = Arc<Mutex<SchedulerService>>;
