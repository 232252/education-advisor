//! eaa_bridge — 30 个 eaa_tools 函数 → 30 个 Tool impl
//!
//! 关键设计约束:
//! - `crate::tools::eaa_tools::dispatch_cached` 是 **同步** 函数, 内部做文件 IO
//! - 它接收 `&DataCache` 第 4 参数
//! - 我们在 async handler 里用 `tokio::task::spawn_blocking` 包装, 避免阻塞 runtime
//! - handler 内部新建/复用 DataCache: 简单情况下 lazy load, Agent Harness 启动时可注入预热的 cache
//!
//! 注意: 这种"每次调用都 spawn_blocking"的模式牺牲了一些性能 (线程切换开销 ~10μs),
//! 但保留了 trait Tool 全异步的统一接口。阶段五会做优化 (Agent Harness 持有 shared cache,
//! handler 通过 ctx 取)。

use serde_json::{json, Value};

use super::ToolRegistry;

/// 构建含 30 个 eaa Tool 的默认 Registry
pub fn build_default_registry() -> ToolRegistry {
    use self::eaa_bridge_impl::*;
    ToolRegistry::builder()
        // 只读
        .register(GetScore)
        .register(GetHistory)
        .register(GetRanking)
        .register(GetStats)
        .register(GetCodes)
        .register(Search)
        .register(ListStudents)
        .register(GetSummary)
        .register(GetRange)
        .register(AcademicGet)
        .register(ProfileGet)
        // 写操作
        .register(AddEvent)
        .register(AddStudent)
        .register(RevertEvent)
        .register(AcademicAdd)
        .register(ProfileSet)
        .register(DeleteStudent)
        .register(DeleteByClass)
        .register(ResetEvents)
        .register(ResetFactory)
        .register(BulkAddEvent)
        .register(BulkAddStudent)
        // 辅助
        .register(ReadFile)
        .register(WriteFile)
        .register(ListDir)
        .register(Calculate)
        .build()
}

/// 30 个 Tool impl 的实际定义
pub mod eaa_bridge_impl {

    use super::{json, Value};
    use crate::harness::tools::ToolError;
    use crate::tools::data_cache::DataCache;
    use crate::tools_eaa;
    use std::sync::Arc;

    /// `Result<Value, AppError>` → `Result<Value, ToolError>` 翻译
    fn tr(err: crate::error::AppError) -> ToolError {
        match err {
            crate::error::AppError::PermissionDenied(m) => ToolError::Denied(m),
            crate::error::AppError::NotFound(m) => ToolError::NotFound(m),
            other => ToolError::InvalidArgs(other.to_string()),
        }
    }

    /// 辅助: 获取 DataCache (优先复用 ctx.data_cache, 否则新建)
    ///
    /// spawn_blocking 需要 'static, 所以这里 clone Arc 出新引用, 把 DataCache 移进去
    fn cache_or_new(
        ctx: &crate::harness::tools::ToolContext,
    ) -> Arc<DataCache> {
        if let Some(c) = ctx.data_cache.as_ref() {
            Arc::clone(c)
        } else {
            Arc::new(DataCache::new())
        }
    }

    /// 辅助: 在 spawn_blocking 线程里调 dispatch_cached
    async fn run_dispatch(
        tool_name: &'static str,
        args: Value,
        caps: Arc<Vec<String>>,
        cache: Arc<DataCache>,
    ) -> std::result::Result<Value, ToolError> {
        tokio::task::spawn_blocking(move || {
            crate::tools::eaa_tools::dispatch_cached(
                tool_name,
                &args,
                &caps,
                &cache,
            )
        })
        .await
        .map_err(|e| ToolError::Internal(format!("join error: {e}")))
        .and_then(|r| r.map_err(tr))
    }

    // ============ 只读类 ============

    tools_eaa! {
        /// 查询某学生当前分数
        pub GetScore => {
            name: "get_score",
            desc: "查询某学生当前分数",
            schema: json!({
                "type": "object",
                "properties": {"student": {"type": "string"}},
                "required": ["student"]
            }),
            caps: &["read:scores"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:scores".to_string()]);
                run_dispatch("score", args, caps, cache).await
            }
        }

        /// 查询某学生事件历史
        pub GetHistory => {
            name: "get_history",
            desc: "查询某学生的事件历史",
            schema: json!({
                "type": "object",
                "properties": {
                    "student": {"type": "string"},
                    "limit": {"type": "integer", "default": 20}
                },
                "required": ["student"]
            }),
            caps: &["read:history"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:history".to_string()]);
                run_dispatch("history", args, caps, cache).await
            }
        }

        /// 查询排名
        pub GetRanking => {
            name: "get_ranking",
            desc: "查询当前学生排名",
            schema: json!({
                "type": "object",
                "properties": {"limit": {"type": "integer", "default": 50}}
            }),
            caps: &["read:scores"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:scores".to_string()]);
                run_dispatch("ranking", args, caps, cache).await
            }
        }

        /// 统计信息
        pub GetStats => {
            name: "get_stats",
            desc: "查询整体统计信息 (平均分/最高/最低/分布)",
            schema: json!({"type": "object", "properties": {}}),
            caps: &["read:scores"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:scores".to_string()]);
                run_dispatch("stats", args, caps, cache).await
            }
        }

        /// 列出 reason_code
        pub GetCodes => {
            name: "get_codes",
            desc: "列出所有可用的 reason_code 编码",
            schema: json!({"type": "object", "properties": {}}),
            caps: &["read:codes"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:codes".to_string()]);
                run_dispatch("codes", args, caps, cache).await
            }
        }

        /// 全文搜索学生
        pub Search => {
            name: "search",
            desc: "按关键词搜索学生",
            schema: json!({
                "type": "object",
                "properties": {"keyword": {"type": "string"}},
                "required": ["keyword"]
            }),
            caps: &["read:scores"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:scores".to_string()]);
                run_dispatch("search", args, caps, cache).await
            }
        }

        /// 列出所有学生
        pub ListStudents => {
            name: "list_students",
            desc: "列出所有学生",
            schema: json!({"type": "object", "properties": {}}),
            caps: &["read:scores"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:scores".to_string()]);
                run_dispatch("list_students", args, caps, cache).await
            }
        }

        /// 摘要
        pub GetSummary => {
            name: "get_summary",
            desc: "查询某学生摘要",
            schema: json!({
                "type": "object",
                "properties": {"student": {"type": "string"}},
                "required": ["student"]
            }),
            caps: &["read:scores"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:scores".to_string()]);
                run_dispatch("summary", args, caps, cache).await
            }
        }

        /// 区间分数
        pub GetRange => {
            name: "get_range",
            desc: "查询某学生在分数区间的位置",
            schema: json!({
                "type": "object",
                "properties": {
                    "low": {"type": "number"},
                    "high": {"type": "number"}
                }
            }),
            caps: &["read:scores"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:scores".to_string()]);
                run_dispatch("range", args, caps, cache).await
            }
        }

        /// 获取某学生学业档案
        pub AcademicGet => {
            name: "academic_get",
            desc: "获取某学生学业档案",
            schema: json!({
                "type": "object",
                "properties": {"student": {"type": "string"}},
                "required": ["student"]
            }),
            caps: &["read:academic"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:academic".to_string()]);
                run_dispatch("academic_get", args, caps, cache).await
            }
        }

        /// 获取某学生 profile
        pub ProfileGet => {
            name: "profile_get",
            desc: "获取某学生 profile (基本信息/标签/备注)",
            schema: json!({
                "type": "object",
                "properties": {"student": {"type": "string"}},
                "required": ["student"]
            }),
            caps: &["read:profile"],
            is_write: false,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["read:profile".to_string()]);
                run_dispatch("profile_get", args, caps, cache).await
            }
        }
    }

    // ============ 写操作类 ============

    tools_eaa! {
        /// 为某学生添加一次事件
        pub AddEvent => {
            name: "add_event",
            desc: "为某学生添加一次分数事件 (月考/周测/作业/出勤等)",
            schema: json!({
                "type": "object",
                "properties": {
                    "student": {"type": "string"},
                    "delta": {"type": "number"},
                    "reason_code": {"type": "string"},
                    "event_type": {"type": "string"}
                },
                "required": ["student", "delta", "reason_code", "event_type"]
            }),
            caps: &["write:events"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["write:events".to_string()]);
                run_dispatch("add_event", args, caps, cache).await
            }
        }

        /// 添加学生
        pub AddStudent => {
            name: "add_student",
            desc: "添加新学生",
            schema: json!({
                "type": "object",
                "properties": {
                    "student": {"type": "string"},
                    "class": {"type": "string"}
                },
                "required": ["student"]
            }),
            caps: &["write:students"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["write:students".to_string()]);
                run_dispatch("add_student", args, caps, cache).await
            }
        }

        /// 撤回最近事件
        pub RevertEvent => {
            name: "revert_event",
            desc: "撤回某学生最近一次事件",
            schema: json!({
                "type": "object",
                "properties": {"student": {"type": "string"}},
                "required": ["student"]
            }),
            caps: &["write:events"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["write:events".to_string()]);
                run_dispatch("revert_event", args, caps, cache).await
            }
        }

        /// 添加学业记录
        pub AcademicAdd => {
            name: "academic_add",
            desc: "为某学生添加学业档案记录",
            schema: json!({
                "type": "object",
                "properties": {
                    "student": {"type": "string"},
                    "kind": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["student", "kind", "content"]
            }),
            caps: &["write:academic"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["write:academic".to_string()]);
                run_dispatch("academic_add", args, caps, cache).await
            }
        }

        /// 设置 profile
        pub ProfileSet => {
            name: "profile_set",
            desc: "设置某学生 profile 字段",
            schema: json!({
                "type": "object",
                "properties": {
                    "student": {"type": "string"},
                    "field": {"type": "string"},
                    "value": {}
                },
                "required": ["student", "field", "value"]
            }),
            caps: &["write:profile"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["write:profile".to_string()]);
                run_dispatch("profile_set", args, caps, cache).await
            }
        }

        /// 删除学生
        pub DeleteStudent => {
            name: "delete_student",
            desc: "删除某学生 (不可恢复!)",
            schema: json!({
                "type": "object",
                "properties": {"student": {"type": "string"}},
                "required": ["student"]
            }),
            caps: &["write:students", "dangerous:delete"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec![
                    "write:students".to_string(),
                    "dangerous:delete".to_string(),
                ]);
                run_dispatch("delete_student", args, caps, cache).await
            }
        }

        /// 按班级删除
        pub DeleteByClass => {
            name: "delete_by_class",
            desc: "删除某班级所有学生 (不可恢复!)",
            schema: json!({
                "type": "object",
                "properties": {"class": {"type": "string"}},
                "required": ["class"]
            }),
            caps: &["write:students", "dangerous:delete"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec![
                    "write:students".to_string(),
                    "dangerous:delete".to_string(),
                ]);
                run_dispatch("delete_by_class", args, caps, cache).await
            }
        }

        /// 重置某学生事件
        pub ResetEvents => {
            name: "reset_events",
            desc: "重置某学生所有事件 (回到 BASE_SCORE)",
            schema: json!({
                "type": "object",
                "properties": {"student": {"type": "string"}},
                "required": ["student"]
            }),
            caps: &["write:events", "dangerous:reset"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec![
                    "write:events".to_string(),
                    "dangerous:reset".to_string(),
                ]);
                run_dispatch("reset_events", args, caps, cache).await
            }
        }

        /// 恢复出厂
        pub ResetFactory => {
            name: "reset_factory",
            desc: "恢复出厂 (清空所有数据!)",
            schema: json!({"type": "object", "properties": {}}),
            caps: &["dangerous:factory_reset"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec!["dangerous:factory_reset".to_string()]);
                run_dispatch("reset_factory", args, caps, cache).await
            }
        }

        /// 批量添加事件
        pub BulkAddEvent => {
            name: "bulk_add_event",
            desc: "批量添加事件 (CSV 内容)",
            schema: json!({
                "type": "object",
                "properties": {"csv": {"type": "string"}},
                "required": ["csv"]
            }),
            caps: &["write:events", "bulk"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec![
                    "write:events".to_string(),
                    "bulk".to_string(),
                ]);
                run_dispatch("bulk_add_event", args, caps, cache).await
            }
        }

        /// 批量添加学生
        pub BulkAddStudent => {
            name: "bulk_add_student",
            desc: "批量添加学生 (CSV 内容)",
            schema: json!({
                "type": "object",
                "properties": {"csv": {"type": "string"}},
                "required": ["csv"]
            }),
            caps: &["write:students", "bulk"],
            is_write: true,
            handler: async |args, ctx| {
                let cache = cache_or_new(ctx);
                let caps = Arc::new(vec![
                    "write:students".to_string(),
                    "bulk".to_string(),
                ]);
                run_dispatch("bulk_add_student", args, caps, cache).await
            }
        }
    }

    // ============ 辅助 (file_tools / utility) ============

    tools_eaa! {
        /// 读取文件
        pub ReadFile => {
            name: "read_file",
            desc: "读取应用数据目录下的某个文件 (路径必须在 eaa_data 内)",
            schema: json!({
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"]
            }),
            caps: &["read:files"],
            is_write: false,
            handler: async |args, _ctx| {
                let path = args.get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let join_result: std::result::Result<
                    serde_json::Value,
                    tokio::task::JoinError,
                > = tokio::task::spawn_blocking(move || {
                    crate::tools::file_tools::read_file_value(&serde_json::json!({"path": path}))
                })
                .await;

                match join_result {
                    Ok(v) => Ok(v),
                    Err(join_err) => Err(ToolError::Internal(format!("join error: {join_err}"))),
                }
            }
        }

        /// 写入文件
        pub WriteFile => {
            name: "write_file",
            desc: "写入应用数据目录下的某个文件 (覆盖, 慎用)",
            schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }),
            caps: &["write:files"],
            is_write: true,
            handler: async |args, _ctx| {
                let path = args.get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let content = args.get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let join_result: std::result::Result<
                    serde_json::Value,
                    tokio::task::JoinError,
                > = tokio::task::spawn_blocking(move || {
                    crate::tools::file_tools::write_file_value(&serde_json::json!({
                        "path": path,
                        "content": content,
                    }))
                })
                .await;

                match join_result {
                    Ok(v) => Ok(v),
                    Err(join_err) => Err(ToolError::Internal(format!("join error: {join_err}"))),
                }
            }
        }

        /// 列目录
        pub ListDir => {
            name: "list_dir",
            desc: "列出应用数据目录下某目录的文件",
            schema: json!({
                "type": "object",
                "properties": {"path": {"type": "string", "default": "."}}
            }),
            caps: &["read:files"],
            is_write: false,
            handler: async |args, _ctx| {
                let path = args.get("path")
                    .and_then(|v| v.as_str())
                    .unwrap_or(".")
                    .to_string();
                let join_result: std::result::Result<
                    serde_json::Value,
                    tokio::task::JoinError,
                > = tokio::task::spawn_blocking(move || {
                    crate::tools::file_tools::list_dir_value(&serde_json::json!({"path": path}))
                })
                .await;

                match join_result {
                    Ok(v) => Ok(v),
                    Err(join_err) => Err(ToolError::Internal(format!("join error: {join_err}"))),
                }
            }
        }

        /// 表达式求值
        pub Calculate => {
            name: "calculate",
            desc: "数学表达式求值 (支持 +-*/% 与括号)",
            schema: json!({
                "type": "object",
                "properties": {"expr": {"type": "string"}},
                "required": ["expr"]
            }),
            caps: &["read:math"],
            is_write: false,
            handler: async |args, _ctx| {
                let expr = args.get("expr")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let join_result: std::result::Result<
                    std::result::Result<serde_json::Value, crate::error::AppError>,
                    tokio::task::JoinError,
                > = tokio::task::spawn_blocking(move || {
                    crate::tools::utility::calculate_value(&json!({"expr": expr}))
                })
                .await;

                match join_result {
                    Ok(Ok(v)) => Ok(v),
                    Ok(Err(app_err)) => Err(ToolError::Internal(app_err.to_string())),
                    Err(join_err) => Err(ToolError::Internal(format!("join error: {join_err}"))),
                }
            }
        }
    }
}