//! OutputFilter — 工具返回值的 schema 校验 + PII 反向脱敏 + 截断
//!
//! 详见模块根 mod.rs。本文件在阶段三 R3 完整实现。

use std::sync::Arc;

use async_trait::async_trait;
use parking_lot::RwLock;
use serde_json::Value;

use eaa_core::privacy::PrivacyEngine;

use super::sandbox::ResourceLimits;
use super::{Guardrail, GuardrailAction, GuardrailContext, Severity};
use crate::harness::error::Result as HarnessResult;

#[derive(Debug, Clone)]
pub enum OutputVerdict {
    Pass,
    /// PII 占位符已被反向脱敏
    DeAnonymized { count: usize, after: Value },
    /// 超大结果被截断
    Truncated { original_bytes: usize, kept: Value },
    /// 拒绝
    Blocked { reason: String },
}

pub struct OutputFilter {
    pub privacy: Arc<RwLock<PrivacyEngine>>,
    pub limits: ResourceLimits,
    /// 是否对写操作严格 schema 校验（默认 false）
    pub schema_enforce_for_writes: bool,
}

impl OutputFilter {
    pub fn new(privacy: Arc<RwLock<PrivacyEngine>>, limits: ResourceLimits) -> Self {
        Self {
            privacy,
            limits,
            schema_enforce_for_writes: false,
        }
    }

    /// 处理工具结果
    pub fn process_tool_result(
        &self,
        tool: &str,
        schema: Option<&Value>,
        is_write: bool,
        value: &Value,
    ) -> OutputVerdict {
        // 1. 大小检查 + 截断
        let serialized = serde_json::to_string(value).unwrap_or_default();
        let bytes = serialized.len();
        if bytes > self.limits.max_result_bytes {
            let keep_bytes = self.limits.max_truncated_bytes;
            let truncated_str: String = serialized.chars().take(keep_bytes).collect();
            let truncated_value = Value::String(format!(
                "{truncated_str}...[truncated {keep_bytes}/{bytes} bytes]"
            ));
            return OutputVerdict::Truncated {
                original_bytes: bytes,
                kept: truncated_value,
            };
        }

        // 2. Schema 校验（写操作严格模式）
        if is_write && self.schema_enforce_for_writes {
            if let Some(s) = schema {
                if let Err(e) = validate_against_schema(value, s) {
                    return OutputVerdict::Blocked {
                        reason: format!("schema 校验失败: {e}"),
                    };
                }
            }
        }

        // 3. PII 反向脱敏 (扫描 [PII_xxx] 模式)
        let deanonymized = deanonymize_value(&self.privacy.read(), value);
        if let Some((count, new_value)) = deanonymized {
            if count > 0 {
                return OutputVerdict::DeAnonymized {
                    count,
                    after: new_value,
                };
            }
        }
        let _ = tool;
        OutputVerdict::Pass
    }
}

/// 递归反向脱敏
fn deanonymize_value(
    engine: &PrivacyEngine,
    value: &Value,
) -> Option<(usize, Value)> {
    match value {
        Value::String(s) => {
            if s.contains("[PII_") {
                let new = engine.deanonymize(s);
                let count = s.matches("[PII_").count();
                Some((count, Value::String(new)))
            } else {
                None
            }
        }
        Value::Array(arr) => {
            let mut total = 0;
            let mut new_arr = Vec::with_capacity(arr.len());
            let mut changed = false;
            for v in arr {
                match deanonymize_value(engine, v) {
                    Some((c, nv)) => {
                        total += c;
                        new_arr.push(nv);
                        changed = true;
                    }
                    None => new_arr.push(v.clone()),
                }
            }
            if changed {
                Some((total, Value::Array(new_arr)))
            } else {
                None
            }
        }
        Value::Object(obj) => {
            let mut total = 0;
            let mut new_obj = serde_json::Map::new();
            let mut changed = false;
            for (k, v) in obj {
                match deanonymize_value(engine, v) {
                    Some((c, nv)) => {
                        total += c;
                        new_obj.insert(k.clone(), nv);
                        changed = true;
                    }
                    None => {
                        new_obj.insert(k.clone(), v.clone());
                    }
                }
            }
            if changed {
                Some((total, Value::Object(new_obj)))
            } else {
                None
            }
        }
        _ => None,
    }
}

/// 极简 JSON schema 校验：仅检查 type 字段 (object/string/number/array/bool)
fn validate_against_schema(value: &Value, schema: &Value) -> std::result::Result<(), String> {
    let expected_type = schema.get("type").and_then(|v| v.as_str());
    if let Some(t) = expected_type {
        let ok = match t {
            "object" => value.is_object(),
            "string" => value.is_string(),
            "number" => value.is_number(),
            "integer" => value.is_i64() || value.is_u64(),
            "boolean" | "bool" => value.is_boolean(),
            "array" => value.is_array(),
            "null" => value.is_null(),
            _ => true,
        };
        if !ok {
            return Err(format!("expected type {t}, got {}", value_type_name(value)));
        }
    }
    // 校验 required 字段
    if let Some(required) = schema.get("required").and_then(|v| v.as_array()) {
        if let Some(obj) = value.as_object() {
            for r in required {
                if let Some(k) = r.as_str() {
                    if !obj.contains_key(k) {
                        return Err(format!("missing required field: {k}"));
                    }
                }
            }
        }
    }
    Ok(())
}

fn value_type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[async_trait]
impl Guardrail for OutputFilter {
    fn name(&self) -> &'static str {
        "output_filter"
    }

    async fn check_tool_result(
        &self,
        ctx: &mut GuardrailContext<'_>,
    ) -> HarnessResult<GuardrailAction> {
        let tool = ctx.tool.unwrap_or("unknown");
        let is_write = ctx
            .meta
            .get("is_write")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let schema = ctx.meta.get("schema").cloned();
        let value_clone = ctx.data.clone();
        let verdict =
            self.process_tool_result(tool, schema.as_ref(), is_write, &value_clone);
        match verdict {
            OutputVerdict::Pass => Ok(GuardrailAction::Allow),
            OutputVerdict::DeAnonymized { count, after } => {
                *ctx.data = after;
                Ok(GuardrailAction::AllowWith {
                    reason: format!("deanonymized {count} PII tokens"),
                    redactions: count,
                })
            }
            OutputVerdict::Truncated { original_bytes, kept } => {
                *ctx.data = kept;
                Ok(GuardrailAction::AllowWith {
                    reason: format!("truncated from {original_bytes} bytes"),
                    redactions: 0,
                })
            }
            OutputVerdict::Blocked { reason } => Ok(GuardrailAction::Block {
                reason,
                severity: Severity::Block,
                evidence: None,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_filter() -> OutputFilter {
        OutputFilter::new(
            Arc::new(RwLock::new(PrivacyEngine::default())),
            ResourceLimits::default(),
        )
    }

    #[test]
    fn test_process_pass_through() {
        let f = test_filter();
        let v = json!({"score": 95, "student": "张三"});
        match f.process_tool_result("get_score", None, false, &v) {
            OutputVerdict::Pass => {}
            other => panic!("expected Pass, got {:?}", other),
        }
    }

    #[test]
    fn test_deanonymize_recursive() {
        // 构造一个含 [PII_x] 标记的字符串,验证 deanonymize_value 会被识别
        // PrivacyEngine::default() 不含 mapping, deanonymize 会原样返回
        let f = test_filter();
        let v = json!({
            "name": "张三",
            "phone": "[PII_PHONE_001]"
        });
        match f.process_tool_result("get_score", None, false, &v) {
            // PrivacyEngine::default() 不做替换,仍命中 PII 模式 → DeAnonymized (即使 after 不变)
            OutputVerdict::DeAnonymized { count, .. } => {
                assert!(count >= 1);
            }
            OutputVerdict::Pass => panic!("expected DeAnonymized because [PII_ pattern present"),
            OutputVerdict::Truncated { .. } => panic!("not truncated"),
            OutputVerdict::Blocked { .. } => panic!("not blocked"),
        }
    }

    #[test]
    fn test_truncation_large_result() {
        let f = OutputFilter::new(
            Arc::new(RwLock::new(PrivacyEngine::default())),
            ResourceLimits {
                max_result_bytes: 100,
                max_truncated_bytes: 50,
                ..ResourceLimits::default()
            },
        );
        // 1KB+ 的字符串
        let v = json!({"data": "x".repeat(2000)});
        match f.process_tool_result("big", None, false, &v) {
            OutputVerdict::Truncated { original_bytes, .. } => {
                assert!(original_bytes > 100);
            }
            other => panic!("expected Truncated, got {:?}", other),
        }
    }

    #[test]
    fn test_schema_validation_passes() {
        let f = test_filter();
        let schema = json!({"type": "object", "required": ["score"]});
        let v = json!({"score": 95});
        // schema_enforce_for_writes=false,即使 schema 给定也不强制
        match f.process_tool_result("x", Some(&schema), false, &v) {
            OutputVerdict::Pass => {}
            other => panic!("expected Pass, got {:?}", other),
        }
    }

    #[test]
    fn test_schema_validation_blocks_writes_when_enforced() {
        let mut f = test_filter();
        f.schema_enforce_for_writes = true;
        let schema = json!({"type": "object", "required": ["score"]});
        let v = json!({"name": "张三"}); // 缺 score
        match f.process_tool_result("add_event", Some(&schema), true, &v) {
            OutputVerdict::Blocked { reason } => {
                assert!(reason.contains("missing required"));
            }
            other => panic!("expected Blocked, got {:?}", other),
        }
    }

    #[test]
    fn test_validate_against_schema_type() {
        let schema = json!({"type": "string"});
        assert!(validate_against_schema(&json!("hi"), &schema).is_ok());
        assert!(validate_against_schema(&json!(42), &schema).is_err());
    }

    #[test]
    fn test_value_type_name() {
        assert_eq!(value_type_name(&json!(null)), "null");
        assert_eq!(value_type_name(&json!(true)), "boolean");
        assert_eq!(value_type_name(&json!(1.0)), "number");
    }
}
