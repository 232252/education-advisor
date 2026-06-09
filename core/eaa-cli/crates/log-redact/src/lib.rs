// PR-H01: Sensitive Information Redaction
// 方案H: 日志体系 - 敏感信息脱敏
// 验收标准: 日志审查通过，无敏感信息泄露
// 行数预估: 150

use regex::Regex;
use std::collections::HashMap;
use std::sync::RwLock;
use once_cell::sync::Lazy;

/// 敏感字段模式表
/// 每个正则有两个捕获组：(1)字段名 (2)字段值
static SENSITIVE_PATTERNS: Lazy<HashMap<&'static str, Regex>> = Lazy::new(|| {
    let mut m = HashMap::new();
    // password类: 字段名 + 分隔符 + 值
    m.insert("password", Regex::new(r"(?i)(password|passwd|pwd)[\s:=]+([^\s]+)").unwrap());
    m.insert("token", Regex::new(r"(?i)(token|auth_token|access_token|refresh_token)[\s:=]+([^\s]+)").unwrap());
    m.insert("secret", Regex::new(r"(?i)(secret|client_secret|app_secret)[\s:=]+([^\s]+)").unwrap());
    m.insert("api_key", Regex::new(r"(?i)(api[_-]?key|apikey)[\s:=]+([^\s]+)").unwrap());
    m.insert("card", Regex::new(r"(?i)(card|card_number|credit_card|cc_number)[\s:=]+([\d]+)").unwrap());
    m.insert("ssn", Regex::new(r"(?i)(ssn|social[_-]?security)[\s:=]+([\d\-]+)").unwrap());
    m.insert("phone", Regex::new(r"(?i)(phone|mobile|cell)[\s:=]+([\d\-\+\(\)\s]+)").unwrap());
    m.insert("email", Regex::new(r"(?i)(email|e-mail)[\s:=]+([^\s@]+@[^\s@]+\.[^\s]+)").unwrap());
    m.insert("address", Regex::new(r"(?i)(address|addr|location)[\s:=]+(.{10,})").unwrap());
    m
});

/// 脱敏规则配置
#[derive(Debug, Clone)]
pub struct RedactionConfig {
    /// 脱敏字符
    pub mask_char: char,
    /// 脱敏长度（保留首尾字符数）
    pub prefix_len: usize,
    pub suffix_len: usize,
}

impl Default for RedactionConfig {
    fn default() -> Self {
        Self {
            mask_char: '*',
            prefix_len: 0,
            suffix_len: 4,
        }
    }
}

/// 敏感信息脱敏器
pub struct SensitiveRedactor {
    config: RedactionConfig,
    /// 自定义脱敏规则（允许业务扩展）
    custom_rules: RwLock<Vec<(Regex, String)>>,
}

impl SensitiveRedactor {
    /// 创建新的脱敏器
    pub fn new() -> Self {
        Self {
            config: RedactionConfig::default(),
            custom_rules: RwLock::new(Vec::new()),
        }
    }
    
    /// 使用自定义配置创建脱敏器
    pub fn with_config(config: RedactionConfig) -> Self {
        Self {
            config,
            custom_rules: RwLock::new(Vec::new()),
        }
    }
    
    /// 添加自定义脱敏规则
    pub fn add_custom_rule(&self, pattern: &str, replacement: &str) -> Result<(), RedactionError> {
        let regex = Regex::new(pattern)
            .map_err(|e| RedactionError::InvalidRegex(e.to_string()))?;
        
        let mut rules = self.custom_rules.write()
            .map_err(|e| RedactionError::LockFailed(e.to_string()))?;
        rules.push((regex, replacement.to_string()));
        
        log::info!("Added custom redaction rule: pattern={}", pattern);
        Ok(())
    }
    
    /// 脱敏文本（核心方法）
    /// 铁律：脱敏字段输出***，保留原始长度
    pub fn redact(&self, text: &str) -> String {
        // 检测JSON格式并路由
        if text.trim_start().starts_with('{') {
            return self.redact_json(text);
        }

        let mut result = text.to_string();
        
        // Step 1: 应用内置敏感字段规则
        for (_, regex) in SENSITIVE_PATTERNS.iter() {
            result = regex.replace_all(&result, |caps: &regex::Captures| {
                self.mask_match(caps)
            }).to_string();
        }
        
        // Step 2: 应用自定义规则
        if let Ok(rules) = self.custom_rules.read() {
            for (regex, replacement) in rules.iter() {
                result = regex.replace_all(&result, replacement.as_str()).to_string();
            }
        }
        
        result
    }
    
    /// 脱敏日志行
    /// 自动识别日志格式并脱敏
    pub fn redact_log_line(&self, line: &str) -> String {
        // 如果是JSON，递归脱敏值
        if line.trim_start().starts_with('{') {
            return self.redact_json(line);
        }
        
        // 否则按普通文本脱敏
        self.redact(line)
    }
    
    /// 脱敏JSON字符串
    fn redact_json(&self, json: &str) -> String {
        let mut result = json.to_string();
        
        // 匹配 "key": "value" 模式
        let kv_pattern = Regex::new(r#"("([^"]+)")\s*:\s*("([^"]*)")"#).unwrap();
        
        result = kv_pattern.replace_all(&result, |caps: &regex::Captures| {
            let key = &caps[2];
            let value = &caps[4];
            
            // 检查key是否为敏感字段
            if self.is_sensitive_key(key) {
                format!(r#""{}": "{}""#, key, self.mask_value(value))
            } else {
                caps[0].to_string()
            }
        }).to_string();
        
        result
    }
    
    /// 检查是否为敏感key
    fn is_sensitive_key(&self, key: &str) -> bool {
        let key_lower = key.to_lowercase();
        
        // 检查内置敏感字段
        for (sensitive_key, _) in SENSITIVE_PATTERNS.iter() {
            if key_lower.contains(*sensitive_key) {
                return true;
            }
        }
        
        false
    }
    
    /// 遮罩匹配结果
    /// 使用捕获组1=字段名，捕获组2=值
    fn mask_match(&self, caps: &regex::Captures) -> String {
        // 捕获组1: 字段名 (password, token, etc.)
        let field_name = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        // 捕获组2: 原始值
        let original_value = caps.get(2).map(|m| m.as_str()).unwrap_or("");
        
        // 生成掩码（长度=原始值长度，保持长度不变）
        let masked_value = self.mask_value(original_value);
        
        // 重建: 字段名 + ": " + 掩码值
        format!("{}: {}", field_name, masked_value)
    }
    
    /// 遮罩值（保留原始长度）
    fn mask_value(&self, value: &str) -> String {
        if value.is_empty() {
            return "***".to_string();
        }

        let total_len = value.len();
        let prefix_len = self.config.prefix_len.min(total_len);
        let suffix_len = self.config.suffix_len.min(total_len);
        let middle_len = total_len.saturating_sub(prefix_len + suffix_len);

        let prefix = &value[..prefix_len];
        let suffix = &value[total_len.saturating_sub(suffix_len)..];
        let mask = self.config.mask_char.to_string().repeat(middle_len);

        format!("{}{}{}", prefix, mask, suffix)
    }
    
    /// 检测文本中是否包含敏感信息（用于告警）
    pub fn contains_sensitive(&self, text: &str) -> bool {
        // 检测JSON格式
        if text.trim_start().starts_with('{') {
            return self.contains_sensitive_json(text);
        }

        // 文本格式检测
        for (_, regex) in SENSITIVE_PATTERNS.iter() {
            if regex.is_match(text) {
                return true;
            }
        }
        false
    }

    /// 检测JSON中是否包含敏感信息
    fn contains_sensitive_json(&self, json: &str) -> bool {
        // 复用redact_json的敏感key检测逻辑
        let kv_pattern = Regex::new(r#"("([^"]+)")\s*:\s*("([^"]*)")"#).unwrap();
        for caps in kv_pattern.captures_iter(json) {
            let key = &caps[2];
            if self.is_sensitive_key(key) {
                return true;
            }
        }
        false
    }
    
    /// 获取所有敏感字段列表（用于配置）
    pub fn list_sensitive_fields() -> Vec<&'static str> {
        SENSITIVE_PATTERNS.keys().cloned().collect()
    }
}

impl Default for SensitiveRedactor {
    fn default() -> Self {
        Self::new()
    }
}

// ==================== 错误类型 ====================

#[derive(Debug, thiserror::Error)]
pub enum RedactionError {
    #[error("无效的正则表达式: {0}")]
    InvalidRegex(String),
    
    #[error("锁操作失败: {0}")]
    LockFailed(String),
}

// ==================== 测试用例 ====================

#[cfg(test)]
mod unit_tests {
    use super::*;
    
    #[test]
    fn test_password_redaction() {
        let redactor = SensitiveRedactor::new();
        
        let input = "password: my_secret_password_123";
        let result = redactor.redact(input);
        
        assert!(result.contains("***"), "Result should contain ***: {}", result);
        assert!(!result.contains("my_secret_password_123"), "Result should not contain original password");
        assert_eq!(result.len(), input.len(), "Length should be preserved: input={}, result={}", input.len(), result.len());
    }
    
    #[test]
    fn test_token_redaction() {
        let redactor = SensitiveRedactor::new();
        
        let input = r#"{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"}"#;
        let result = redactor.redact(input);
        
        assert!(result.contains("***"), "Result should contain ***: {}", result);
        assert_eq!(result.len(), input.len(), "Length should be preserved");
    }
    
    #[test]
    fn test_credit_card_redaction() {
        let redactor = SensitiveRedactor::new();
        
        let input = "card_number: 4111111111111111";
        let result = redactor.redact(input);
        
        assert!(result.contains("***"), "Result should contain ***: {}", result);
        assert!(!result.contains("4111111111111111"), "Result should not contain original card number");
        assert_eq!(result.len(), input.len(), "Length should be preserved");
    }
    
    #[test]
    fn test_sensitive_key_in_json() {
        let redactor = SensitiveRedactor::new();
        
        let input = r#"{"password": "secret123", "username": "john"}"#;
        let result = redactor.redact(input);
        
        // password应该被脱敏
        assert!(result.contains("***"), "Result should contain ***: {}", result);
        assert!(!result.contains("secret123"), "Result should not contain original secret");
        // username不应该被脱敏
        assert!(result.contains("john"), "Result should still contain username: {}", result);
    }
    
    #[test]
    fn test_no_sensitive_data() {
        let redactor = SensitiveRedactor::new();
        
        let input = "This is a normal log message without sensitive data";
        let result = redactor.redact(input);
        
        assert_eq!(result, input);
    }
    
    #[test]
    fn test_phone_number_redaction() {
        let redactor = SensitiveRedactor::new();
        
        let input = "phone: +86-138-1234-5678";
        let result = redactor.redact(input);
        
        assert!(result.contains("***"), "Result should contain ***: {}", result);
        assert!(!result.contains("138"), "Result should not contain phone digits");
    }
    
    #[test]
    fn test_contains_sensitive_flag() {
        let redactor = SensitiveRedactor::new();
        
        assert!(redactor.contains_sensitive("password: secret"));
        assert!(redactor.contains_sensitive(r#"{"token": "abc123"}"#));
        assert!(!redactor.contains_sensitive("normal text"));
    }
    
    #[test]
    fn test_length_preservation() {
        let redactor = SensitiveRedactor::new();
        
        let inputs = vec![
            "password: abcdefgh",
            "api_key: 12345678901234567890",
            "card: 4111111111111111",
        ];
        
        for input in inputs {
            let result = redactor.redact(input);
            assert_eq!(input.len(), result.len(), 
                "Length mismatch for input: {}", input);
        }
    }
}

// ==================== 集成测试 ====================

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;
    
    #[test]
    fn test_log_file_redaction() {
        let redactor = SensitiveRedactor::new();
        let dir = tempdir().unwrap();
        let log_path = dir.path().join("test.log");
        
        // 写入包含敏感信息的日志
        {
            let mut file = std::fs::File::create(&log_path).unwrap();
            writeln!(file, "2024-01-01 10:00:00 INFO user=admin password=secret123").unwrap();
            writeln!(file, "2024-01-01 10:00:01 INFO request completed").unwrap();
            writeln!(file, "2024-01-01 10:00:02 ERROR token=abc123 invalid").unwrap();
        }
        
        // 读取并脱敏
        let content = std::fs::read_to_string(&log_path).unwrap();
        let redacted = redactor.redact(&content);
        
        assert!(redacted.contains("***"), "Redacted should contain ***: {}", redacted);
        assert!(!redacted.contains("secret123"), "Should not contain secret123");
        assert!(!redacted.contains("abc123"), "Should not contain token abc123");
    }
}
