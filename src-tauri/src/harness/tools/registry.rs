//! `ToolRegistry` — 工具注册 / 查找 / capability 校验的统一入口
//!
//! 阶段二核心抽象之一。所有工具调用必须经过这里, 以便:
//! 1. 集中 capability 校验 (替代 eaa_tools.rs 里 `is_allowed` 的硬编码表)
//! 2. 阶段三接 Guardrails 前置钩子 (param 校验 / HITL)
//! 3. 阶段五接 Skill 系统 (动态注册外部 skill)

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use super::Tool;
use crate::harness::error::{HarnessError, Result};

#[derive(Clone)]
pub struct ToolRegistry {
    pub(crate) tools: HashMap<String, Arc<dyn Tool>>,
}

impl std::fmt::Debug for ToolRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolRegistry")
            .field("tool_count", &self.tools.len())
            .field("names", &self.tool_names())
            .finish()
    }
}

impl ToolRegistry {
    pub fn builder() -> super::RegistryBuilder {
        super::RegistryBuilder::new()
    }

    /// 列出所有工具名 (用于前端 Skills 浏览器 / LLM system prompt)
    pub fn tool_names(&self) -> Vec<&str> {
        let mut names: Vec<&str> = self.tools.keys().map(|s| s.as_str()).collect();
        names.sort_unstable();
        names
    }

    /// 列出所有工具的"LLM 视角描述" (name + description + schema), 用于 system prompt
    pub fn llm_descriptions(&self) -> Vec<ToolDescription> {
        let mut out: Vec<ToolDescription> = self
            .tools
            .values()
            .map(|t| ToolDescription {
                name: t.name().to_string(),
                description: t.description().to_string(),
                schema: t.input_schema(),
                is_write: t.is_write(),
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    /// 取工具实例 (不校验 capability)
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    /// 取工具 + 校验 capability
    ///
    /// 返回的 `CheckedTool` 已确认:
    /// - 工具存在
    /// - agent 拥有所有所需 capability
    /// 调用方拿到后, 直接 `checked.call(args, ctx)` 即可, 不会再触发 capability 错误。
    pub fn get_checked(
        &self,
        name: &str,
        caps: &[String],
    ) -> Result<CheckedTool> {
        let tool = self
            .tools
            .get(name)
            .ok_or_else(|| HarnessError::ToolNotFound(name.to_string()))?
            .clone();

        let required = tool.capabilities();
        let missing: Vec<&str> = required
            .iter()
            .copied()
            .filter(|c| !caps.iter().any(|owned| owned == c || owned == "all" || owned == "*"))
            .collect();

        if !missing.is_empty() {
            return Err(HarnessError::CapabilityDenied {
                tool: name.to_string(),
                required: missing.join(","),
                owned: caps.to_vec(),
            });
        }

        Ok(CheckedTool { tool })
    }
}

/// 已通过 capability 校验的工具包装
///
/// 调用 `checked.call(args, ctx)` 时不会再做 capability 检查, 但仍会:
/// - 触发阶段三的 Guardrails 前置钩子 (param 校验 / HITL / budget check)
/// - 工具自身的 param 二次校验 (防御)
#[derive(Clone)]
pub struct CheckedTool {
    tool: Arc<dyn Tool>,
}

impl CheckedTool {
    pub fn name(&self) -> &'static str {
        self.tool.name()
    }

    pub fn is_write(&self) -> bool {
        self.tool.is_write()
    }

    pub fn input_schema(&self) -> Value {
        self.tool.input_schema()
    }

    pub async fn call(
        self,
        args: Value,
        ctx: &super::ToolContext,
    ) -> std::result::Result<Value, super::ToolError> {
        // 注意: 这里 **不** 做 capability 检查, 由 Registry 完成
        // Guardrails 前置钩子在阶段三接入, 这里是接入点
        self.tool.call(args, ctx).await
    }
}

/// LLM 视角的工具描述 (用于 system prompt 注入)
#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolDescription {
    pub name: String,
    pub description: String,
    pub schema: Value,
    pub is_write: bool,
}