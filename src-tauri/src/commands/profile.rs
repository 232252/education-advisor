//! Profile commands — 学生档案 IPC (3 个通道, `profile:*`)。

use serde_json::Value;
use tauri::State;

use crate::error::Result;
use crate::services::profile_service::AcademicExamRecord;
use crate::state::AppState;

#[tauri::command]
pub async fn profile_get(state: State<'_, AppState>, name: String) -> Result<Value> {
    let data = state.profile.write().get(&name)?;
    Ok(serde_json::json!({ "success": true, "data": data }))
}

#[tauri::command]
pub async fn profile_set(state: State<'_, AppState>, name: String, data: Value) -> Result<Value> {
    state.profile.write().set(&name, data)?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn profile_validate_academic(
    _state: State<'_, AppState>,
    records: Vec<Value>,
) -> Result<Value> {
    let recs: Vec<AcademicExamRecord> = records
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();
    let errors = crate::services::profile_service::ProfileService::validate_academic(&recs);
    Ok(serde_json::json!({ "success": errors.is_empty(), "errors": errors }))
}
