//! Cron commands — 调度器 IPC (7 个通道, `cron:*`)。

use serde_json::Value;
use tauri::State;

use crate::error::Result;
use crate::services::scheduler::CronTask;
use crate::state::AppState;

#[tauri::command]
pub async fn cron_list(state: State<'_, AppState>) -> Result<Vec<CronTask>> {
    Ok(state.scheduler.lock().await.list())
}

#[tauri::command]
pub async fn cron_add(state: State<'_, AppState>, task: Value) -> Result<String> {
    let task: CronTask = serde_json::from_value(task)?;
    state.scheduler.lock().await.add(task).await
}

#[tauri::command]
pub async fn cron_update(state: State<'_, AppState>, id: String, patch: Value) -> Result<Value> {
    let mut task = state
        .scheduler
        .lock()
        .await
        .get(&id)
        .ok_or_else(|| crate::error::AppError::NotFound(format!("cron {id}")))?;
    if let Some(n) = patch.get("name").and_then(|v| v.as_str()) {
        task.name = n.into();
    }
    if let Some(c) = patch.get("cron").and_then(|v| v.as_str()) {
        task.cron = c.into();
    }
    if let Some(e) = patch.get("enabled").and_then(|v| v.as_bool()) {
        task.enabled = e;
    }
    state.scheduler.lock().await.reschedule(task).await?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn cron_remove(state: State<'_, AppState>, id: String) -> Result<Value> {
    state.scheduler.lock().await.remove(&id).await?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn cron_toggle(state: State<'_, AppState>, id: String, enabled: bool) -> Result<Value> {
    state.scheduler.lock().await.toggle(&id, enabled).await?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn cron_run_now(state: State<'_, AppState>, id: String) -> Result<Value> {
    let db = state.db.clone();
    state.scheduler.lock().await.run_now(&id, db).await?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn cron_get_logs(state: State<'_, AppState>, task_id: Option<String>) -> Result<Value> {
    let rows = state
        .db
        .lock()
        .await
        .get_cron_logs(task_id.as_deref())
        .await?;
    Ok(serde_json::json!(rows))
}
