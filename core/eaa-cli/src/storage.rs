use crate::types::*;
use fs2::FileExt;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub fn get_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("EAA_DATA_DIR") {
        PathBuf::from(dir)
    } else {
        PathBuf::from("./data")
    }
}

pub fn get_schema_dir() -> PathBuf {
    let data_dir = get_data_dir();
    let candidate = data_dir.parent().map(|p| p.join("schema"));
    if let Some(ref s) = candidate {
        if s.join("reason_codes.json").exists() {
            return s.clone();
        }
    }
    PathBuf::from("./schema")
}

fn get_lock_path() -> PathBuf {
    get_data_dir().join(".lock")
}

/// RAII file lock that auto-releases on Drop
pub struct FileLock {
    _file: fs::File,
}

impl FileLock {
    pub fn acquire() -> Result<Self, AppError> {
        let lock_path = get_lock_path();
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let f = fs::File::create(&lock_path)?;
        f.lock_exclusive()?;
        Ok(Self { _file: f })
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = self._file.unlock();
    }
}

pub fn atomic_write_json<T: Serialize + ?Sized>(path: &PathBuf, data: &T) -> Result<(), AppError> {
    let tmp = path.with_extension("tmp");
    let mut f = fs::File::create(&tmp)?;
    let json = serde_json::to_string_pretty(data)?;
    f.write_all(json.as_bytes())?;
    f.sync_all()?;
    fs::rename(&tmp, path)?;
    Ok(())
}

pub fn load_entities() -> Result<EntitiesFile, AppError> {
    let path = get_data_dir().join("entities/entities.json");
    let f = fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

pub fn load_events() -> Result<Vec<Event>, AppError> {
    let path = get_data_dir().join("events/events.json");
    let f = fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

pub fn load_name_index() -> Result<HashMap<String, String>, AppError> {
    let path = get_data_dir().join("entities/name_index.json");
    let f = fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

pub fn load_reason_codes() -> Result<ReasonCodesFile, AppError> {
    let path = get_schema_dir().join("reason_codes.json");
    let f = fs::File::open(path)?;
    Ok(serde_json::from_reader(f)?)
}

pub fn resolve_entity_id(name: &str, index: &HashMap<String, String>) -> Result<String, AppError> {
    index.get(name).cloned().ok_or_else(|| AppError::StudentNotFound(name.to_string()))
}

pub fn compute_scores(entities: &std::collections::HashMap<String, Entity>, events: &[Event]) -> HashMap<String, f64> {
    let mut scores: HashMap<String, f64> = entities.keys().map(|k| (k.clone(), BASE_SCORE)).collect();
    for evt in events {
        if evt.is_valid && evt.reverted_by.is_none() {
            *scores.entry(evt.entity_id.clone()).or_insert(BASE_SCORE) += evt.score_delta;
        }
    }
    scores
}

/// Compute cumulative scores at each event (for history JSON output)
pub fn compute_cumulative_history(
    entity_id: &str,
    events: &[Event],
    base_score: f64,
) -> Vec<serde_json::Value> {
    let mut cum = base_score;
    let mut history = Vec::new();
    for evt in events {
        if evt.entity_id == entity_id {
            cum += evt.score_delta;
            history.push(serde_json::json!({
                "event_id": evt.event_id,
                "timestamp": evt.timestamp,
                "event_type": format!("{:?}", evt.event_type),
                "reason_code": evt.reason_code,
                "score_delta": evt.score_delta,
                "cumulative": cum,
                "note": evt.note,
                "tags": evt.category_tags,
                "reverted": evt.reverted_by.is_some(),
            }));
        }
    }
    history
}

pub fn save_events(events: &[Event]) -> Result<(), AppError> {
    let path = get_data_dir().join("events/events.json");
    atomic_write_json(&path, events)
}

pub fn save_entities(entities: &EntitiesFile) -> Result<(), AppError> {
    let path = get_data_dir().join("entities/entities.json");
    atomic_write_json(&path, entities)
}

pub fn save_name_index(index: &HashMap<String, String>) -> Result<(), AppError> {
    let path = get_data_dir().join("entities/name_index.json");
    atomic_write_json(&path, index)
}

pub fn append_operation_log(entry: &serde_json::Value) -> Result<(), AppError> {
    let log_dir = get_data_dir().join("logs");
    fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("operations.jsonl");
    let mut f = fs::OpenOptions::new().create(true).append(true).open(log_path)?;
    let line = format!("{}\n", serde_json::to_string(entry)?);
    f.write_all(line.as_bytes())?;
    Ok(())
}

pub fn generate_event_id() -> String {
    let id = uuid::Uuid::new_v4();
    format!("evt_{}", &id.to_string().replace("-", "")[..12])
}

pub fn get_operator(cli_operator: Option<&str>) -> String {
    if let Some(op) = cli_operator {
        return op.to_string();
    }
    if let Ok(op) = std::env::var("EAA_OPERATOR") {
        return op;
    }
    "班主任".to_string()
}

/// Determine risk level from score
pub fn risk_level(score: f64) -> &'static str {
    if score >= 100.0 { "低" }
    else if score >= 80.0 { "中" }
    else if score >= 60.0 { "高" }
    else { "极高" }
}
