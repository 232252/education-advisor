//! AI 友好的错误类型

use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub struct AIRejectError {
    /// 机器可读错误码
    pub error_code: String,
    /// 人类/AI 可读解释
    pub message: String,
    /// 出错字段路径
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_path: Option<String>,
    /// 期望的格式
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected: Option<String>,
}

impl AIRejectError {
    pub fn unknown_field(raw: &str) -> Self {
        Self {
            error_code: "SCHEMA_UNKNOWN_FIELD".into(),
            message: format!(
                "数据结构错误：传入了系统未定义的字段。请严格按照 JSON Schema 定义的字段提交。原始错误: {}", raw
            ),
            field_path: extract_field_path(raw),
            expected: None,
        }
    }

    pub fn type_mismatch(raw: &str) -> Self {
        Self {
            error_code: "SCHEMA_TYPE_MISMATCH".into(),
            message: format!("字段类型或枚举值错误。{}", raw),
            field_path: extract_field_path(raw),
            expected: Some("请参考 JSON Schema 中定义的 enum 值".into()),
        }
    }

    pub fn business_rule(msg: &str) -> Self {
        Self {
            error_code: "BUSINESS_RULE_VIOLATION".into(),
            message: format!("业务规则冲突：{}", msg),
            field_path: None,
            expected: None,
        }
    }

    pub fn invalid_value(field: &str, msg: &str) -> Self {
        Self {
            error_code: "INVALID_VALUE".into(),
            message: msg.to_string(),
            field_path: Some(field.to_string()),
            expected: None,
        }
    }

    pub fn malformed_json(raw: &str) -> Self {
        Self {
            error_code: "MALFORMED_JSON".into(),
            message: format!("JSON 解析彻底失败: {}", raw),
            field_path: None,
            expected: None,
        }
    }

    pub fn student_not_found(name: &str) -> Self {
        Self {
            error_code: "ENTITY_NOT_FOUND".into(),
            message: format!("学生 \"{}\" 不存在，请检查姓名拼写", name),
            field_path: Some("entity_id".into()),
            expected: Some("使用系统中已注册的学生姓名".into()),
        }
    }
}

impl fmt::Display for AIRejectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.error_code, self.message)
    }
}

impl std::error::Error for AIRejectError {}

/// 从 Serde 错误信息提取字段路径
fn extract_field_path(err: &str) -> Option<String> {
    // Serde 错误格式通常为 "unknown field `xxx`, expected one of ..."
    if let Some(start) = err.find('`') {
        if let Some(end) = err[start + 1..].find('`') {
            return Some(err[start + 1..start + 1 + end].to_string());
        }
    }
    None
}

/// 将 Serde 错误翻译为 AI 友好错误
pub fn translate_serde_error(err_str: &str) -> AIRejectError {
    if err_str.contains("unknown field") {
        AIRejectError::unknown_field(err_str)
    } else if err_str.contains("invalid type") || err_str.contains("invalid value") {
        AIRejectError::type_mismatch(err_str)
    } else if err_str.contains("单次分值变化") || err_str.contains("防呆拦截") {
        AIRejectError::business_rule(err_str)
    } else {
        AIRejectError::malformed_json(err_str)
    }
}
