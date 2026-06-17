//! Harness 专属错误类型
//!
//! 与 `crate::error::AppError` 是独立的, 避免循环依赖与污染业务错误。
//! 业务侧 (`AgentRunner`) 在边界处用 `From<HarnessError> for AppError` 转译。

use thiserror::Error;

#[derive(Debug, Error)]
pub enum HarnessError {
    #[error("工具未找到: {0}")]
    ToolNotFound(String),

    #[error("工具调用参数无效: {tool} - {reason}")]
    InvalidToolArgs { tool: String, reason: String },

    #[error("capability 校验失败: 工具 {tool} 需要 {required}, agent 仅拥有 {owned:?}")]
    CapabilityDenied {
        tool: String,
        required: String,
        owned: Vec<String>,
    },

    #[error("预算超限: {kind} (已用 {used}, 上限 {limit})")]
    BudgetExceeded {
        kind: BudgetKind,
        used: u64,
        limit: u64,
    },

    #[error("ReAct 状态机非法转换: 从 {from:?} 到 {to:?}")]
    InvalidStateTransition {
        from: &'static str,
        to: &'static str,
    },

    #[error("LLM 调用失败: {0}")]
    Llm(String),

    #[error("状态持久化失败: {0}")]
    StateStore(String),

    #[error("HITL 审批被拒绝: tool={tool}, by={by}")]
    ApprovalRejected { tool: String, by: String },

    #[error("HITL 审批超时 (>{timeout_secs}s): tool={tool}")]
    ApprovalTimeout { tool: String, timeout_secs: u64 },

    #[error("Agent 配置无效: {0}")]
    InvalidConfig(String),

    #[error("外部中断 (用户主动 abort): run_id={0}")]
    Aborted(String),

    #[error("Guardrail 拦截: {guardrail} 在 {hook} 阶段拒绝 — {reason}")]
    GuardrailBlocked {
        guardrail: String,
        hook: String,
        reason: String,
        severity: String, // "info" | "warn" | "block" | "critical"
        evidence: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BudgetKind {
    Rounds,
    InputTokens,
    OutputTokens,
    CostUsd, // 单位: 1e-6 USD (避免浮点)
    WallTimeSec,
}

impl std::fmt::Display for BudgetKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BudgetKind::Rounds => write!(f, "rounds"),
            BudgetKind::InputTokens => write!(f, "input_tokens"),
            BudgetKind::OutputTokens => write!(f, "output_tokens"),
            BudgetKind::CostUsd => write!(f, "cost_usd"),
            BudgetKind::WallTimeSec => write!(f, "wall_time_sec"),
        }
    }
}

pub type Result<T> = std::result::Result<T, HarnessError>;