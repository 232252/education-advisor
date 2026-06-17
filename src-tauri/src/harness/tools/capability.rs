//! Capability 别名展开
//!
//! `config/agents.yaml` 使用人类可读的 capability 别名（如 `read`、`write`、
//! `academic`、`profile`），而 Harness ToolRegistry 使用命名空间式 capability
//!（如 `read:scores`、`write:events`）。本模块提供统一的别名展开逻辑，
//! 保证旧配置与新执行路径语义一致。
//!
//! 展开规则与 `crate::tools::eaa_tools::is_allowed()` 对齐，并补充 Harness
//! 新增的 dangerous/bulk 命名空间。

use std::collections::HashSet;

/// 把 YAML 风格的 capability 列表展开为 ToolRegistry 可理解的命名空间 caps。
///
/// - `all` / `*` 保持为 `all`（通配）。
/// - `read` 展开为所有只读工具所需 cap。
/// - `write` 展开为所有写入工具所需 cap（含 dangerous，保持与旧路径兼容；
///   高危操作仍由 Guardrails/HITL 二次拦截）。
/// - 具体别名（`score`/`history`/`add_event`/...）也做精确映射。
/// - 未知 cap 原样保留，便于未来扩展。
pub fn expand_capabilities(caps: &[String]) -> Vec<String> {
    let mut expanded: HashSet<String> = HashSet::with_capacity(caps.len() * 4);

    for cap in caps {
        let lower = cap.to_lowercase();
        match lower.as_str() {
            "all" | "*" => {
                expanded.insert("all".to_string());
            }
            "read" => {
                expanded.insert("read:scores".to_string());
                expanded.insert("read:history".to_string());
                expanded.insert("read:codes".to_string());
                expanded.insert("read:academic".to_string());
                expanded.insert("read:profile".to_string());
                expanded.insert("read:files".to_string());
                expanded.insert("read:math".to_string());
            }
            "write" => {
                expanded.insert("write:events".to_string());
                expanded.insert("write:students".to_string());
                expanded.insert("write:academic".to_string());
                expanded.insert("write:profile".to_string());
                expanded.insert("write:files".to_string());
                // 保持与旧 eaa_tools::is_allowed "write" 组兼容
                expanded.insert("dangerous:delete".to_string());
                expanded.insert("dangerous:reset".to_string());
                expanded.insert("dangerous:factory_reset".to_string());
            }
            "academic" => {
                expanded.insert("read:academic".to_string());
                expanded.insert("write:academic".to_string());
            }
            "profile" => {
                expanded.insert("read:profile".to_string());
                expanded.insert("write:profile".to_string());
            }
            "file_read" => {
                expanded.insert("read:files".to_string());
            }
            "file_write" => {
                expanded.insert("write:files".to_string());
            }
            "utility" | "util" => {
                expanded.insert("read:math".to_string());
            }
            // 只读工具具体别名
            "score" | "ranking" | "stats" | "summary" | "range" | "search" | "list" => {
                expanded.insert("read:scores".to_string());
            }
            "history" => {
                expanded.insert("read:history".to_string());
            }
            "codes" => {
                expanded.insert("read:codes".to_string());
            }
            // 写入工具具体别名
            "add_event" | "revert" => {
                expanded.insert("write:events".to_string());
            }
            "add_student" => {
                expanded.insert("write:students".to_string());
            }
            "delete_student" | "delete_class" | "delete_by_class" => {
                expanded.insert("write:students".to_string());
                expanded.insert("dangerous:delete".to_string());
            }
            "reset_events" => {
                expanded.insert("write:events".to_string());
                expanded.insert("dangerous:reset".to_string());
            }
            "reset_factory" => {
                expanded.insert("dangerous:factory_reset".to_string());
            }
            "bulk" => {
                expanded.insert("write:events".to_string());
                expanded.insert("write:students".to_string());
                expanded.insert("write:academic".to_string());
                expanded.insert("bulk".to_string());
            }
            // 未知或已是命名空间格式，原样保留
            _ => {
                expanded.insert(cap.clone());
            }
        }
    }

    expanded.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn wildcard_preserved() {
        let out = expand_capabilities(&caps(&["all"]));
        assert!(out.contains(&"all".to_string()));

        let out = expand_capabilities(&caps(&["*"]));
        assert!(out.contains(&"all".to_string()));
    }

    #[test]
    fn read_expands_to_readonly_caps() {
        let out = expand_capabilities(&caps(&["read"]));
        assert!(out.contains(&"read:scores".to_string()));
        assert!(out.contains(&"read:history".to_string()));
        assert!(out.contains(&"read:files".to_string()));
        assert!(!out.contains(&"write:events".to_string()));
    }

    #[test]
    fn write_expands_to_write_caps() {
        let out = expand_capabilities(&caps(&["write"]));
        assert!(out.contains(&"write:events".to_string()));
        assert!(out.contains(&"write:students".to_string()));
        assert!(out.contains(&"dangerous:factory_reset".to_string()));
    }

    #[test]
    fn academic_alias_expands_both_ways() {
        let out = expand_capabilities(&caps(&["academic"]));
        assert!(out.contains(&"read:academic".to_string()));
        assert!(out.contains(&"write:academic".to_string()));
    }

    #[test]
    fn concrete_tool_aliases_work() {
        let out = expand_capabilities(&caps(&["score", "history", "add_event", "reset_factory"]));
        assert!(out.contains(&"read:scores".to_string()));
        assert!(out.contains(&"read:history".to_string()));
        assert!(out.contains(&"write:events".to_string()));
        assert!(out.contains(&"dangerous:factory_reset".to_string()));
    }

    #[test]
    fn namespaced_caps_passthrough() {
        let out = expand_capabilities(&caps(&["read:scores", "write:events"]));
        assert!(out.contains(&"read:scores".to_string()));
        assert!(out.contains(&"write:events".to_string()));
    }
}
