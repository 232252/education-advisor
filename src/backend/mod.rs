/// Storage backend abstraction.
/// EAA_BACKEND=filesystem (default) | postgres

pub mod filesystem;
#[cfg(feature = "postgres")]
pub mod postgres;

use crate::types::*;
use std::collections::HashMap;

/// Unified storage trait - both backends implement this.
pub trait Storage: Send + Sync {
    fn load_entities(&self) -> Result<EntitiesFile, AppError>;
    fn load_events(&self) -> Result<Vec<Event>, AppError>;
    fn load_name_index(&self) -> Result<HashMap<String, String>, AppError>;
    fn save_events(&self, events: &[Event]) -> Result<(), AppError>;
    fn save_entities(&self, entities: &EntitiesFile) -> Result<(), AppError>;
    fn save_name_index(&self, index: &HashMap<String, String>) -> Result<(), AppError>;
    fn append_operation_log(&self, entry: &serde_json::Value) -> Result<(), AppError>;
}

/// Select backend based on EAA_BACKEND env var.
pub fn create_backend() -> Box<dyn Storage> {
    let backend = std::env::var("EAA_BACKEND").unwrap_or_default();
    match backend.as_str() {
        #[cfg(feature = "postgres")]
        "postgres" => {
            let db_url = std::env::var("DATABASE_URL")
                .expect("DATABASE_URL required for postgres backend");
            Box::new(postgres::PostgresBackend::new(&db_url))
        }
        _ => Box::new(filesystem::FsBackend),
    }
}
