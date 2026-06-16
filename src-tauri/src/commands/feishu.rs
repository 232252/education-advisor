//! Feishu commands — 飞书集成 IPC (7 个通道, `feishu:*`)。
//! appSecret 从 keystore 读取 (前端不传); send_preflight/send_confirm 走隐私引擎。

use serde_json::{json, Value};
use tauri::State;

use crate::error::{AppError, Result};
use crate::services::feishu_service::PreflightReport;
use crate::state::AppState;

#[tauri::command]
pub async fn feishu_test(state: State<'_, AppState>, app_id: String) -> Result<Value> {
    let secret = state
        .keystore
        .get(&format!("feishu:{app_id}"))?
        .ok_or_else(|| AppError::Feishu("未设置 appSecret".into()))?;
    let r = state.feishu.test(&app_id, &secret).await?;
    Ok(json!({ "success": true, "token": r.0, "expireSec": r.1 }))
}

#[tauri::command]
pub async fn feishu_bitable(
    state: State<'_, AppState>,
    app_id: String,
    app_token: String,
) -> Result<Value> {
    let secret = state
        .keystore
        .get(&format!("feishu:{app_id}"))?
        .ok_or_else(|| AppError::Feishu("未设置 appSecret".into()))?;
    let token = state.feishu.test(&app_id, &secret).await?.0;
    let tables = state.feishu.list_bitable(&token, &app_token).await?;
    Ok(json!({ "success": true, "tables": tables }))
}

#[tauri::command]
pub async fn feishu_send(
    state: State<'_, AppState>,
    app_id: String,
    user_open_id: String,
    text: String,
) -> Result<Value> {
    let secret = state
        .keystore
        .get(&format!("feishu:{app_id}"))?
        .ok_or_else(|| AppError::Feishu("未设置 appSecret".into()))?;
    let token = state.feishu.test(&app_id, &secret).await?.0;
    let msg_id = state
        .feishu
        .send_text(&token, "open_id", &user_open_id, &text)
        .await?;
    Ok(json!({ "success": true, "messageId": msg_id }))
}

#[tauri::command]
pub async fn feishu_send_preflight(
    state: State<'_, AppState>,
    app_id: String,
    user_open_id: String,
    text: String,
) -> Result<PreflightReport> {
    // app_id / user_open_id 是 IPC 契约参数 (前端 sendPreflight 必传),
    // 但 preflight 阶段只做本地 PII 检测, 不实际发送, 故未使用其值。
    let _ = (app_id, user_open_id);
    let enabled = *state.privacy_enabled.read();
    let redacted = if enabled {
        state.privacy.read().filter_for_receiver(&text, "parent")
    } else {
        text.clone()
    };
    let original_length = text.len();
    let has_pii = redacted != text;
    Ok(PreflightReport {
        has_pii,
        entities: vec![],
        redacted,
        original: text,
        original_length,
        privacy_enabled: enabled,
        error: None,
    })
}

#[derive(serde::Deserialize)]
pub struct SendConfirmArgs {
    pub decision: String, // cancel | redacted | original
}

#[tauri::command]
pub async fn feishu_send_confirm(
    state: State<'_, AppState>,
    app_id: String,
    user_open_id: String,
    text: String,
    args: SendConfirmArgs,
) -> Result<Value> {
    if args.decision == "cancel" {
        return Ok(json!({ "success": false, "blocked": true }));
    }
    let secret = state
        .keystore
        .get(&format!("feishu:{app_id}"))?
        .ok_or_else(|| AppError::Feishu("未设置 appSecret".into()))?;
    let token = state.feishu.test(&app_id, &secret).await?.0;
    let to_send = if args.decision == "redacted" {
        state.privacy.read().filter_for_receiver(&text, "parent")
    } else {
        text
    };
    let msg_id = state
        .feishu
        .send_text(&token, "open_id", &user_open_id, &to_send)
        .await?;
    Ok(json!({ "success": true, "messageId": msg_id, "sentTextLength": to_send.len() }))
}

#[tauri::command]
pub async fn feishu_status(state: State<'_, AppState>) -> Result<String> {
    let has_secret = state.keystore.get("feishu:appSecret")?.is_some();
    Ok(if has_secret {
        "configured"
    } else {
        "not_configured"
    }
    .into())
}

#[tauri::command]
pub async fn feishu_sync_now(
    state: State<'_, AppState>,
    app_id: String,
    app_token: String,
    table_id: String,
    fields: Value,
) -> Result<Value> {
    let secret = state
        .keystore
        .get(&format!("feishu:{app_id}"))?
        .ok_or_else(|| AppError::Feishu("未设置 appSecret".into()))?;
    let token = state.feishu.test(&app_id, &secret).await?.0;
    let record_id = state
        .feishu
        .bitable_create_record(&token, &app_token, &table_id, fields)
        .await?;
    Ok(json!({ "success": true, "recordId": record_id }))
}
