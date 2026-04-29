/// Filesystem storage backend (default, existing implementation).

use crate::types::*;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use fs2::FileExt;
use serde::Serialize;

use super::Storage;

pub struct FsBackend;

fn get_data_dir() -> PathBuf {
    std::env::var("EAA_DATA_DIR").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("./data"))
}

fn get_schema_dir() -> PathBuf {
    let data_dir = get_data_dir();
    let candidate = data_dir.parent().map(|p| p.join("schema"));
    if let Some(ref s) = candidate {
        if s.join("reason_codes.json").exists() {
            return s.clone();
        }
    }
    PathBuf::from("./schema")
}

fn atomic_write_json<T: Serialize + ?Sized>(path: &PathBuf, data: &T) -> Result<(), AppError> {
    let tmp = path.with_extension("tmp");
    let mut f = fs::File::create(&tmp)?;
    let json = serde_json::to_string_pretty(data)?;
    f.write_all(json.as_bytes())?;
    f.sync_all()?;
    fs::rename(&tmp, path)?;
    Ok(())
}

impl Storage for FsBackend {
    fn load_entities(&self) -> Result<EntitiesFile, AppError> {
        let path = get_data_dir().join("entities/entities.json");
        let f = fs::File::open(path)?;
        Ok(serde_json::from_reader(f)?)
    }

    fn load_events(&self) -> Result<Vec<Event>, AppError> {
        let path = get_data_dir().join("events/events.json");
        let f = fs::File::open(path)?;
        Ok(serde_json::from_reader(f)?)
    }

    fn load_name_index(&self) -> Result<HashMap<String, String>, AppError> {
        let path = get_data_dir().join("entities/name_index.json");
        let f = fs::File::open(path)?;
        Ok(serde_json::from_reader(f)?)
    }

    fn save_events(&self, events: &[Event]) -> Result<(), AppError> {
        let path = get_data_dir().join("events/events.json");
        // Acquire lock
        let lock_path = get_data_dir().join(".lock");
        if let Some(parent) = lock_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let lock_file = fs::File::create(&lock_path)?;
        lock_file.lock_exclusive()?;
        let result = atomic_write_json(&path, events);
        let _ = lock_file.unlock();
        result
    }

    fn save_entities(&self, entities: &EntitiesFile) -> Result<(), AppError> {
        let path = get_data_dir().join("entities/entities.json");
        atomic_write_json(&path, entities)
    }

    fn save_name_index(&self, index: &HashMap<String, String>) -> Result<(), AppError> {
        let path = get_data_dir().join("entities/name_index.json");
        atomic_write_json(&path, index)
    }

    fn append_operation_log(&self, entry: &serde_json::Value) -> Result<(), AppError> {
        let log_dir = get_data_dir().join("logs");
        fs::create_dir_all(&log_dir)?;
        let log_path = log_dir.join("operations.jsonl");
        let mut f = fs::OpenOptions::new().create(true).append(true).open(log_path)?;
        let line = format!("{}\n", serde_json::to_string(entry)?);
        f.write_all(line.as_bytes())?;
        Ok(())
    }
}
