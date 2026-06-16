//! Privacy commands — 隐私引擎 IPC (12 个通道, `privacy:*`)。
//! 包装 `eaa_core::privacy::PrivacyEngine`, 每次操作写入隐私审计日志
//! (services/privacy_audit)。enable/disable 切换广播 `privacy:state-changed`。

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::error::{AppError, Result};
use crate::services::broadcaster;
use crate::services::privacy_audit::AuditEntry;
use crate::state::AppState;
use crate::{events, EAAResult};

/// 记一条隐私审计 + 计时。
async fn audited<F>(
    state: &State<'_, AppState>,
    op: &str,
    receiver: Option<String>,
    entity_type: Option<String>,
    f: F,
) -> (Value, Result<Value>)
where
    F: FnOnce() -> Result<Value>,
{
    let start = std::time::Instant::now();
    let res = f();
    let dur = start.elapsed().as_millis() as u64;
    let (success, out, err) = match &res {
        Ok(v) => (true, v.clone(), None),
        Err(e) => (false, Value::Null, Some(e.to_string())),
    };
    let entry = AuditEntry {
        ts: chrono::Utc::now().timestamp_millis(),
        op: op.to_string(),
        input_len: 0,
        output_len: 0,
        has_pii: false,
        pii_count: 0,
        receiver,
        entity_type,
        duration_ms: dur,
        success,
        error: err.clone(),
    };
    if let Err(e) = state.privacy_audit.read().append(&entry) {
        tracing::warn!(target: "privacy", "audit append 失败: {e}");
    }
    (out, res)
}

#[tauri::command]
pub async fn privacy_init(
    state: State<'_, AppState>,
    password: String,
    auto_scan: Option<bool>,
) -> Result<EAAResult<Value>> {
    let data_dir = state.paths.eaa_data.clone();
    let (out, res) = audited(&state, "init", None, None, || {
        let mut eng = state.privacy.write();
        eng.init(&data_dir, &password)
            .map_err(|e| AppError::Privacy(e.to_string()))?;
        if auto_scan.unwrap_or(false) {
            let n = eng
                .auto_scan_students(&data_dir)
                .map_err(|e| AppError::Privacy(e.to_string()))?;
            Ok(json!({ "mappings": eng.mapping_count(), "scanned": n }))
        } else {
            Ok(json!({ "mappings": eng.mapping_count() }))
        }
    })
    .await;
    match res {
        Ok(_) => Ok(EAAResult::ok(out)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn privacy_load(
    state: State<'_, AppState>,
    password: String,
) -> Result<EAAResult<Value>> {
    let data_dir = state.paths.eaa_data.clone();
    let (out, res) = audited(&state, "load", None, None, || {
        let mut eng = state.privacy.write();
        eng.load(&data_dir, &password)
            .map_err(|e| AppError::Privacy(e.to_string()))?;
        Ok(json!({ "mappings": eng.mapping_count() }))
    })
    .await;
    match res {
        Ok(_) => Ok(EAAResult::ok(out)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn privacy_enable(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<EAAResult<Value>> {
    *state.privacy_enabled.write() = true;
    let _ = broadcaster::emit_all(
        &app,
        events::PRIVACY_STATE_CHANGED,
        json!({ "enabled": true, "at": chrono::Utc::now().timestamp_millis() }),
    );
    Ok(EAAResult::ok(json!({ "enabled": true })))
}

#[tauri::command]
pub async fn privacy_disable(
    app: AppHandle,
    state: State<'_, AppState>,
    _password: String,
) -> Result<EAAResult<Value>> {
    *state.privacy_enabled.write() = false;
    let _ = broadcaster::emit_all(
        &app,
        events::PRIVACY_STATE_CHANGED,
        json!({ "enabled": false, "at": chrono::Utc::now().timestamp_millis() }),
    );
    Ok(EAAResult::ok(json!({ "enabled": false })))
}

#[tauri::command]
pub async fn privacy_list(
    state: State<'_, AppState>,
    _password: String,
) -> Result<EAAResult<Value>> {
    let eng = state.privacy.read();
    let list = eng.list_mappings();
    // MappingEntry 在 eaa_core 未派生 Serialize, 这里手动转 JSON。
    let arr: Vec<Value> = list
        .into_iter()
        .map(|e| json!({ "entityType": e.entity_type, "alias": e.alias, "realName": e.real_name }))
        .collect();
    Ok(EAAResult::ok(Value::Array(arr)))
}

#[tauri::command]
pub async fn privacy_add(
    state: State<'_, AppState>,
    entity_type: String,
    text: String,
) -> Result<EAAResult<Value>> {
    let (out, res) = audited(&state, "add", None, Some(entity_type.clone()), || {
        let et = eaa_core::privacy::EntityType::from_str(&entity_type);
        let mut eng = state.privacy.write();
        let alias = eng
            .add_entity(&et, &text)
            .map_err(|e| AppError::Privacy(e.to_string()))?;
        Ok(json!({ "alias": alias, "entityType": entity_type }))
    })
    .await;
    match res {
        Ok(_) => Ok(EAAResult::ok(out)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn privacy_anonymize(
    state: State<'_, AppState>,
    text: String,
) -> Result<EAAResult<Value>> {
    if !*state.privacy_enabled.read() {
        return Ok(EAAResult::ok(json!({ "result": text }))); // 未启用 → 原样返回
    }
    let (out, res) = audited(&state, "anonymize", Some("llm".into()), None, || {
        let eng = state.privacy.read();
        Ok(json!({ "result": eng.anonymize(&text), "originalLength": text.len() }))
    })
    .await;
    match res {
        Ok(_) => Ok(EAAResult::ok(out)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn privacy_deanonymize(
    state: State<'_, AppState>,
    text: String,
) -> Result<EAAResult<Value>> {
    let (out, res) = audited(&state, "deanonymize", Some("teacher".into()), None, || {
        let eng = state.privacy.read();
        Ok(json!({ "result": eng.deanonymize(&text) }))
    })
    .await;
    match res {
        Ok(_) => Ok(EAAResult::ok(out)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn privacy_filter(
    state: State<'_, AppState>,
    receiver: String,
    text: String,
) -> Result<EAAResult<Value>> {
    let (out, res) = audited(&state, "filter", Some(receiver.clone()), None, || {
        let eng = state.privacy.read();
        Ok(json!({ "result": eng.filter_for_receiver(&text, &receiver) }))
    })
    .await;
    match res {
        Ok(_) => Ok(EAAResult::ok(out)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn privacy_dryrun(state: State<'_, AppState>, text: String) -> Result<EAAResult<Value>> {
    let (out, res) = audited(&state, "dryrun", None, None, || {
        let eng = state.privacy.read();
        Ok(json!({ "anonymized": eng.anonymize(&text), "deanonymized": eng.deanonymize(&text) }))
    })
    .await;
    match res {
        Ok(_) => Ok(EAAResult::ok(out)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn privacy_backup(
    state: State<'_, AppState>,
    dest_path: String,
) -> Result<EAAResult<Value>> {
    let eng = state.privacy.read();
    eng.backup(&std::path::PathBuf::from(&dest_path))
        .map_err(|e| AppError::Privacy(e.to_string()))?;
    Ok(EAAResult::ok(json!({ "path": dest_path })))
}
