use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// === Constants ===
pub const BASE_SCORE: f64 = 100.0;
pub const MAX_DELTA: f64 = 10.0;
pub const MIN_DELTA: f64 = -10.0;

// === Error types ===
#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Student not found: {0}")]
    StudentNotFound(String),
    #[error("Event not found: {0}")]
    EventNotFound(String),
    #[error("Validation failed: {0}")]
    Validation(String),
}

// === Event types ===
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventType {
    ConductDeduct,
    ConductBonus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntityStatus {
    Active,
    Transferred,
    Suspended,
}

// === Entity ===
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub status: EntityStatus,
    pub created_at: String,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

// === Event (core data unit) ===
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_id: String,
    pub entity_id: String,
    pub event_type: EventType,
    #[serde(default)]
    pub category_tags: Vec<String>,
    pub reason_code: String,
    pub original_reason: String,
    pub score_delta: f64,
    pub evidence_ref: String,
    pub operator: String,
    pub timestamp: String,
    pub is_valid: bool,
    pub reverted_by: Option<String>,
    #[serde(default)]
    pub note: String,
}

// === Data file types ===
#[derive(Debug, Deserialize, Serialize)]
pub struct EntitiesFile {
    pub entities: HashMap<String, Entity>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ReasonCodeDef {
    #[serde(default)]
    pub score_delta: Option<f64>,
    pub label: String,
    pub category: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ReasonCodesFile {
    pub version: String,
    pub codes: HashMap<String, ReasonCodeDef>,
}

/// Build reverse lookup: entity_id → name
pub fn build_id_to_name(index: &HashMap<String, String>) -> HashMap<String, String> {
    index.iter().map(|(k, v)| (v.clone(), k.clone())).collect()
}
