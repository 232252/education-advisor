//! 事件信封——历史兼容 + 不可变追加

use serde::{Deserialize, Serialize};
use super::newtypes::EventId;
use super::event::SchoolEvent;

/// 事件信封：包含元数据 + 智能载荷
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope {
    pub event_id: EventId,
    pub entity_id: String,
    pub timestamp: String,
    /// Schema 版本号（用于未来迁移）
    pub schema_version: u32,
    /// 智能载荷：优先强类型，降级兜底
    pub payload: EventPayload,
    /// 是否有效（被撤销后为 false 的旧事件保留此标记）
    pub is_valid: bool,
    /// 被哪个事件撤销
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverted_by: Option<EventId>,
}

/// 智能载荷枚举：先尝试强类型，失败则降级
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum EventPayload {
    /// 当前版本的强类型事件
    Current(SchoolEvent),
    /// 历史遗留/损坏/旧版本数据
    Legacy(LegacyPayload),
}

/// 兜底结构：保留原始 JSON，不丢失
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyPayload {
    /// 原始事件类型标识
    #[serde(rename = "legacy_type", default, skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    /// 原始原因码
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    /// 分数变化（旧格式兼容）
    #[serde(default)]
    pub score_delta: f64,
    /// 原始数据完整保留
    #[serde(default)]
    pub raw_data: serde_json::Value,
}

impl EventEnvelope {
    /// 获取分数变化（只有强类型事件参与精确计算）
    pub fn score_delta(&self) -> f64 {
        match &self.payload {
            EventPayload::Current(event) => event.score_delta(),
            EventPayload::Legacy(legacy) => legacy.score_delta,
        }
    }

    /// 是否为遗留数据
    pub fn is_legacy(&self) -> bool {
        matches!(self.payload, EventPayload::Legacy(_))
    }
}
