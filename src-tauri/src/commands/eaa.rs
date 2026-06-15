//! EAA commands — 数据引擎 IPC (21 个通道, `eaa:*`)。
//! 薄包装 `eaa_core::storage`, 返回 `EAAResult<Value>` 对齐前端契约。
//! 数据写入后向窗口广播事件 (`eaa:event-added` 等), 让所有页面实时刷新。

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::error::Result;
use crate::services::broadcaster;
use crate::state::AppState;
use crate::{EAAResult, events};

/// eaa:info — 系统概览。
#[tauri::command]
pub async fn eaa_info(_state: State<'_, AppState>) -> Result<Value> {
    let entities = eaa_core::storage::load_entities().map_err(crate::error::other)?;
    let events = eaa_core::storage::load_events().map_err(crate::error::other)?;
    Ok(json!({
        "version": eaa_core::VERSION,
        "studentCount": entities.entities.len(),
        "eventCount": events.len(),
        "dataDir": eaa_core::storage::get_data_dir().display().to_string(),
    }))
}

#[tauri::command]
pub async fn eaa_score(state: State<'_, AppState>, name: String) -> Result<EAAResult<Value>> {
    let _ = &state;
    let res = crate::tools::eaa_tools::dispatch("score", &json!({ "name": name }), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_ranking(_state: State<'_, AppState>, n: Option<u64>) -> Result<EAAResult<Value>> {
    let res = crate::tools::eaa_tools::dispatch("ranking", &json!({ "n": n.unwrap_or(10) }), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_replay(_state: State<'_, AppState>) -> Result<EAAResult<Value>> {
    // replay = 重算排行 (与 ranking 等价但语义是"重放事件")
    let res = crate::tools::eaa_tools::dispatch("ranking", &json!({ "n": 200 }), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

/// 前端 AddEventParams 用 camelCase (studentName/reasonCode/classId),
/// 这里用 serde rename 对齐, 避免 TS↔Rust 字段名不匹配导致反序列化失败。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddEventArgs {
    #[serde(rename = "studentName")]
    pub name: String,
    pub reason_code: String,
    #[serde(default)]
    pub delta: f64,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub force: bool,
}

#[tauri::command]
pub async fn eaa_add_event(
    app: AppHandle,
    _state: State<'_, AppState>,
    params: AddEventArgs,
) -> Result<EAAResult<Value>> {
    let args = json!({
        "name": params.name,
        "reasonCode": params.reason_code,
        "delta": params.delta,
        "note": params.note,
        "operator": params.operator,
    });
    let res = crate::tools::eaa_tools::dispatch("add_event", &args, &["*".into()]);
    match res {
        Ok(v) => {
            // 广播事件添加, 前端订阅 eaa:event-added 刷新
            let payload = json!({
                "studentName": params.name,
                "reasonCode": params.reason_code,
                "delta": params.delta,
                "at": chrono::Utc::now().timestamp_millis(),
            });
            let _ = broadcaster::emit_all(&app, events::EAA_EVENT_ADDED, payload);
            Ok(EAAResult::ok(v))
        }
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_revert_event(
    app: AppHandle,
    _state: State<'_, AppState>,
    event_id: String,
    reason: String,
) -> Result<EAAResult<Value>> {
    let args = json!({ "eventId": event_id, "reason": reason });
    let res = crate::tools::eaa_tools::dispatch("revert", &args, &["*".into()]);
    match res {
        Ok(v) => {
            let _ = broadcaster::emit_all(&app, events::EAA_EVENT_REVERTED, json!({
                "eventId": event_id, "at": chrono::Utc::now().timestamp_millis()
            }));
            Ok(EAAResult::ok(v))
        }
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_history(_state: State<'_, AppState>, name: String) -> Result<EAAResult<Value>> {
    let res = crate::tools::eaa_tools::dispatch("history", &json!({ "name": name }), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_search(
    _state: State<'_, AppState>,
    query: String,
    limit: Option<u64>,
) -> Result<EAAResult<Value>> {
    let res = crate::tools::eaa_tools::dispatch("search", &json!({ "query": query, "limit": limit.unwrap_or(50) }), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_range(
    _state: State<'_, AppState>,
    start: String,
    end: String,
    limit: Option<u64>,
) -> Result<EAAResult<Value>> {
    // 直接 filter events by timestamp range
    let events = eaa_core::storage::load_events().map_err(crate::error::other)?;
    let id2name = eaa_core::types::build_id_to_name(&eaa_core::storage::load_name_index().map_err(crate::error::other)?);
    let hits: Vec<Value> = events
        .iter()
        .filter(|e| e.timestamp >= start && e.timestamp <= end)
        .take(limit.unwrap_or(100) as usize)
        .map(|e| json!({
            "eventId": e.event_id,
            "name": id2name.get(&e.entity_id),
            "reasonCode": e.reason_code,
            "delta": e.score_delta,
            "timestamp": e.timestamp,
        }))
        .collect();
    Ok(EAAResult::ok(json!({ "events": hits, "count": hits.len() })))
}

#[tauri::command]
pub async fn eaa_tag(_state: State<'_, AppState>, tag: Option<String>) -> Result<EAAResult<Value>> {
    let events = eaa_core::storage::load_events().map_err(crate::error::other)?;
    match tag {
        None => {
            // 列出所有 tag
            let mut tags: std::collections::HashMap<String, u64> = Default::default();
            for e in &events {
                for t in &e.category_tags {
                    *tags.entry(t.clone()).or_default() += 1;
                }
            }
            Ok(EAAResult::ok(json!({ "tags": tags })))
        }
        Some(t) => {
            let hits: Vec<Value> = events
                .iter()
                .filter(|e| e.category_tags.iter().any(|c| c == &t))
                .take(100)
                .map(|e| json!({ "eventId": e.event_id, "reasonCode": e.reason_code, "delta": e.score_delta }))
                .collect();
            Ok(EAAResult::ok(json!({ "tag": t, "events": hits })))
        }
    }
}

#[tauri::command]
pub async fn eaa_stats(_state: State<'_, AppState>) -> Result<EAAResult<Value>> {
    let res = crate::tools::eaa_tools::dispatch("stats", &json!({}), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_validate(_state: State<'_, AppState>) -> Result<EAAResult<Value>> {
    let events = eaa_core::storage::load_events().map_err(crate::error::other)?;
    let codes = eaa_core::storage::load_reason_codes().map_err(crate::error::other)?;
    let invalid: Vec<Value> = events
        .iter()
        .filter(|e| !codes.codes.contains_key(&e.reason_code) && e.reason_code != "REVERT")
        .map(|e| json!({ "eventId": e.event_id, "reasonCode": e.reason_code }))
        .collect();
    Ok(EAAResult::ok(json!({
        "totalEvents": events.len(),
        "invalidEvents": invalid.len(),
        "invalid": invalid,
    })))
}

#[tauri::command]
pub async fn eaa_export(
    _state: State<'_, AppState>,
    format: String,
    output_file: Option<String>,
) -> Result<EAAResult<Value>> {
    let events = eaa_core::storage::load_events().map_err(crate::error::other)?;
    let id2name = eaa_core::types::build_id_to_name(&eaa_core::storage::load_name_index().map_err(crate::error::other)?);
    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&events).unwrap_or_default(),
        "csv" => {
            let mut s = String::from("event_id,name,reason_code,delta,timestamp,note\n");
            for e in &events {
                let name = id2name.get(&e.entity_id).cloned().unwrap_or_default();
                s.push_str(&format!("{},{},{},{},{},{}\n", e.event_id, name, e.reason_code, e.score_delta, e.timestamp, e.note.replace(',', "，")));
            }
            s
        }
        "markdown" => {
            // markdown 表格 (对齐原版 export 的 markdown 格式)
            let mut s = String::from("# 事件导出\n\n| 事件ID | 学生 | 原因码 | 分值 | 时间 |\n|---|---|---|---|---|\n");
            for e in &events {
                let name = id2name.get(&e.entity_id).cloned().unwrap_or_default();
                s.push_str(&format!("| {} | {} | {} | {} | {} |\n", e.event_id, name, e.reason_code, e.score_delta, e.timestamp));
            }
            s
        }
        "html" => {
            // 简单 HTML 表格 (对齐原版, 前端 Dashboard 页可直接渲染)
            let mut rows = String::new();
            for e in &events {
                let name = id2name.get(&e.entity_id).cloned().unwrap_or_default();
                rows.push_str(&format!("<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>", e.event_id, name, e.reason_code, e.score_delta, e.timestamp));
            }
            format!("<!DOCTYPE html><html><head><meta charset='utf-8'><title>事件导出</title><style>body{{font-family:sans-serif}}table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:4px 8px}}</style></head><body><h1>事件导出</h1><table><thead><tr><th>事件ID</th><th>学生</th><th>原因码</th><th>分值</th><th>时间</th></tr></thead><tbody>{rows}</tbody></table></body></html>")
        }
        _ => return Ok(EAAResult::fail(format!("不支持的格式: {format} (支持 csv/json/markdown/html)"))),
    };
    if let Some(p) = output_file {
        std::fs::write(&p, &content).map_err(crate::error::other)?;
        Ok(EAAResult::ok(json!({ "path": p, "bytes": content.len() })))
    } else {
        Ok(EAAResult::ok(json!({ "content": content, "bytes": content.len() })))
    }
}

#[tauri::command]
pub async fn eaa_list_students(_state: State<'_, AppState>) -> Result<EAAResult<Value>> {
    let res = crate::tools::eaa_tools::dispatch("list", &json!({}), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_add_student(
    app: AppHandle,
    _state: State<'_, AppState>,
    name: String,
) -> Result<EAAResult<Value>> {
    let _lock = eaa_core::storage::FileLock::acquire().map_err(crate::error::other)?;
    let mut entities = eaa_core::storage::load_entities().map_err(crate::error::other)?;
    let mut index = eaa_core::storage::load_name_index().map_err(crate::error::other)?;
    if index.contains_key(&name) {
        return Ok(EAAResult::fail(format!("学生已存在: {name}")));
    }
    let id = format!("S_{}", uuid::Uuid::new_v4().simple());
    entities.entities.insert(
        name.clone(),
        eaa_core::Entity {
            id: id.clone(),
            name: name.clone(),
            aliases: vec![],
            status: eaa_core::EntityStatus::Active,
            created_at: chrono::Utc::now().to_rfc3339(),
            metadata: Default::default(),
            groups: vec![],
            roles: vec![],
            class_id: None,
        },
    );
    index.insert(name.clone(), id.clone());
    eaa_core::storage::save_entities(&entities).map_err(crate::error::other)?;
    eaa_core::storage::save_name_index(&index).map_err(crate::error::other)?;
    let _ = broadcaster::emit_all(&app, events::EAA_STUDENT_ADDED, json!({ "name": name, "at": chrono::Utc::now().timestamp_millis() }));
    Ok(EAAResult::ok(json!({ "id": id, "name": name })))
}

#[derive(serde::Deserialize)]
pub struct DeleteStudentArgs {
    #[serde(default)]
    pub confirm: Option<bool>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn eaa_delete_student(
    app: AppHandle,
    _state: State<'_, AppState>,
    name: String,
    args: Option<DeleteStudentArgs>,
) -> Result<EAAResult<Value>> {
    let args = args.unwrap_or(DeleteStudentArgs { confirm: Some(true), reason: None });
    if !args.confirm.unwrap_or(false) {
        return Ok(EAAResult::fail("删除需 confirm=true"));
    }
    let _lock = eaa_core::storage::FileLock::acquire().map_err(crate::error::other)?;
    let mut entities = eaa_core::storage::load_entities().map_err(crate::error::other)?;
    let mut index = eaa_core::storage::load_name_index().map_err(crate::error::other)?;
    if index.remove(&name).is_none() {
        return Ok(EAAResult::fail(format!("学生不存在: {name}")));
    }
    entities.entities.remove(&name);
    eaa_core::storage::save_entities(&entities).map_err(crate::error::other)?;
    eaa_core::storage::save_name_index(&index).map_err(crate::error::other)?;
    let _ = broadcaster::emit_all(&app, events::EAA_STUDENT_DELETED, json!({ "name": name, "at": chrono::Utc::now().timestamp_millis() }));
    Ok(EAAResult::ok(json!({ "deleted": name })))
}

#[tauri::command]
pub async fn eaa_set_student_meta(
    _state: State<'_, AppState>,
    params: Value,
) -> Result<EAAResult<Value>> {
    let _lock = eaa_core::storage::FileLock::acquire().map_err(crate::error::other)?;
    let mut entities = eaa_core::storage::load_entities().map_err(crate::error::other)?;
    let name = params.get("name").and_then(|v| v.as_str()).ok_or_else(|| crate::error::AppError::Validation("缺少 name".into()))?;
    let entry = entities.entities.get_mut(name).ok_or_else(|| crate::error::AppError::NotFound(format!("学生 {name}")))?;
    if let Some(g) = params.get("group").and_then(|v| v.as_str()) {
        entry.groups = vec![g.to_string()];
    }
    if let Some(r) = params.get("role").and_then(|v| v.as_str()) {
        entry.roles = vec![r.to_string()];
    }
    if let Some(c) = params.get("classId").and_then(|v| v.as_str()) {
        entry.class_id = Some(c.to_string());
    }
    eaa_core::storage::save_entities(&entities).map_err(crate::error::other)?;
    Ok(EAAResult::ok(json!({ "updated": name })))
}

#[tauri::command]
pub async fn eaa_import(_state: State<'_, AppState>, file_path: String) -> Result<EAAResult<Value>> {
    // 简化: 读 CSV/JSON 批量插入事件
    let content = std::fs::read_to_string(&file_path).map_err(crate::error::other)?;
    let imported = if file_path.ends_with(".json") {
        let events: Vec<eaa_core::Event> = serde_json::from_str(&content).map_err(crate::error::other)?;
        let len = events.len();
        eaa_core::storage::save_events(&events).map_err(crate::error::other)?;
        len
    } else {
        return Ok(EAAResult::fail("仅支持 .json 导入"));
    };
    Ok(EAAResult::ok(json!({ "imported": imported })))
}

#[tauri::command]
pub async fn eaa_codes(_state: State<'_, AppState>) -> Result<EAAResult<Value>> {
    let res = crate::tools::eaa_tools::dispatch("codes", &json!({}), &["*".into()]);
    match res {
        Ok(v) => Ok(EAAResult::ok(v)),
        Err(e) => Ok(EAAResult::fail(e.to_string())),
    }
}

#[tauri::command]
pub async fn eaa_doctor(_state: State<'_, AppState>) -> Result<EAAResult<Value>> {
    // 健康检查: 校验事件/索引一致性
    let entities = eaa_core::storage::load_entities().map_err(crate::error::other)?;
    let events = eaa_core::storage::load_events().map_err(crate::error::other)?;
    let index = eaa_core::storage::load_name_index().map_err(crate::error::other)?;
    let issues: Vec<String> = Vec::new();
    let mut orphan_events = 0u64;
    for e in &events {
        if !index.values().any(|id| id == &e.entity_id) {
            orphan_events += 1;
        }
    }
    Ok(EAAResult::ok(json!({
        "studentCount": entities.entities.len(),
        "eventCount": events.len(),
        "orphanEvents": orphan_events,
        "issues": issues,
        "healthy": orphan_events == 0,
    })))
}

#[tauri::command]
pub async fn eaa_summary(
    _state: State<'_, AppState>,
    since: Option<String>,
    until: Option<String>,
) -> Result<EAAResult<Value>> {
    let events = eaa_core::storage::load_events().map_err(crate::error::other)?;
    let filtered: Vec<_> = events
        .iter()
        .filter(|e| {
            let ok_since = since.as_ref().map(|s| &e.timestamp >= s).unwrap_or(true);
            let ok_until = until.as_ref().map(|u| &e.timestamp <= u).unwrap_or(true);
            ok_since && ok_until
        })
        .collect();
    let total: f64 = filtered.iter().filter(|e| e.is_valid).map(|e| e.score_delta).sum();
    Ok(EAAResult::ok(json!({
        "since": since,
        "until": until,
        "eventCount": filtered.len(),
        "totalDelta": total,
    })))
}

#[tauri::command]
pub async fn eaa_dashboard(_state: State<'_, AppState>, output_dir: Option<String>) -> Result<EAAResult<Value>> {
    // 简化: 返回排行 + 统计数据 (前端用 ECharts 渲染, 不生成静态 HTML)
    let ranking = crate::tools::eaa_tools::dispatch("ranking", &json!({ "n": 50 }), &["*".into()])?;
    let stats = crate::tools::eaa_tools::dispatch("stats", &json!({}), &["*".into()])?;
    Ok(EAAResult::ok(json!({ "ranking": ranking, "stats": stats, "outputDir": output_dir })))
}
