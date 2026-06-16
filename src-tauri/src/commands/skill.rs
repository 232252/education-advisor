//! Skill commands — 技能管理 IPC (5 个通道, `skill:*`)。

use serde_json::Value;
use tauri::State;

use crate::error::Result;
use crate::services::skill_service::Skill;
use crate::state::AppState;

#[tauri::command]
pub async fn skill_list(state: State<'_, AppState>) -> Result<Vec<Skill>> {
    Ok(state.skills.read().list())
}

#[tauri::command]
pub async fn skill_get(state: State<'_, AppState>, name: String) -> Result<Option<Skill>> {
    Ok(state.skills.read().get(&name))
}

#[tauri::command]
pub async fn skill_save(
    state: State<'_, AppState>,
    name: String,
    content: String,
) -> Result<Value> {
    state.skills.write().save(&name, &content)?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn skill_delete(state: State<'_, AppState>, name: String) -> Result<Value> {
    match state.skills.write().delete(&name) {
        Ok(_) => Ok(serde_json::json!({ "success": true })),
        Err(e) => Ok(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn skill_set_enabled(
    state: State<'_, AppState>,
    name: String,
    enabled: bool,
) -> Result<Value> {
    match state.skills.write().set_enabled(&name, enabled) {
        Ok(_) => Ok(serde_json::json!({ "success": true })),
        Err(e) => Ok(serde_json::json!({ "success": false, "error": e.to_string() })),
    }
}
