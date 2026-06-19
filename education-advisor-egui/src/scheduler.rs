//! Cron-based scheduler running on the background runtime.
//!
//! Every 30 seconds it scans enabled tasks, computes the next fire time, and
//! when due, kicks off an agent turn (which itself streams into the UI). This
//! keeps scheduling fully off the UI thread.

use chrono::{DateTime, Duration, Utc};
use cron::Schedule;
use std::str::FromStr;
use std::sync::Arc;
use tokio::task::JoinHandle;

use crossbeam_channel::Sender;

use crate::models::Conversation;
use crate::runtime::{Event, RuntimeCtx};

pub struct Scheduler {
    ctx: Arc<RuntimeCtx>,
    evt_tx: Sender<Event>,
    handle: Option<JoinHandle<()>>,
}

impl Scheduler {
    pub const fn new(ctx: Arc<RuntimeCtx>, evt_tx: Sender<Event>) -> Self {
        Self {
            ctx,
            evt_tx,
            handle: None,
        }
    }

    pub fn spawn(&mut self) {
        let ctx = self.ctx.clone();
        let evt_tx = self.evt_tx.clone();
        self.handle = Some(tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(30));
            tick.tick().await; // first immediate tick
            loop {
                tick.tick().await;
                if let Err(e) = check_and_run(&ctx, &evt_tx).await {
                    let _ = evt_tx.send(Event::Toast {
                        kind: crate::runtime::ToastKind::Warning,
                        msg: format!("调度检查失败: {e}"),
                    });
                }
            }
        }));
    }
}

async fn check_and_run(ctx: &Arc<RuntimeCtx>, evt_tx: &Sender<Event>) -> anyhow::Result<()> {
    let tasks = ctx.db.list_tasks()?;
    let now = Utc::now();
    for mut t in tasks {
        if !t.enabled {
            continue;
        }
        let due = match next_fire(&t.cron_expr, now) {
            Ok(next) => {
                // fire if next fire time is in the past (i.e. we passed it) and
                // we haven't run since the previous fire window.
                let last = t.last_run.unwrap_or(DateTime::UNIX_EPOCH);
                next <= now && next > last
            }
            Err(_) => false,
        };
        if due {
            let conv = Conversation {
                id: uuid::Uuid::new_v4(),
                agent_id: t.agent_id.clone(),
                student_id: None,
                title: format!("[定时] {}", t.name),
                created_at: now,
                updated_at: now,
            };
            ctx.db.upsert_conversation(&conv)?;
            let _ = evt_tx.send(Event::ConversationCreated(conv.clone()));
            let prompt = t.prompt.clone();
            let agent_id = t.agent_id.clone();
            t.last_run = Some(now);
            t.next_run = next_fire(&t.cron_expr, now).ok();
            ctx.db.upsert_task(&t)?;
            // run the turn (streams into UI)
            if let Err(e) =
                crate::ai::run_turn(ctx.clone(), evt_tx.clone(), conv.id, agent_id, None, prompt)
                    .await
            {
                let _ = evt_tx.send(Event::Toast {
                    kind: crate::runtime::ToastKind::Error,
                    msg: format!("定时任务「{}」失败: {e}", t.name),
                });
            }
        }
    }
    Ok(())
}

/// Compute the next fire time after `after` for a 5/6/7-field cron expression.
pub fn next_fire(expr: &str, after: DateTime<Utc>) -> anyhow::Result<DateTime<Utc>> {
    // Accept 5-field cron by appending a seconds field of 0 if needed.
    let normalized = if expr.split_whitespace().count() == 5 {
        format!("0 {expr}")
    } else {
        expr.to_string()
    };
    let schedule = Schedule::from_str(&normalized)
        .map_err(|e| anyhow::anyhow!("cron 解析失败: {e}"))?;
    schedule
        .after(&after)
        .next()
        .ok_or_else(|| anyhow::anyhow!("cron 无未来触发时间"))
}

/// Validate a cron expression without computing the next fire.
pub fn validate(expr: &str) -> Result<(), String> {
    next_fire(expr, Utc::now() + Duration::seconds(1)).map(|_| ()).map_err(|e| e.to_string())
}
