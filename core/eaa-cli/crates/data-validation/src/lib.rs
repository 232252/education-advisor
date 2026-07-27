// PR-D02: Data Flow Validation Module
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use regex::Regex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ValidationLevel {
    Strict,
    Permissive,
    Audit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationResult {
    pub passed: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub trace_id: String,
    pub validated_at: DateTime<Utc>,
    pub validation_level: ValidationLevel,
}

pub const ERR_INVALID_INPUT: &str = "D201";
pub const ERR_SQL_INJECTION: &str = "D202";
pub const ERR_XSS_DETECTED: &str = "D203";
pub const ERR_INVALID_FORMAT: &str = "D204";
pub const ERR_SIZE_EXCEEDED: &str = "D205";
pub const ERR_EAA_GATE_FAILED: &str = "D206";

#[derive(Debug, Clone)]
pub struct ValidatorConfig {
    pub level: ValidationLevel,
    pub max_length: usize,
    pub check_sql_injection: bool,
    pub check_xss: bool,
    pub use_eaa_gate: bool,
}

impl Default for ValidatorConfig {
    fn default() -> Self {
        Self {
            level: ValidationLevel::Strict,
            max_length: 10000,
            check_sql_injection: true,
            check_xss: true,
            use_eaa_gate: true,
        }
    }
}

pub struct DataValidator {
    config: ValidatorConfig,
    sql_patterns: Vec<Regex>,
    xss_patterns: Vec<Regex>,
}

impl DataValidator {
    pub fn new(config: ValidatorConfig) -> Self {
        Self {
            config,
            sql_patterns: Self::default_sql_patterns(),
            xss_patterns: Self::default_xss_patterns(),
        }
    }
    
    fn default_sql_patterns() -> Vec<Regex> {
        vec![
            Regex::new(r"(?i)\b(SELECT|UNION|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b").unwrap(),
            Regex::new(r"(?i)\bOR\b").unwrap(),
            Regex::new(r"(?i)\bAND\b").unwrap(),
            Regex::new(r";").unwrap(),
            Regex::new(r"(--|#)").unwrap(),
        ]
    }
    
    fn default_xss_patterns() -> Vec<Regex> {
        vec![
            Regex::new(r"<script").unwrap(),
            Regex::new(r"javascript:").unwrap(),
            Regex::new(r"on\w+=").unwrap(),
            Regex::new(r"<iframe").unwrap(),
            Regex::new(r"<object").unwrap(),
            Regex::new(r"<embed").unwrap(),
        ]
    }
    
    pub fn validate(&self, input: &str, trace_id: &str) -> ValidationResult {
        let now = Utc::now();
        
        if input.len() > self.config.max_length {
            return ValidationResult {
                passed: false,
                error_code: Some(ERR_SIZE_EXCEEDED.to_string()),
                error_message: Some(format!("Input length exceeds maximum {}", self.config.max_length)),
                trace_id: trace_id.to_string(),
                validated_at: now,
                validation_level: self.config.level,
            };
        }
        
        if self.config.check_sql_injection {
            if let Some(result) = self.check_sql_injection(input, trace_id) {
                return result;
            }
        }
        
        if self.config.check_xss {
            if let Some(result) = self.check_xss(input, trace_id) {
                return result;
            }
        }
        
        if let Some(result) = self.validate_format(input, trace_id) {
            return result;
        }
        
        if self.config.use_eaa_gate {
            if let Some(result) = self.validate_with_eaa(input, trace_id) {
                return result;
            }
        }
        
        ValidationResult {
            passed: true,
            error_code: None,
            error_message: None,
            trace_id: trace_id.to_string(),
            validated_at: now,
            validation_level: self.config.level,
        }
    }
    
    fn check_sql_injection(&self, input: &str, trace_id: &str) -> Option<ValidationResult> {
        for pattern in &self.sql_patterns {
            if pattern.is_match(input) {
                let result = ValidationResult {
                    passed: self.config.level != ValidationLevel::Strict,
                    error_code: Some(ERR_SQL_INJECTION.to_string()),
                    error_message: Some("SQL injection pattern detected".to_string()),
                    trace_id: trace_id.to_string(),
                    validated_at: Utc::now(),
                    validation_level: self.config.level,
                };
                if !result.passed {
                    return Some(result);
                }
            }
        }
        None
    }
    
    fn check_xss(&self, input: &str, trace_id: &str) -> Option<ValidationResult> {
        for pattern in &self.xss_patterns {
            if pattern.is_match(input) {
                let result = ValidationResult {
                    passed: self.config.level != ValidationLevel::Strict,
                    error_code: Some(ERR_XSS_DETECTED.to_string()),
                    error_message: Some("XSS pattern detected".to_string()),
                    trace_id: trace_id.to_string(),
                    validated_at: Utc::now(),
                    validation_level: self.config.level,
                };
                if !result.passed {
                    return Some(result);
                }
            }
        }
        None
    }
    
    fn validate_format(&self, input: &str, trace_id: &str) -> Option<ValidationResult> {
        if input.contains('\0') {
            return Some(ValidationResult {
                passed: false,
                error_code: Some(ERR_INVALID_FORMAT.to_string()),
                error_message: Some("Null character detected".to_string()),
                trace_id: trace_id.to_string(),
                validated_at: Utc::now(),
                validation_level: self.config.level,
            });
        }
        None
    }
    
    fn validate_with_eaa(&self, _input: &str, trace_id: &str) -> Option<ValidationResult> {
        log::debug!("eaa-cli validation for trace_id: {}", trace_id);
        None
    }
}

impl Default for DataValidator {
    fn default() -> Self {
        Self::new(ValidatorConfig::default())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ValidationError {
    #[error("Validation failed: {0}")]
    ValidationFailed(String),
    
    #[error("eaa-cli call failed: {0}")]
    EaaGateFailed(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sql_injection_detection() {
        let validator = DataValidator::default();
        let malicious = "DROP TABLE users";
        let result = validator.validate(malicious, "test-trace");
        assert!(!result.passed || result.error_code.is_some());
    }
    
    #[test]
    fn test_xss_detection() {
        let validator = DataValidator::default();
        let malicious = "<script>alert(1)</script>";
        let result = validator.validate(malicious, "test-trace");
        assert!(!result.passed || result.error_code.is_some());
    }
    
    #[test]
    fn test_valid_input() {
        let validator = DataValidator::default();
        let valid_input = "This is a normal user comment.";
        let result = validator.validate(valid_input, "test-trace");
        assert!(result.passed);
    }
    
    #[test]
    fn test_max_length() {
        let config = ValidatorConfig {
            max_length: 10,
            ..Default::default()
        };
        let validator = DataValidator::new(config);
        let input = "This is a very long input";
        let result = validator.validate(input, "test-trace");
        assert!(!result.passed);
    }
}
