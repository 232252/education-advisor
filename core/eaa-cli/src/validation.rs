use crate::types::AppError;

/// Validate delta is within reasonable range
pub fn validate_delta(delta: f64, force: bool) -> Result<(), AppError> {
    if delta < -10.0 || delta > 10.0 {
        if force {
            Ok(())
        } else {
            Err(AppError::Validation(format!(
                "delta {:.1} 超出范围 [-10, +10]，使用 --force 强制执行", delta
            )))
        }
    } else {
        Ok(())
    }
}

/// Check if an event can be reverted (not already reverted)
pub fn can_revert(reverted_by: &Option<String>, event_id: &str) -> Result<(), AppError> {
    if reverted_by.is_some() {
        Err(AppError::Validation(format!("{} 已被撤销 (by {})", event_id, reverted_by.as_ref().unwrap())))
    } else {
        Ok(())
    }
}
