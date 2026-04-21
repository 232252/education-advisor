//! 实体（学生）定义

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::enums::EntityStatus;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Entity {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub status: EntityStatus,
    pub created_at: String,
    #[serde(default)]
    pub metadata: HashMap<String, serde_json::Value>,
}

impl Entity {
    /// 校验：该学生状态下能否接收此事件
    pub fn can_accept_event(&self, event_type: &str) -> Result<(), String> {
        match self.status {
            EntityStatus::Active => Ok(()),
            EntityStatus::Transferred => {
                if event_type != "System" {
                    return Err(format!(
                        "防呆拦截：学生 {} 已转学，无法添加 {} 事件",
                        self.name, event_type
                    ));
                }
                Ok(())
            }
            EntityStatus::Suspended => {
                if event_type != "System" {
                    return Err(format!(
                        "防呆拦截：学生 {} 已休学，无法添加 {} 事件",
                        self.name, event_type
                    ));
                }
                Ok(())
            }
        }
    }
}
