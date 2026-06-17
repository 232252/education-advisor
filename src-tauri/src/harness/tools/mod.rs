//! 工具调用抽象层
//!
//! # 设计目标
//! - 替换 `eaa_tools.rs` 顶部 30 行大 match 分发
//! - 引入 `trait Tool` 统一抽象: 名字 / 描述 / JSON Schema / 所需 capability / 是否写操作 / 异步调用
//! - `ToolRegistry` 提供注册、查找、capability 校验的统一入口
//! - 30 个 eaa_tools 通过 `tools_eaa!` 宏自动生成 struct + impl, 减少重复代码
//!
//! # 与现有 eaa_tools.rs 的兼容
//! - 阶段二保留 `dispatch_cached` 旧函数, 但其内部改为走 Registry (一个过渡 commit 完成)
//! - 阶段三引入 Guardrails 时, ToolRegistry 接入前置钩子, 旧 dispatch 自然废弃

use async_trait::async_trait;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

mod capability;
mod eaa_bridge;
mod macros;
mod registry;

pub use capability::expand_capabilities;
pub use eaa_bridge::build_default_registry;
pub use registry::{CheckedTool, ToolDescription, ToolRegistry};

use super::error::HarnessError;

/// 工具调用上下文
///
/// 每个 Tool::call 都收到这个上下文, 内含:
/// - run_id: 当前 Agent run 的 ID (用于审计/写隔离)
/// - agent_id: 当前 agent 的 ID
/// - capabilities: agent 拥有的 capability 列表 (来自 agent_service.rs)
/// - data_cache: 读快照缓存 (来自 DataCache, 阶段二与 eaa_tools 共享)
#[derive(Clone)]
pub struct ToolContext {
    pub run_id: String,
    pub agent_id: String,
    pub capabilities: Arc<Vec<String>>,
    pub data_cache: Option<Arc<crate::tools::data_cache::DataCache>>,
}

impl ToolContext {
    pub fn has_capability(&self, cap: &str) -> bool {
        self.capabilities.iter().any(|c| c == cap || c == "all" || c == "*")
    }
}

/// 工具执行错误
#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("参数无效: {0}")]
    InvalidArgs(String),

    #[error("内部错误: {0}")]
    Internal(String),

    #[error("拒绝执行: {0}")]
    Denied(String),

    #[error("资源不存在: {0}")]
    NotFound(String),
}

impl From<ToolError> for HarnessError {
    fn from(e: ToolError) -> Self {
        match e {
            ToolError::InvalidArgs(m) => HarnessError::InvalidToolArgs {
                tool: "<unknown>".into(),
                reason: m,
            },
            other => HarnessError::Llm(format!("tool error: {other}")),
        }
    }
}

/// 工具抽象
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;
    fn input_schema(&self) -> Value;
    fn capabilities(&self) -> &'static [&'static str];
    fn is_write(&self) -> bool {
        false
    }
    async fn call(&self, args: Value, ctx: &ToolContext) -> std::result::Result<Value, ToolError>;
}

/// 注册表构建器 (轻量 DSL)
pub struct RegistryBuilder {
    tools: HashMap<String, Arc<dyn Tool>>,
}

impl Default for RegistryBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl RegistryBuilder {
    pub fn new() -> Self {
        Self {
            tools: HashMap::new(),
        }
    }

    pub fn register<T: Tool + 'static>(mut self, tool: T) -> Self {
        let name = tool.name().to_string();
        if self.tools.contains_key(&name) {
            tracing::warn!(target: "harness", "工具 {name} 重复注册, 后者覆盖前者");
        }
        self.tools.insert(name, Arc::new(tool));
        self
    }

    pub fn register_arc(mut self, tool: Arc<dyn Tool>) -> Self {
        let name = tool.name().to_string();
        self.tools.insert(name, tool);
        self
    }

    pub fn build(self) -> ToolRegistry {
        ToolRegistry { tools: self.tools }
    }
}