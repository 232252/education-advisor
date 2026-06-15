//! Compliance commands — 合规报告 IPC (4 个通道, `compliance:*`)。

use serde_json::{json, Value};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn compliance_generate(
    state: State<'_, AppState>,
    start_ms: i64,
    end_ms: i64,
    label: Option<String>,
) -> Result<Value> {
    let audit = state.privacy_audit.read();
    match audit.generate_report(start_ms, end_ms, &label.unwrap_or_default()) {
        Ok(report) => Ok(json!({ "success": true, "report": report })),
        Err(e) => Ok(json!({ "success": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn compliance_list(state: State<'_, AppState>) -> Result<Value> {
    let audit = state.privacy_audit.read();
    let count = audit.line_count().unwrap_or(0);
    let now = chrono::Utc::now().timestamp_millis();
    let quarter_len: i64 = 90 * 24 * 3600 * 1000;
    Ok(json!({
        "success": true,
        "auditLogLineCount": count,
        "previousQuarter": { "start": now - 2 * quarter_len, "end": now - quarter_len, "label": "上一季度" },
        "currentQuarter": { "start": now - quarter_len, "end": now, "label": "本季度" },
    }))
}

#[tauri::command]
pub async fn compliance_save(_state: State<'_, AppState>, report_json: String, dest_path: String) -> Result<Value> {
    match std::fs::write(&dest_path, report_json.as_bytes()) {
        Ok(_) => Ok(json!({ "success": true, "filePath": dest_path, "bytes": report_json.len() })),
        Err(e) => Ok(json!({ "success": false, "error": e.to_string() })),
    }
}

#[tauri::command]
pub async fn compliance_read_audit(state: State<'_, AppState>, opts: Option<Value>) -> Result<Value> {
    let limit = opts.and_then(|o| o.get("limit").and_then(|l| l.as_u64())).unwrap_or(200) as usize;
    let audit = state.privacy_audit.read();
    let entries = audit.read(limit).unwrap_or_default();
    let out: Vec<Value> = entries
        .into_iter()
        .map(|e| {
            json!({
                "ts": e.ts, "op": e.op, "inputLen": e.input_len, "outputLen": e.output_len,
                "hasPII": e.has_pii, "piiCount": e.pii_count, "receiver": e.receiver,
                "entityType": e.entity_type, "durationMs": e.duration_ms, "success": e.success, "error": e.error,
            })
        })
        .collect();
    Ok(json!({ "success": true, "entries": out }))
}
