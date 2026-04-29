/// PostgreSQL storage backend with RLS multi-tenant isolation.

use crate::types::*;
use std::collections::HashMap;

use super::Storage;

pub struct PostgresBackend {
    // We'll use synchronous wrappers around tokio+sqlx
    // For now, use direct psql subprocess calls for simplicity
    // Full SQLx async integration in next iteration
    db_url: String,
    tenant_id: String,
}

impl PostgresBackend {
    pub fn new(db_url: &str) -> Self {
        let tenant_id = std::env::var("EAA_TENANT_ID")
            .unwrap_or_else(|_| "a0000000-0000-0000-0000-000000000001".to_string());
        Self {
            db_url: db_url.to_string(),
            tenant_id,
        }
    }

    fn exec_sql(&self, sql: &str) -> Result<String, AppError> {
        let output = std::process::Command::new("psql")
            .args(["-U", "postgres", "-d", "eaa", "-t", "-A", "-c", sql])
            .output()
            .map_err(|e| AppError::Io(e))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Validation(format!("SQL error: {}", err)));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn exec_sql_silent(&self, sql: &str) -> Result<(), AppError> {
        let output = std::process::Command::new("psql")
            .args(["-U", "postgres", "-d", "eaa", "-c", sql])
            .output()
            .map_err(|e| AppError::Io(e))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Validation(format!("SQL error: {}", err)));
        }
        Ok(())
    }
}

impl Storage for PostgresBackend {
    fn load_entities(&self) -> Result<EntitiesFile, AppError> {
        let sql = format!(
            "SELECT json_agg(json_build_object('id', entity_id, 'name', name, 'aliases', aliases, 'status', status, 'groups', groups, 'roles', roles, 'class_id', class_id, 'metadata', metadata, 'created_at', created_at)) FROM entities WHERE tenant_id = '{}'",
            self.tenant_id
        );
        let result = self.exec_sql(&sql)?;
        // Parse and convert to EntitiesFile format
        let rows: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap_or_default();
        let mut entities = HashMap::new();
        for row in rows {
            let id = row["id"].as_str().unwrap_or("").to_string();
            let entity = Entity {
                id: id.clone(),
                name: row["name"].as_str().unwrap_or("").to_string(),
                aliases: row["aliases"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
                status: match row["status"].as_str().unwrap_or("ACTIVE") {
                    "ACTIVE" => EntityStatus::Active,
                    "TRANSFERRED" => EntityStatus::Transferred,
                    "SUSPENDED" => EntityStatus::Suspended,
                    _ => EntityStatus::Active,
                },
                created_at: row["created_at"].as_str().unwrap_or("").to_string(),
                metadata: row["metadata"].as_object().map(|o| o.iter().map(|(k,v)| (k.clone(), v.clone())).collect()).unwrap_or_default(),
                groups: row["groups"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
                roles: row["roles"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
                class_id: row["class_id"].as_str().map(String::from),
            };
            entities.insert(id, entity);
        }
        Ok(EntitiesFile { entities })
    }

    fn load_events(&self) -> Result<Vec<Event>, AppError> {
        let sql = format!(
            "SELECT json_agg(json_build_object('event_id', event_id, 'entity_id', entity_id, 'event_type', event_type, 'category_tags', category_tags, 'reason_code', reason_code, 'original_reason', original_reason, 'score_delta', score_delta, 'evidence_ref', evidence_ref, 'operator', operator, 'note', note, 'timestamp', occurred_at, 'is_valid', is_valid, 'reverted_by', reverted_by) ORDER BY stream_seq) FROM events WHERE tenant_id = '{}'",
            self.tenant_id
        );
        let result = self.exec_sql(&sql)?;
        let rows: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap_or_default();
        let mut events = Vec::new();
        for row in rows {
            let evt = Event {
                event_id: row["event_id"].as_str().unwrap_or("").to_string(),
                entity_id: row["entity_id"].as_str().unwrap_or("").to_string(),
                event_type: match row["event_type"].as_str().unwrap_or("CONDUCT_DEDUCT") {
                    "CONDUCT_DEDUCT" => EventType::ConductDeduct,
                    "CONDUCT_BONUS" => EventType::ConductBonus,
                    _ => EventType::ConductDeduct,
                },
                category_tags: row["category_tags"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default(),
                reason_code: row["reason_code"].as_str().unwrap_or("").to_string(),
                original_reason: row["original_reason"].as_str().unwrap_or("").to_string(),
                score_delta: row["score_delta"].as_f64().unwrap_or(0.0),
                evidence_ref: row["evidence_ref"].as_str().unwrap_or("").to_string(),
                operator: row["operator"].as_str().unwrap_or("").to_string(),
                timestamp: row["timestamp"].as_str().unwrap_or("").to_string(),
                is_valid: row["is_valid"].as_bool().unwrap_or(true),
                reverted_by: row["reverted_by"].as_str().map(String::from),
                note: row["note"].as_str().unwrap_or("").to_string(),
            };
            events.push(evt);
        }
        Ok(events)
    }

    fn load_name_index(&self) -> Result<HashMap<String, String>, AppError> {
        let sql = format!(
            "SELECT json_object_agg(name, entity_id) FROM entities WHERE tenant_id = '{}'",
            self.tenant_id
        );
        let result = self.exec_sql(&sql)?;
        if result.is_empty() || result == "null" {
            return Ok(HashMap::new());
        }
        Ok(serde_json::from_str(&result).unwrap_or_default())
    }

    fn save_events(&self, _events: &[Event]) -> Result<(), AppError> {
        // PostgreSQL backend uses INSERT per event (append-only), not bulk overwrite
        Err(AppError::Validation("Use append_event for PostgreSQL backend".to_string()))
    }

    fn save_entities(&self, entities: &EntitiesFile) -> Result<(), AppError> {
        for (eid, entity) in &entities.entities {
            let sql = format!(
                "INSERT INTO entities (tenant_id, entity_id, name, status, metadata, created_at) VALUES ('{}', '{}', '{}', '{}', '{}'::jsonb, '{}') ON CONFLICT (tenant_id, entity_id) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status",
                self.tenant_id,
                eid.replace("'", "''"),
                entity.name.replace("'", "''"),
                match entity.status { EntityStatus::Active => "ACTIVE", EntityStatus::Transferred => "TRANSFERRED", EntityStatus::Suspended => "SUSPENDED" },
                serde_json::to_string(&entity.metadata).unwrap_or_default().replace("'", "''"),
                entity.created_at.replace("'", "''"),
            );
            self.exec_sql_silent(&sql)?;
        }
        Ok(())
    }

    fn save_name_index(&self, _index: &HashMap<String, String>) -> Result<(), AppError> {
        // Name index is derived from entities table in PG, no separate storage needed
        Ok(())
    }

    fn append_operation_log(&self, entry: &serde_json::Value) -> Result<(), AppError> {
        let sql = format!(
            "INSERT INTO operation_log (tenant_id, operation, operator, details) VALUES ('{}', '{}', '{}', '{}'::jsonb)",
            self.tenant_id,
            entry["operation"].as_str().unwrap_or("").replace("'", "''"),
            entry["operator"].as_str().unwrap_or("").replace("'", "''"),
            serde_json::to_string(entry).unwrap_or_default().replace("'", "''"),
        );
        self.exec_sql_silent(&sql)
    }
}
