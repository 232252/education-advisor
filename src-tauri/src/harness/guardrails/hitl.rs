//! HITL (Human-in-the-Loop) — 写/危险操作前的人类审批
//!
//! # 流程
//! 1. Tool 调用前, `HitlGuard::check_tool_call` 构造 `ApprovalRequest`
//! 2. `ApprovalChannel::request` 评估 `HitlPolicy`:
//!    - 读操作 / 安全写 → 自动批准
//!    - 写/危险操作 → emit `approval-required` 事件, 注册 oneshot sender
//! 3. 前端渲染确认对话框, 用户点击批准/拒绝/编辑
//! 4. 前端发 `agent_approval_resolve` 命令, 后端 `ApprovalChannel::resolve` 写回
//! 5. `request()` 的 await 拿到 `ApprovalDecision`, 守卫链继续
//!
//! # 超时
//! - 默认 30s 超时, 返回 `HarnessError::ApprovalTimeout`
//! - 超时后 sender 仍注册, 等前端后续 resolve (返回 NoSender 错误, 不 panic)

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::harness::error::{HarnessError, Result as HarnessResult};

/// Tauri 事件名常量
pub const EV_APPROVAL_REQUIRED: &str = "agent:approval-required";
pub const EV_APPROVAL_RESOLVED: &str = "agent:approval-resolved";

/// 风险等级
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    /// 只读操作
    Low,
    /// 写操作（增加/修改）
    Medium,
    /// 删除/重置
    High,
    /// 不可逆的破坏性操作（factory reset、批量删除）
    Destructive,
}

impl RiskLevel {
    pub fn from_tool_name(tool: &str) -> Self {
        let t = tool.to_lowercase();
        if t.starts_with("reset_factory") || t.starts_with("delete_by_class") || t.contains("bulk_") {
            RiskLevel::Destructive
        } else if t.starts_with("delete_") || t.starts_with("reset_") {
            RiskLevel::High
        } else if t.starts_with("add_") || t.starts_with("bulk_add_") {
            RiskLevel::Medium
        } else {
            RiskLevel::Low
        }
    }
}

/// 审批请求
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub run_id: String,
    pub agent_id: String,
    pub tool: String,
    pub args: Value,
    pub is_write: bool,
    pub risk: RiskLevel,
    pub requested_at: i64,
}

/// 审批决议
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approve { by: String },
    Reject { by: String, reason: String },
    Edit { by: String, new_args: Value },
}

impl ApprovalDecision {
    pub fn from_json(v: Value) -> std::result::Result<Self, String> {
        serde_json::from_value(v).map_err(|e| format!("invalid decision: {e}"))
    }
}

/// HITL 策略 — 控制哪些操作需要审批
#[derive(Debug, Clone)]
pub struct HitlPolicy {
    /// 只读工具自动批准（默认 true）
    pub auto_approve_readonly: bool,
    /// 低风险写操作自动批准（默认 false, 阶段三保持谨慎）
    pub auto_approve_safe_writes: bool,
    /// 必须审批的工具名前缀（glob, e.g. "delete_*", "reset_*"）
    pub require_approval_for: HashSet<String>,
    /// 审批超时（秒, 默认 30）
    pub timeout_secs: u64,
}

impl Default for HitlPolicy {
    fn default() -> Self {
        let mut require = HashSet::new();
        require.insert("delete_*".into());
        require.insert("reset_*".into());
        require.insert("reset_factory".into());
        require.insert("delete_by_class".into());
        require.insert("bulk_add_*".into());
        Self {
            auto_approve_readonly: true,
            auto_approve_safe_writes: false,
            require_approval_for: require,
            timeout_secs: 30,
        }
    }
}

impl HitlPolicy {
    pub fn requires_approval(&self, req: &ApprovalRequest) -> bool {
        // 显式 require 列表
        for pat in &self.require_approval_for {
            if glob_match(pat, &req.tool) {
                return true;
            }
        }
        // 风险等级
        match req.risk {
            RiskLevel::Destructive | RiskLevel::High => true,
            RiskLevel::Medium => !self.auto_approve_safe_writes,
            RiskLevel::Low => false,
        }
    }
}

/// 简单 glob 匹配：`*` 通配任意非空字符串
fn glob_match(pattern: &str, text: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        return text.starts_with(prefix);
    }
    pattern == text
}

/// 审批通道 — oneshot 一次性决议
pub struct ApprovalChannel {
    pending: Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>,
    pub policy: HitlPolicy,
    app: AppHandle,
}

impl ApprovalChannel {
    pub fn new(app: AppHandle) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            policy: HitlPolicy::default(),
            app,
        }
    }

    pub fn with_policy(mut self, policy: HitlPolicy) -> Self {
        self.policy = policy;
        self
    }

    /// 申请审批, 返回最终决议
    pub async fn request(&self, req: ApprovalRequest) -> HarnessResult<ApprovalDecision> {
        // 1. Policy 短路：自动批准
        if !self.policy.requires_approval(&req) {
            return Ok(ApprovalDecision::Approve {
                by: if req.is_write {
                    "auto:safe_write".into()
                } else {
                    "auto:readonly".into()
                },
            });
        }
        // 2. 注册 oneshot, 发事件
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(req.id.clone(), tx);
        // emit 前端
        let _ = self.app.emit(EV_APPROVAL_REQUIRED, &req);
        // 3. 等决议（带超时）
        let timeout = Duration::from_secs(self.policy.timeout_secs);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(decision)) => {
                let _ = self.app.emit(EV_APPROVAL_RESOLVED, &req.id);
                Ok(decision)
            }
            Ok(Err(_canceled)) => Err(HarnessError::ApprovalRejected {
                tool: req.tool.clone(),
                by: "channel_dropped".into(),
            }),
            Err(_elapsed) => {
                // 清理 pending（不阻塞后续 resolve 错误）
                self.pending.lock().remove(&req.id);
                Err(HarnessError::ApprovalTimeout {
                    tool: req.tool,
                    timeout_secs: self.policy.timeout_secs,
                })
            }
        }
    }

    /// 前端发回的决议
    pub fn resolve(&self, id: &str, decision: ApprovalDecision) -> HarnessResult<()> {
        let sender = self.pending.lock().remove(id);
        match sender {
            Some(tx) => tx
                .send(decision)
                .map_err(|_| HarnessError::ApprovalRejected {
                    tool: id.to_string(),
                    by: "channel_closed".into(),
                }),
            None => Err(HarnessError::ApprovalRejected {
                tool: id.to_string(),
                by: "no_pending".into(),
            }),
        }
    }

    /// 测试/查询用：当前挂起数量
    pub fn pending_count(&self) -> usize {
        self.pending.lock().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_glob_match_exact() {
        assert!(glob_match("delete_student", "delete_student"));
        assert!(!glob_match("delete_student", "delete_class"));
    }

    #[test]
    fn test_glob_match_prefix() {
        assert!(glob_match("delete_*", "delete_student"));
        assert!(glob_match("delete_*", "delete_by_class"));
        assert!(!glob_match("delete_*", "add_event"));
    }

    #[test]
    fn test_glob_match_wildcard() {
        assert!(glob_match("*", "anything"));
    }

    #[test]
    fn test_risk_level_from_tool_name() {
        assert_eq!(RiskLevel::from_tool_name("get_score"), RiskLevel::Low);
        assert_eq!(RiskLevel::from_tool_name("add_event"), RiskLevel::Medium);
        assert_eq!(RiskLevel::from_tool_name("delete_student"), RiskLevel::High);
        assert_eq!(RiskLevel::from_tool_name("reset_factory"), RiskLevel::Destructive);
        assert_eq!(RiskLevel::from_tool_name("bulk_add_event"), RiskLevel::Destructive);
    }

    #[test]
    fn test_policy_requires_readonly_no() {
        let p = HitlPolicy::default();
        let req = ApprovalRequest {
            id: "x".into(),
            run_id: "r".into(),
            agent_id: "a".into(),
            tool: "get_score".into(),
            args: Value::Null,
            is_write: false,
            risk: RiskLevel::Low,
            requested_at: 0,
        };
        assert!(!p.requires_approval(&req));
    }

    #[test]
    fn test_policy_requires_destructive_yes() {
        let p = HitlPolicy::default();
        let req = ApprovalRequest {
            id: "x".into(),
            run_id: "r".into(),
            agent_id: "a".into(),
            tool: "reset_factory".into(),
            args: Value::Null,
            is_write: true,
            risk: RiskLevel::Destructive,
            requested_at: 0,
        };
        assert!(p.requires_approval(&req));
    }

    #[test]
    fn test_policy_requires_delete_yes() {
        let p = HitlPolicy::default();
        let req = ApprovalRequest {
            id: "x".into(),
            run_id: "r".into(),
            agent_id: "a".into(),
            tool: "delete_student".into(),
            args: Value::Null,
            is_write: true,
            risk: RiskLevel::High,
            requested_at: 0,
        };
        assert!(p.requires_approval(&req));
    }

    #[test]
    fn test_decision_from_json_approve() {
        let v = serde_json::json!({"type": "approve", "by": "user_42"});
        let d = ApprovalDecision::from_json(v).unwrap();
        match d {
            ApprovalDecision::Approve { by } => assert_eq!(by, "user_42"),
            _ => panic!("expected Approve"),
        }
    }

    #[test]
    fn test_decision_from_json_reject() {
        let v = serde_json::json!({"type": "reject", "by": "user_42", "reason": "no"});
        let d = ApprovalDecision::from_json(v).unwrap();
        match d {
            ApprovalDecision::Reject { by, reason } => {
                assert_eq!(by, "user_42");
                assert_eq!(reason, "no");
            }
            _ => panic!("expected Reject"),
        }
    }

    #[test]
    fn test_decision_from_json_edit() {
        let v = serde_json::json!({
            "type": "edit",
            "by": "user_42",
            "new_args": {"student": "李四"}
        });
        let d = ApprovalDecision::from_json(v).unwrap();
        match d {
            ApprovalDecision::Edit { by, new_args } => {
                assert_eq!(by, "user_42");
                assert_eq!(new_args["student"], "李四");
            }
            _ => panic!("expected Edit"),
        }
    }

    /// 测试 resolve 时无 pending request → 返回 ApprovalRejected
    #[tokio::test]
    async fn test_resolve_no_pending() {
        // 构造一个不依赖 Tauri AppHandle 的 channel
        // 需要找办法 mock — 这里用 NoopAppHandle 思路, 但 tauri::test::mock_app 较重
        // 暂时跳过,留到 wire 测试
    }
}
