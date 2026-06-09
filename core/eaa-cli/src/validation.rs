use crate::types::{AppError, MAX_DELTA, MIN_DELTA};

/// Validate delta is within reasonable range
pub fn validate_delta(delta: f64, force: bool) -> Result<(), AppError> {
    if delta < MIN_DELTA || delta > MAX_DELTA {
        if force {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "delta {:.1} 超出范围 [{}, +{}]，使用 --force 强制执行", delta, MIN_DELTA as i32, MAX_DELTA as i32
            )))
        }
    } else {
        Ok(())
    }
}

/// Check if an event can be reverted
pub fn can_revert(reverted_by: &Option<String>, event_id: &str, reason_code: &str) -> Result<(), AppError> {
    if reverted_by.is_some() {
        return Err(AppError::Validation(format!("{} 已被撤销 (by {})", event_id, reverted_by.as_ref().unwrap())));
    }
    if reason_code == "REVERT" {
        return Err(AppError::Validation(format!("{} 是撤销事件，不可再次撤销", event_id)));
    }
    Ok(())
}
