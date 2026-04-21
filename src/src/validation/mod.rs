//! 校验层——三道防线的统一入口

use super::types::entity::Entity;
use super::types::event::SchoolEvent;
use super::types::enums::EntityStatus;
use super::types::error::AIRejectError;
use super::storage::load_reason_codes;

/// 完整校验流程（Add 事件时调用）
pub fn validate_add_event(
    entity: &Entity,
    event: &SchoolEvent,
    reason_code_str: &str,
) -> Result<(), AIRejectError> {
    // 第一道防线：结构校验（已在 Serde 反序列化时完成）
    event.validate().map_err(|e| AIRejectError::business_rule(&e))?;

    // 第二道防线：原因码存在性校验
    let codes = load_reason_codes()?;
    if !codes.codes.contains_key(reason_code_str) {
        return Err(AIRejectError::invalid_value(
            "reason_code",
            &format!("未知原因码: {}，请使用 `copaw codes` 查看所有合法原因码", reason_code_str),
        ));
    }

    // 第三道防线：状态机校验
    let event_type = match event {
        SchoolEvent::Discipline(_) => "Discipline",
        SchoolEvent::Bonus(_) => "Bonus",
        SchoolEvent::Attendance(_) => "Attendance",
        SchoolEvent::System(_) => "System",
    };
    entity.can_accept_event(event_type).map_err(|e| AIRejectError::business_rule(&e))?;

    Ok(())
}
