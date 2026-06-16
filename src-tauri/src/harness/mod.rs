//! Agent Harness — AI 基础设施的执行层
//!
//! # 模块划分
//! - [`tools`]: 统一 `Tool` trait + `ToolRegistry` + 30 个 eaa_tools 的 impl
//! - [`agent`]: AgentHarness 主入口、ReAct 状态机、状态外化、Prompt 组装
//!
//! # 设计原则 (与 LLM Service 的边界)
//! - LLM Service 只暴露"单步 stream_chat" — 不知道工具存在
//! - 工具循环编排 (Plan→Act→Observe→Reflect) 完全在 Agent Harness 内
//! - Guardrails 中间件链挂在 Agent Harness 上 (阶段三实现)
//!
//! # 数据流 (阶段二稳定后)
//! ```text
//! Command::agent_run_manual
//!   → AgentHarness::run(agent_id, prompt, history)
//!     → PromptBuilder::build_system_prompt
//!     → loop {
//!         StateMachine::next_step
//!         → LLM::step_chat
//!         → if tool_call: ToolRegistry::dispatch (经 Guardrails)
//!         → if final: StateMachine::FinalAnswer
//!       }
//!     → StateStore::persist_run
//!   → emit StreamEvent to frontend
//! ```

pub mod agent;
pub mod error;
pub mod eval;
pub mod guardrails;
pub mod tools;

pub use error::{HarnessError, Result};

// 重新导出常用类型, 业务层 (commands/agent.rs) 不用记路径
pub use agent::{AgentHarness, AgentRunConfig, AgentRunSummary};
pub use guardrails::{
    ApprovalChannel, ApprovalDecision, ApprovalRequest, BlockReason, GuardrailAction,
    GuardrailContext, GuardrailHook, GuardrailPipeline, HitlGuard, HitlPolicy, InputFilter,
    InputVerdict, OutputFilter, OutputVerdict, ResourceLimits, RiskLevel, Sandbox, Severity,
};
pub use tools::{CheckedTool, RegistryBuilder, Tool, ToolContext, ToolError, ToolRegistry};