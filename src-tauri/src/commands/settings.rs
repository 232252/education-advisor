//! Settings commands — 设置 IPC (3 个通道, `settings:*`)。

use serde_json::Value;
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<Value> {
    Ok(state.settings.read().get())
}

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, path: String, value: Value) -> Result<Value> {
    state.settings.write().update(&path, value)?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn settings_reset(state: State<'_, AppState>) -> Result<Value> {
    state.settings.write().reset()?;
    Ok(serde_json::json!({ "success": true }))
}
