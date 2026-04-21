use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use thiserror::Error;

// === Constants ===
pub const BASE_SCORE: f64 = 100.0;
pub const MAX_DELTA: f64 = 10.0;
pub const MIN_DELTA: f64 = -10.0;

#[derive(Error, Debug)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasonCode {
    SpeakInClass,
    SleepInClass,
    Late,
    SchoolCaught,
    Makeup,
    DeskUnaligned,
    PhoneInClass,
    Smoking,
    DrinkingDorm,
    OtherDeduct,
    AppearanceViolation,
    BonusVariable,
    ActivityParticipation,
    ClassMonitor,
    ClassCommittee,
    CivilizedDorm,
    MonthlyAttendance,
    Revert,
    LabEquipmentDamage,
    LabSafetyViolation,
    LabUnsafeBehavior,
    LabCleanUp,
}

impl fmt::Display for ReasonCode {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match serde_json::to_value(self) {
            Ok(v) => match v.as_str() {
                Some(s) => write!(f, "{}", s),
                None => write!(f, "UNKNOWN"),
            },
            Err(_) => write!(f, "UNKNOWN"),
        }
    }
}

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

#[derive(Debug, Deserialize, Serialize)]
pub struct EntitiesFile {
    pub entities: HashMap<String, Entity>,
}

#[derive(Debug, Deserialize)]
pub struct ReasonCodeDef {
    #[serde(default)]
    pub score_delta: Option<f64>,
    pub label: String,
    pub category: String,
}

#[derive(Debug, Deserialize)]
pub struct ReasonCodesFile {
    pub version: String,
    pub codes: HashMap<String, ReasonCodeDef>,
}

pub fn build_id_to_name(index: &HashMap<String, String>) -> HashMap<String, String> {
    index.iter().map(|(k, v)| (v.clone(), k.clone())).collect()
}
