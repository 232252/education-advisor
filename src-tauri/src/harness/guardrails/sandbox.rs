//! Sandbox — 资源限制（args/result 大小 + 路径白名单 + 超时）
//!
//! 详见模块根 mod.rs。本文件在阶段三 R5 实现。

use std::path::PathBuf;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{Guardrail, GuardrailAction, GuardrailContext, Severity};
use crate::harness::error::Result as HarnessResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// 工具 args 序列化最大字节（默认 64KB）
    pub max_args_bytes: usize,
    /// 工具 result 序列化最大字节（默认 1MB）
    pub max_result_bytes: usize,
    /// 截断后保留的字节数（默认 64KB）
    pub max_truncated_bytes: usize,
    /// 工具执行最大时长（秒, 默认 30s）
    pub max_tool_timeout_sec: u64,
    /// 路径白名单前缀（任何不在此列表的子树的 path → 拒绝）
    pub allowed_path_prefixes: Vec<PathBuf>,
    /// 路径黑名单前缀（命中则拒绝, 优先级高于白名单）
    pub blocked_path_prefixes: Vec<PathBuf>,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        let mut blocked = Vec::new();
        if let Some(home) = std::env::var_os("HOME") {
            let home_path = PathBuf::from(home);
            blocked.push(home_path.join(".ssh"));
            blocked.push(home_path.join(".gnupg"));
            blocked.push(home_path.join(".aws"));
        }
        // 平台无关的系统敏感路径
        blocked.push(PathBuf::from("/etc"));
        blocked.push(PathBuf::from("/var/log"));
        blocked.push(PathBuf::from("/root"));
        blocked.push(PathBuf::from("C:\\Windows\\System32"));
        blocked.push(PathBuf::from("C:\\Program Files"));

        Self {
            max_args_bytes: 64 * 1024,
            max_result_bytes: 1024 * 1024,
            max_truncated_bytes: 64 * 1024,
            max_tool_timeout_sec: 30,
            allowed_path_prefixes: Vec::new(), // 空 = 不限制
            blocked_path_prefixes: blocked,
        }
    }
}

pub struct Sandbox {
    pub limits: ResourceLimits,
}

impl Sandbox {
    pub fn new(limits: ResourceLimits) -> Self {
        Self { limits }
    }

    /// 检查工具 args
    pub fn check_args(&self, tool: &str, args: &Value) -> HarnessResult<()> {
        // 1. 大小
        let serialized = serde_json::to_string(args).unwrap_or_default();
        if serialized.len() > self.limits.max_args_bytes {
            return Err(crate::harness::error::HarnessError::GuardrailBlocked {
                guardrail: "sandbox.size".into(),
                hook: "tool_call.args".into(),
                reason: format!(
                    "args 过大 ({} > {} bytes), tool={}",
                    serialized.len(),
                    self.limits.max_args_bytes,
                    tool
                ),
            });
        }
        // 2. 路径守卫
        if let Some(obj) = args.as_object() {
            for (k, v) in obj {
                let kl = k.to_lowercase();
                if kl == "path" || kl == "file" || kl == "dir" || kl == "file_path" {
                    if let Some(s) = v.as_str() {
                        self.check_path(tool, s)?;
                    }
                }
            }
        }
        Ok(())
    }

    /// 检查路径
    pub fn check_path(&self, tool: &str, path: &str) -> HarnessResult<()> {
        let p = PathBuf::from(path);
        // 黑名单优先
        for prefix in &self.limits.blocked_path_prefixes {
            if p.starts_with(prefix) {
                return Err(crate::harness::error::HarnessError::GuardrailBlocked {
                    guardrail: "sandbox.path".into(),
                    hook: "tool_call.path".into(),
                    reason: format!("路径 {path:?} 在黑名单内 ({prefix:?}), tool={tool}"),
                });
            }
        }
        // 白名单
        if !self.limits.allowed_path_prefixes.is_empty() {
            let allowed = self
                .limits
                .allowed_path_prefixes
                .iter()
                .any(|prefix| p.starts_with(prefix));
            if !allowed {
                return Err(crate::harness::error::HarnessError::GuardrailBlocked {
                    guardrail: "sandbox.path".into(),
                    hook: "tool_call.path".into(),
                    reason: format!("路径 {path:?} 不在白名单内, tool={tool}"),
                });
            }
        }
        Ok(())
    }

    /// 包装 tool call, 加超时
    pub fn timeout(&self) -> Duration {
        Duration::from_secs(self.limits.max_tool_timeout_sec)
    }
}

#[async_trait]
impl Guardrail for Sandbox {
    fn name(&self) -> &'static str {
        "sandbox"
    }

    async fn check_tool_call(
        &self,
        ctx: &mut GuardrailContext<'_>,
    ) -> HarnessResult<GuardrailAction> {
        let tool = ctx.tool.unwrap_or("unknown");
        match self.check_args(tool, ctx.data) {
            Ok(()) => Ok(GuardrailAction::Allow),
            Err(e) => {
                let reason = e.to_string();
                Ok(GuardrailAction::Block {
                    reason,
                    severity: Severity::Block,
                    evidence: Some(format!("tool={tool}")),
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn test_sandbox() -> Sandbox {
        Sandbox::new(ResourceLimits {
            max_args_bytes: 1024,
            ..ResourceLimits::default()
        })
    }

    #[test]
    fn test_args_under_limit_passes() {
        let s = test_sandbox();
        let args = json!({"student": "张三"});
        assert!(s.check_args("add_event", &args).is_ok());
    }

    #[test]
    fn test_args_over_limit_blocks() {
        let s = test_sandbox();
        // 构造 2KB 字符串
        let big = "x".repeat(2048);
        let args = json!({"data": big});
        let r = s.check_args("add_event", &args);
        assert!(r.is_err());
        let msg = format!("{r:?}");
        assert!(msg.contains("args 过大"));
    }

    #[test]
    fn test_blocked_path_blocks() {
        let s = Sandbox::new(ResourceLimits {
            blocked_path_prefixes: vec![PathBuf::from("/secret")],
            ..ResourceLimits::default()
        });
        let args = json!({"path": "/secret/passwords.txt"});
        let r = s.check_args("read_file", &args);
        assert!(r.is_err());
    }

    #[test]
    fn test_safe_path_passes() {
        let s = Sandbox::new(ResourceLimits {
            blocked_path_prefixes: vec![PathBuf::from("/secret")],
            ..ResourceLimits::default()
        });
        let args = json!({"path": "/tmp/data.json"});
        assert!(s.check_args("read_file", &args).is_ok());
    }

    #[test]
    fn test_allowed_path_enforced() {
        let s = Sandbox::new(ResourceLimits {
            allowed_path_prefixes: vec![PathBuf::from("/data")],
            ..ResourceLimits::default()
        });
        // /tmp 不在白名单
        let args = json!({"path": "/tmp/x.txt"});
        assert!(s.check_args("read_file", &args).is_err());
        // /data 在白名单
        let args = json!({"path": "/data/x.txt"});
        assert!(s.check_args("read_file", &args).is_ok());
    }

    #[test]
    fn test_default_blocked_includes_etc() {
        let lim = ResourceLimits::default();
        assert!(lim
            .blocked_path_prefixes
            .iter()
            .any(|p| p == &PathBuf::from("/etc")));
    }

    #[test]
    fn test_timeout_default_30s() {
        let s = Sandbox::new(ResourceLimits::default());
        assert_eq!(s.timeout(), Duration::from_secs(30));
    }
}
