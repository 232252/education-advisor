//! Guardrails Harness — AI 基础设施的守护层
//!
//! # 设计目标
//! 在 Agent Harness（执行层）的三个关键路径上挂守护链：
//! 1. **LLM 输入**（prompt + 上下文）— 防止 PII 泄露 / 注入攻击 / 越权
//! 2. **Tool 调用**（capability 校验后, 实际执行前）— 防越权 / 大小限制 / 人类审批
//! 3. **Tool 结果**（写回消息前）— schema 校验 / 大小截断 / PII 反向脱敏
//!
//! # 模块组成
//! - [`input_filter`]: SensitiveRedactor + PrivacyEngine 双引擎的 PII/注入防护
//! - [`output_filter`]: schema 校验 + 截断 + PII 反向脱敏
//! - [`hitl`]: 人类审批命令总线（oneshot 一次性决议）
//! - [`sandbox`]: 资源限制（args/result 大小 + 路径白名单 + 超时）
//!
//! # 数据流
//! ```text
//! AgentHarness::react_loop
//!   ├─→ LLM step
//!   │    └─→ pipeline.check_input(messages)         ← input_filter
//!   ├─→ ToolRegistry::get_checked
//!   │    └─→ pipeline.check_tool_call(args)         ← sandbox + hitl
//!   ├─→ checked.call(args, ctx)                     (实际执行)
//!   │    └─→ pipeline.check_tool_result(value)      ← output_filter
//!   └─→ 回喂给 LLM
//! ```
//!
//! # 与 LLM Service / Tool Registry 的边界
//! - LLM Service 不感知 Guardrails（保持纯洁性）
//! - Tool Registry 已做 capability 校验，Guardrails 是 **第二道** 防线
//! - HITL 通过 `state.approval_channel` 异步等待前端发 `agent_approval_resolve` 命令

pub mod hitl;
pub mod input_filter;
pub mod output_filter;
pub mod sandbox;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::harness::error::{HarnessError, Result as HarnessResult};
use crate::state::AppState;

pub use hitl::{
    ApprovalChannel, ApprovalDecision, ApprovalRequest, HitlPolicy, RiskLevel, EV_APPROVAL_REQUIRED,
    EV_APPROVAL_RESOLVED,
};
pub use input_filter::{BlockReason, InputFilter, InputVerdict};
pub use output_filter::{OutputFilter, OutputVerdict};
pub use sandbox::{ResourceLimits, Sandbox};

/// 三类钩子点
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuardrailHook {
    /// LLM 单步调用的输入（messages）
    LlmInput,
    /// 工具调用前的参数（已经过 capability 校验）
    ToolCall,
    /// 工具调用后的返回值（写回 LLM 之前）
    ToolResult,
}

/// 严重度（供前端 UI / 审计使用）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Info,    // 仅记录（如脱敏）
    Warn,    // 警告但放行
    Block,   // 拒绝
    Critical, // 拒绝 + 触发紧急 audit
}

/// 守卫链的判定结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum GuardrailAction {
    /// 放行
    Allow,
    /// 放行但已改写（data 已被 ctx.set_data 改写过, 这里只携带 reason 给 audit）
    AllowWith { reason: String, redactions: usize },
    /// 拒绝（返回 Err 给 caller）
    Block {
        reason: String,
        severity: Severity,
        /// 供前端 UI 渲染的证据片段（脱敏后的）
        evidence: Option<String>,
    },
}

/// 守卫上下文 — 携带可读写数据 + 元信息
pub struct GuardrailContext<'a> {
    pub run_id: &'a str,
    pub agent_id: &'a str,
    pub tool: Option<&'a str>, // 仅 ToolCall/ToolResult 时有
    pub kind: GuardrailHook,
    /// 待检查/可改写的数据
    /// - LlmInput: `Vec<ChatMessage>` 的 JSON Value
    /// - ToolCall: 工具参数
    /// - ToolResult: 工具返回值
    pub data: &'a mut Value,
    /// 携带的元信息（capability list / size / schema 等）
    pub meta: &'a mut HashMap<String, Value>,
}

impl<'a> GuardrailContext<'a> {
    pub fn new(
        run_id: &'a str,
        agent_id: &'a str,
        kind: GuardrailHook,
        data: &'a mut Value,
        meta: &'a mut HashMap<String, Value>,
    ) -> Self {
        Self {
            run_id,
            agent_id,
            tool: None,
            kind,
            data,
            meta,
        }
    }

    pub fn with_tool(mut self, tool: &'a str) -> Self {
        self.tool = Some(tool);
        self
    }
}

/// 单个守卫的 trait
#[async_trait]
pub trait Guardrail: Send + Sync {
    fn name(&self) -> &'static str;

    /// 对 LLM 输入做检查/改写
    async fn check_input(&self, _ctx: &mut GuardrailContext<'_>) -> HarnessResult<GuardrailAction> {
        Ok(GuardrailAction::Allow)
    }

    /// 对工具调用做检查（可能改写 args, 也可能要求 HITL）
    async fn check_tool_call(
        &self,
        _ctx: &mut GuardrailContext<'_>,
    ) -> HarnessResult<GuardrailAction> {
        Ok(GuardrailAction::Allow)
    }

    /// 对工具返回做检查/改写
    async fn check_tool_result(
        &self,
        _ctx: &mut GuardrailContext<'_>,
    ) -> HarnessResult<GuardrailAction> {
        Ok(GuardrailAction::Allow)
    }
}

/// 守卫链 — 按顺序短路：第一个 Block 即终止
pub struct GuardrailPipeline {
    guards: Vec<Arc<dyn Guardrail>>,
}

impl GuardrailPipeline {
    pub fn new(guards: Vec<Arc<dyn Guardrail>>) -> Self {
        Self { guards }
    }

    /// 标准守卫链 — 顺序：
    /// 1. InputFilter (LLM 输入 / 工具 args)
    /// 2. Sandbox (大小/路径)
    /// 3. HITL (写/危险操作)
    /// 4. OutputFilter (工具结果)
    ///
    /// `approval_channel` 在 R4 (state.rs 接线) 之前传 None 时, 自动降级为 auto-approve。
    pub fn standard(
        state: &AppState,
        app: AppHandle,
        approval_channel: Option<Arc<ApprovalChannel>>,
    ) -> Self {
        // 预留: 未来 InputFilter 可能需要 AppHandle 做 PII 计数上报 / OutputFilter 需要 emit audit 事件
        let _ = app;
        use std::sync::Arc as A;
        let input = A::new(InputFilter::new(
            A::new(log_redact::SensitiveRedactor::new()),
            state.privacy.clone(),
            *state.privacy_enabled.read(),
            5, // max_pii
        )) as Arc<dyn Guardrail>;
        let sandbox = A::new(Sandbox::new(ResourceLimits::default())) as Arc<dyn Guardrail>;
        let hitl = if let Some(channel) = approval_channel {
            A::new(HitlGuard::new(channel)) as Arc<dyn Guardrail>
        } else {
            // R4 之前的占位: 始终 Allow
            A::new(AutoApproveGuard) as Arc<dyn Guardrail>
        };
        let output = A::new(OutputFilter::new(
            state.privacy.clone(),
            ResourceLimits::default(),
        )) as Arc<dyn Guardrail>;

        Self::new(vec![input, sandbox, hitl, output])
    }

    /// 便捷方法：仅挂 input 守卫（用于纯 LLM 输入）
    pub fn for_input(guards: Vec<Arc<dyn Guardrail>>) -> Self {
        Self::new(guards)
    }

    /// 检查 LLM 输入
    pub async fn check_input(
        &self,
        run_id: &str,
        agent_id: &str,
        data: &mut Value,
    ) -> HarnessResult<()> {
        let mut meta = HashMap::new();
        let mut ctx = GuardrailContext::new(run_id, agent_id, GuardrailHook::LlmInput, data, &mut meta);
        for g in &self.guards {
            let action = g.check_input(&mut ctx).await?;
            if let GuardrailAction::Block { reason, .. } = action {
                return Err(HarnessError::GuardrailBlocked {
                    guardrail: g.name().to_string(),
                    hook: "input".into(),
                    reason,
                });
            }
        }
        Ok(())
    }

    /// 检查工具调用
    pub async fn check_tool_call(
        &self,
        run_id: &str,
        agent_id: &str,
        tool: &str,
        data: &mut Value,
    ) -> HarnessResult<()> {
        self.check_tool_call_with_meta(run_id, agent_id, tool, data, false, "low").await
    }

    /// 检查工具调用 (带 is_write + risk 元信息, 给 HITL 用)
    pub async fn check_tool_call_with_meta(
        &self,
        run_id: &str,
        agent_id: &str,
        tool: &str,
        data: &mut Value,
        is_write: bool,
        risk: &str,
    ) -> HarnessResult<()> {
        let mut meta = HashMap::new();
        meta.insert("is_write".into(), Value::Bool(is_write));
        meta.insert("risk".into(), Value::String(risk.to_string()));
        let mut ctx = GuardrailContext::new(run_id, agent_id, GuardrailHook::ToolCall, data, &mut meta)
            .with_tool(tool);
        for g in &self.guards {
            let action = g.check_tool_call(&mut ctx).await?;
            if let GuardrailAction::Block { reason, .. } = action {
                return Err(HarnessError::GuardrailBlocked {
                    guardrail: g.name().to_string(),
                    hook: "tool_call".into(),
                    reason,
                });
            }
        }
        Ok(())
    }

    /// 检查工具结果
    pub async fn check_tool_result(
        &self,
        run_id: &str,
        agent_id: &str,
        tool: &str,
        data: &mut Value,
    ) -> HarnessResult<()> {
        self.check_tool_result_with_meta(run_id, agent_id, tool, data, false, &Value::Null).await
    }

    /// 检查工具结果 (带 is_write + schema, 给 OutputFilter 用)
    pub async fn check_tool_result_with_meta(
        &self,
        run_id: &str,
        agent_id: &str,
        tool: &str,
        data: &mut Value,
        is_write: bool,
        schema: &Value,
    ) -> HarnessResult<()> {
        let mut meta = HashMap::new();
        meta.insert("is_write".into(), Value::Bool(is_write));
        meta.insert("schema".into(), schema.clone());
        let mut ctx = GuardrailContext::new(
            run_id,
            agent_id,
            GuardrailHook::ToolResult,
            data,
            &mut meta,
        )
        .with_tool(tool);
        for g in &self.guards {
            let action = g.check_tool_result(&mut ctx).await?;
            if let GuardrailAction::Block { reason, .. } = action {
                return Err(HarnessError::GuardrailBlocked {
                    guardrail: g.name().to_string(),
                    hook: "tool_result".into(),
                    reason,
                });
            }
        }
        Ok(())
    }
}

// ===== HitlGuard — 把 ApprovalChannel 包装成 Guardrail =====

/// HITL 守卫 — 把 ApprovalChannel 适配进 GuardrailPipeline
pub struct HitlGuard {
    channel: Arc<ApprovalChannel>,
}

impl HitlGuard {
    pub fn new(channel: Arc<ApprovalChannel>) -> Self {
        Self { channel }
    }
}

#[async_trait]
impl Guardrail for HitlGuard {
    fn name(&self) -> &'static str {
        "hitl"
    }

    async fn check_tool_call(
        &self,
        ctx: &mut GuardrailContext<'_>,
    ) -> HarnessResult<GuardrailAction> {
        // 只在 ToolCall 钩子介入
        if ctx.kind != GuardrailHook::ToolCall {
            return Ok(GuardrailAction::Allow);
        }
        let tool = ctx.tool.unwrap_or("unknown");
        // 读操作自动放行
        let is_write = ctx
            .meta
            .get("is_write")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let risk_str = ctx
            .meta
            .get("risk")
            .and_then(|v| v.as_str())
            .unwrap_or("low");
        let risk = match risk_str {
            "destructive" => RiskLevel::Destructive,
            "high" => RiskLevel::High,
            "medium" => RiskLevel::Medium,
            _ => RiskLevel::Low,
        };
        let req = ApprovalRequest {
            id: format!("req_{}_{}", ctx.run_id, uuid_v4_short()),
            run_id: ctx.run_id.to_string(),
            agent_id: ctx.agent_id.to_string(),
            tool: tool.to_string(),
            args: ctx.data.clone(),
            is_write,
            risk,
            requested_at: chrono::Utc::now().timestamp_millis(),
        };
        match self.channel.request(req).await {
            Ok(decision) => {
                use ApprovalDecision::*;
                match decision {
                    Approve { by } => {
                        ctx.meta
                            .insert("approved_by".into(), Value::String(by.clone()));
                        Ok(GuardrailAction::AllowWith {
                            reason: format!("approved by {by}"),
                            redactions: 0,
                        })
                    }
                    Reject { by, reason } => Ok(GuardrailAction::Block {
                        reason: format!("rejected by {by}: {reason}"),
                        severity: Severity::Block,
                        evidence: Some(reason),
                    }),
                    Edit { by, new_args } => {
                        *ctx.data = new_args;
                        ctx.meta
                            .insert("approved_by".into(), Value::String(by.clone()));
                        Ok(GuardrailAction::AllowWith {
                            reason: format!("edited by {by}"),
                            redactions: 0,
                        })
                    }
                }
            }
            Err(HarnessError::ApprovalTimeout {
                tool: t,
                timeout_secs,
            }) => Ok(GuardrailAction::Block {
                reason: format!("HITL 超时 (>{timeout_secs}s): {t}"),
                severity: Severity::Critical,
                evidence: None,
            }),
            Err(e) => Err(e),
        }
    }
}

/// AutoApproveGuard — R4 之前的占位守卫, 始终 Allow
pub struct AutoApproveGuard;

#[async_trait]
impl Guardrail for AutoApproveGuard {
    fn name(&self) -> &'static str {
        "auto_approve"
    }
}

/// 极简的 uuid 短码（避免引入 uuid crate — 阶段三按需再加）
fn uuid_v4_short() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos & 0xFFFF_FFFF)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 始终 Allow 的守卫（用于测试 Pipeline 装配）
    struct AlwaysAllow;
    #[async_trait]
    impl Guardrail for AlwaysAllow {
        fn name(&self) -> &'static str {
            "always_allow"
        }
    }

    /// 始终 Block 的守卫
    struct AlwaysBlock;
    #[async_trait]
    impl Guardrail for AlwaysBlock {
        fn name(&self) -> &'static str {
            "always_block"
        }
        async fn check_input(
            &self,
            _ctx: &mut GuardrailContext<'_>,
        ) -> HarnessResult<GuardrailAction> {
            Ok(GuardrailAction::Block {
                reason: "test".into(),
                severity: Severity::Block,
                evidence: None,
            })
        }
    }

    #[tokio::test]
    async fn test_pipeline_allows() {
        let p = GuardrailPipeline::new(vec![Arc::new(AlwaysAllow)]);
        let mut data = json!("hello");
        let r = p.check_input("r", "a", &mut data).await;
        assert!(r.is_ok());
    }

    #[tokio::test]
    async fn test_pipeline_first_block_short_circuits() {
        let p = GuardrailPipeline::new(vec![Arc::new(AlwaysBlock), Arc::new(AlwaysAllow)]);
        let mut data = json!("hello");
        let r = p.check_input("r", "a", &mut data).await;
        assert!(r.is_err());
        let msg = format!("{r:?}");
        assert!(msg.contains("test") || msg.contains("always_block"));
    }

    #[tokio::test]
    async fn test_guardrail_context() {
        let mut data = json!({"student": "张三"});
        let mut meta = HashMap::new();
        meta.insert("is_write".into(), json!(true));
        let ctx = GuardrailContext::new("r1", "a1", GuardrailHook::ToolCall, &mut data, &mut meta)
            .with_tool("add_event");
        assert_eq!(ctx.tool, Some("add_event"));
        assert_eq!(ctx.kind, GuardrailHook::ToolCall);
        assert_eq!(ctx.data["student"], "张三");
    }

    #[test]
    fn test_uuid_v4_short_is_hex() {
        let s = uuid_v4_short();
        assert_eq!(s.len(), 8);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
