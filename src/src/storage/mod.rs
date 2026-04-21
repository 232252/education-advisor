//! 存储层——原子写入 + 文件锁 + 降级解析

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use std::io::Write;

use super::types::entity::Entity;
use super::types::envelope::{EventEnvelope, EventPayload, LegacyPayload};
use super::types::error::AIRejectError;

const DATA_DIR: &str = "/vol2/copaw-data/data";
const SCHEMA_DIR: &str = "/vol2/copaw-data/schema";

// ─── 实体存储 ───

#[derive(Debug, serde::Deserialize)]
struct EntitiesFile {
    pub entities: HashMap<String, Entity>,
}

pub fn load_entities() -> Result<HashMap<String, Entity>, AIRejectError> {
    let path = PathBuf::from(DATA_DIR).join("entities/entities.json");
    let data = fs::read_to_string(&path)
        .map_err(|e| AIRejectError::malformed_json(&format!("无法读取 entities.json: {}", e)))?;
    let file: EntitiesFile = serde_json::from_str(&data)
        .map_err(|e| AIRejectError::malformed_json(&format!("entities.json 格式错误: {}", e)))?;
    Ok(file.entities)
}

pub fn load_name_index() -> Result<HashMap<String, String>, AIRejectError> {
    let path = PathBuf::from(DATA_DIR).join("entities/name_index.json");
    let data = fs::read_to_string(&path)
        .map_err(|e| AIRejectError::malformed_json(&format!("无法读取 name_index.json: {}", e)))?;
    serde_json::from_str(&data)
        .map_err(|e| AIRejectError::malformed_json(&format!("name_index.json 格式错误: {}", e)))
}

// ─── 事件存储（降级解析） ───

pub fn load_events() -> Result<Vec<EventEnvelope>, AIRejectError> {
    let path = PathBuf::from(DATA_DIR).join("events/events.json");
    let data = fs::read_to_string(&path)
        .map_err(|e| AIRejectError::malformed_json(&format!("无法读取 events.json: {}", e)))?;
    
    // 先尝试新格式
    if let Ok(events) = serde_json::from_str::<Vec<EventEnvelope>>(&data) {
        return Ok(events);
    }

    // 降级：尝试从旧格式迁移
    migrate_from_v1(&data)
}

/// 从旧版弱类型事件迁移到新信封格式
fn migrate_from_v1(data: &str) -> Result<Vec<EventEnvelope>, AIRejectError> {
    use super::types::newtypes::EventId;
    use chrono::Utc;

    let old_events: Vec<serde_json::Value> = serde_json::from_str(data)
        .map_err(|e| AIRejectError::malformed_json(&format!("旧版 events.json 也无法解析: {}", e)))?;

    let mut envelopes = Vec::new();

    for old in &old_events {
        let event_id = old.get("event_id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        
        let entity_id = old.get("entity_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        
        let timestamp = old.get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        
        let score_delta = old.get("score_delta")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        
        let is_valid = old.get("is_valid")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        
        let reverted_by = old.get("reverted_by")
            .and_then(|v| v.as_str())
            .map(|s| EventId(s.to_string()));

        let reason_code = old.get("reason_code")
            .and_then(|v| v.as_str())
            .unwrap_or("UNKNOWN")
            .to_string();

        let legacy = LegacyPayload {
            event_type: old.get("event_type").and_then(|v| v.as_str()).map(|s| s.to_string()),
            reason_code: Some(reason_code),
            score_delta,
            raw_data: old.clone(),
        };

        envelopes.push(EventEnvelope {
            event_id: EventId(event_id),
            entity_id,
            timestamp,
            schema_version: 1,
            payload: EventPayload::Legacy(legacy),
            is_valid,
            reverted_by,
        });
    }

    Ok(envelopes)
}

// ─── 原子写入 ───

/// 原子追加事件：写临时文件 → rename
pub fn append_events_atomic(new_events: &[EventEnvelope]) -> Result<(), AIRejectError> {
    let mut existing = load_events().unwrap_or_default();
    existing.extend(new_events.iter().cloned());

    let path = PathBuf::from(DATA_DIR).join("events/events.json");
    let tmp_path = path.with_extension("tmp");

    // 写临时文件
    let json = serde_json::to_string_pretty(&existing)
        .map_err(|e| AIRejectError::malformed_json(&format!("序列化失败: {}", e)))?;
    
    let mut f = fs::File::create(&tmp_path)
        .map_err(|e| AIRejectError::malformed_json(&format!("创建临时文件失败: {}", e)))?;
    f.write_all(json.as_bytes())
        .map_err(|e| AIRejectError::malformed_json(&format!("写入临时文件失败: {}", e)))?;
    f.sync_all()
        .map_err(|e| AIRejectError::malformed_json(&format!("sync 失败: {}", e)))?;
    drop(f);

    // 原子 rename
    fs::rename(&tmp_path, &path)
        .map_err(|e| AIRejectError::malformed_json(&format!("重命名失败: {}", e)))?;

    Ok(())
}

// ─── 原因码 ───

#[derive(Debug, serde::Deserialize)]
pub struct ReasonCodeDef {
    pub score_delta: Option<f64>,
    pub label: String,
    pub category: String,
}

#[derive(Debug, serde::Deserialize)]
pub struct ReasonCodesFile {
    pub version: String,
    pub codes: HashMap<String, ReasonCodeDef>,
}

pub fn load_reason_codes() -> Result<ReasonCodesFile, AIRejectError> {
    let path = PathBuf::from(SCHEMA_DIR).join("reason_codes.json");
    let data = fs::read_to_string(&path)
        .map_err(|e| AIRejectError::malformed_json(&format!("无法读取 reason_codes.json: {}", e)))?;
    serde_json::from_str(&data)
        .map_err(|e| AIRejectError::malformed_json(&format!("reason_codes.json 格式错误: {}", e)))
}

// ─── 分数计算 ───

pub fn compute_scores(
    entities: &HashMap<String, Entity>,
    events: &[EventEnvelope],
) -> HashMap<String, f64> {
    let mut scores: HashMap<String, f64> = entities.keys().map(|k| (k.clone(), 100.0)).collect();
    for evt in events {
        if evt.is_valid && evt.reverted_by.is_none() {
            *scores.entry(evt.entity_id.clone()).or_insert(100.0) += evt.score_delta();
        }
    }
    scores
}

pub fn build_id_to_name(index: &HashMap<String, String>) -> HashMap<String, String> {
    index.iter().map(|(k, v)| (v.clone(), k.clone())).collect()
}

pub fn resolve_entity_id(name: &str, index: &HashMap<String, String>) -> Result<String, AIRejectError> {
    index.get(name).cloned().ok_or_else(|| AIRejectError::student_not_found(name))
}
