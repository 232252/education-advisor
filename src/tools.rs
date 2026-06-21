//! Tool registry for agent function-calling.
//!
//! Each tool is a pure async function `(args: Value, ctx, cancel) -> String`
//! plus a static [`ToolDefinition`] that describes it to the LLM via the
//! system prompt. Tools are looked up by name in [`ToolRegistry::execute`].
//!
//! Add a new tool by:
//!   1. Implementing an `async fn` with the right signature
//!   2. Calling [`register`] in [`ToolRegistry::with_defaults`]
//!   3. (Optional) Updating a downstream page that surfaces tool results
//!
//! The registry is small and intentionally synchronous from the LLM's
//! perspective; we don't need a hot-reload system at the current scale.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::Value;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::models::{RiskLevel, ToolStatus};
use crate::runtime::RuntimeCtx;

/// Static description of a tool, used to render the system prompt.
#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: &'static str,
    pub purpose: &'static str,
    /// A short JSON-Schema-ish hint that the LLM can read; the actual
    /// validation happens at execution time. We don't ship a full schema
    /// because (a) it bloats the prompt and (b) most LLMs ignore strict
    /// schema constraints anyway.
    pub args_schema_hint: &'static str,
}

/// Outcome of a single tool execution.
#[derive(Debug, Clone)]
pub struct ToolResult {
    pub output: String,
    pub status: ToolStatus,
}

impl ToolResult {
    pub const fn ok(output: String) -> Self {
        Self {
            output,
            status: ToolStatus::Success,
        }
    }
    pub const fn err(output: String) -> Self {
        Self {
            output,
            status: ToolStatus::Failed,
        }
    }
}

/// The boxed future a tool returns. Using a trait object (rather than a
/// function pointer to a concrete `async fn`) lets us store heterogeneous
/// `async` functions behind a single `HashMap<&'static str, …>`.
pub type BoxedToolFuture =
    Pin<Box<dyn Future<Output = ToolResult> + Send + 'static>>;

/// A tool function: `(ctx, args, cancel) -> future of ToolResult`.
pub type BoxedTool = Box<
    dyn Fn(Arc<RuntimeCtx>, Value, CancellationToken) -> BoxedToolFuture + Send + Sync + 'static,
>;

/// In-memory registry. The lifetime of the program is bounded so we keep it
/// simple — no RwLock, no dynamic unload.
pub struct ToolRegistry {
    defs: Vec<ToolDefinition>,
    map: HashMap<&'static str, BoxedTool>,
}

impl ToolRegistry {
    /// Build the default registry with all built-in tools.
    pub fn with_defaults() -> Self {
        let mut r = Self {
            defs: Vec::new(),
            map: HashMap::new(),
        };
        // Read-only
        r.register(lookup_student_def(), |ctx, args, cancel| {
            Box::pin(lookup_student(ctx, args, cancel))
        });
        r.register(get_student_def(), |ctx, args, cancel| {
            Box::pin(get_student(ctx, args, cancel))
        });
        r.register(get_grades_def(), |ctx, args, cancel| {
            Box::pin(get_grades(ctx, args, cancel))
        });
        r.register(list_risk_students_def(), |ctx, args, cancel| {
            Box::pin(list_risk_students(ctx, args, cancel))
        });
        r.register(count_students_def(), |ctx, args, cancel| {
            Box::pin(count_students(ctx, args, cancel))
        });
        r.register(dashboard_summary_def(), |ctx, args, cancel| {
            Box::pin(dashboard_summary(ctx, args, cancel))
        });
        r.register(search_students_def(), |ctx, args, cancel| {
            Box::pin(search_students(ctx, args, cancel))
        });
        r.register(recent_grades_def(), |ctx, args, cancel| {
            Box::pin(recent_grades(ctx, args, cancel))
        });
        r.register(rag_query_def(), |ctx, args, cancel| {
            Box::pin(rag_query(ctx, args, cancel))
        });
        r
    }

    /// Register a tool. The closure must return a boxed future, which we
    /// allow callers to write as `|ctx, args, cancel| Box::pin(tool_fn(ctx, args, cancel))`.
    fn register<F>(&mut self, def: ToolDefinition, f: F)
    where
        F: Fn(Arc<RuntimeCtx>, Value, CancellationToken) -> BoxedToolFuture
            + Send
            + Sync
            + 'static,
    {
        // `Box::from` triggers the unsized coercion from `Box<F>` to
        // `Box<dyn Fn(...) -> ... + Send + Sync + 'static>`. Plain `Box::new`
        // does not perform that coercion automatically.
        let boxed: BoxedTool = Box::from(f);
        self.defs.push(def);
        self.map.insert(def.name, boxed);
    }

    pub fn list(&self) -> &[ToolDefinition] {
        &self.defs
    }

    pub fn get(&self, name: &str) -> Option<&ToolDefinition> {
        self.defs.iter().find(|d| d.name == name)
    }

    pub fn names(&self) -> Vec<&'static str> {
        self.defs.iter().map(|d| d.name).collect()
    }

    /// Run a tool by name. Returns `ToolResult::err` with a descriptive
    /// message if the name is unknown; the caller decides whether to surface
    /// that to the LLM.
    pub async fn execute(
        &self,
        ctx: &Arc<RuntimeCtx>,
        name: &str,
        args: &Value,
        cancel: CancellationToken,
    ) -> ToolResult {
        match self.map.get(name) {
            Some(f) => f(ctx.clone(), args.clone(), cancel).await,
            None => ToolResult::err(format!("未知工具: {name}")),
        }
    }
}

// ============================================================================
// Helpers shared across tools
// ============================================================================

fn arg_string<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(|v| v.as_str()).unwrap_or("")
}
fn arg_uuid(args: &Value, key: &str) -> Option<Uuid> {
    args.get(key)
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
}

// ============================================================================
// Tool definitions
// ============================================================================

fn lookup_student_def() -> ToolDefinition {
    ToolDefinition {
        name: "lookup_student",
        purpose: "按姓名（子串匹配）查询学生档案：年级、班级、风险等级、GPA",
        args_schema_hint: r#"{"name":"张三"}"#,
    }
}
fn get_grades_def() -> ToolDefinition {
    ToolDefinition {
        name: "get_grades",
        purpose: "按学生 UUID 查询该生所有成绩（科目 / 分数 / 满分 / 考试日期）",
        args_schema_hint: r#"{"id":"学生UUID"}"#,
    }
}
fn list_risk_students_def() -> ToolDefinition {
    ToolDefinition {
        name: "list_risk_students",
        purpose: "列出当前所有高风险 / 危机等级的学生（按姓名、年级、班级）",
        args_schema_hint: "{}",
    }
}
fn count_students_def() -> ToolDefinition {
    ToolDefinition {
        name: "count_students",
        purpose: "统计学生总数与各风险等级分布",
        args_schema_hint: "{}",
    }
}
fn dashboard_summary_def() -> ToolDefinition {
    ToolDefinition {
        name: "dashboard_summary",
        purpose: "获取首页总览：平均 GPA、当日新增会话、累计工具调用",
        args_schema_hint: "{}",
    }
}
fn search_students_def() -> ToolDefinition {
    ToolDefinition {
        name: "search_students",
        purpose: "按关键字搜索学生：姓名 / 年级 / 班级 / 标签 任意字段子串匹配",
        args_schema_hint: r#"{"query":"高三"}"#,
    }
}
fn get_student_def() -> ToolDefinition {
    ToolDefinition {
        name: "get_student",
        purpose: "按学生 UUID 精确查询完整档案（含监护人、地址、标签）",
        args_schema_hint: r#"{"id":"学生UUID"}"#,
    }
}
fn recent_grades_def() -> ToolDefinition {
    ToolDefinition {
        name: "recent_grades",
        purpose: "查询最近 N 条全年级考试记录，用于横向对比",
        args_schema_hint: r#"{"limit":10}"#,
    }
}
fn rag_query_def() -> ToolDefinition {
    ToolDefinition {
        name: "rag_query",
        purpose: "在本地知识库里查询与问题最相关的文档片段",
        args_schema_hint: r#"{"query":"学生请假流程","top_k":3}"#,
    }
}

// ============================================================================
// Tool implementations
// ============================================================================

async fn lookup_student(
    ctx: Arc<RuntimeCtx>,
    args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    let name = arg_string(&args, "name");
    if name.is_empty() {
        return ToolResult::err("缺少必填参数 name".into());
    }
    match ctx.db.list_students() {
        Ok(list) => {
            let found: Vec<_> = list
                .into_iter()
                .filter(|s| s.name.contains(name))
                .take(5)
                .collect();
            if found.is_empty() {
                ToolResult::ok(format!("未找到姓名包含「{name}」的学生"))
            } else {
                let lines: Vec<String> = found
                    .iter()
                    .map(|s| {
                        format!(
                            "{}（{}{}），风险：{}，GPA：{}",
                            s.name,
                            s.grade,
                            s.class,
                            s.risk_level.label(),
                            s.gpa.map_or_else(|| "未知".into(), |g| format!("{g:.2}"))
                        )
                    })
                    .collect();
                ToolResult::ok(lines.join("\n"))
            }
        }
        Err(e) => ToolResult::err(format!("查询失败: {e}")),
    }
}

async fn get_student(
    ctx: Arc<RuntimeCtx>,
    args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    let Some(id) = arg_uuid(&args, "id") else {
        return ToolResult::err("缺少或非法的 id 参数".into());
    };
    match ctx.db.list_students() {
        Ok(list) => match list.into_iter().find(|s| s.id == id) {
            Some(s) => {
                let mut parts = vec![format!(
                    "{}（{}{}），风险：{}，GPA：{}",
                    s.name,
                    s.grade,
                    s.class,
                    s.risk_level.label(),
                    s.gpa.map_or_else(|| "未知".into(), |g| format!("{g:.2}"))
                )];
                if let Some(g) = s.guardian_name {
                    parts.push(format!("监护人：{g}"));
                }
                if !s.tags.is_empty() {
                    parts.push(format!("标签：{}", s.tags.join("、")));
                }
                if let Some(n) = s.notes {
                    parts.push(format!("备注：{n}"));
                }
                ToolResult::ok(parts.join("\n"))
            }
            None => ToolResult::err(format!("未找到 id={id} 的学生")),
        },
        Err(e) => ToolResult::err(format!("查询失败: {e}")),
    }
}

async fn get_grades(
    ctx: Arc<RuntimeCtx>,
    args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    let Some(id) = arg_uuid(&args, "id") else {
        return ToolResult::err("缺少或非法的 id 参数".into());
    };
    match ctx.db.grades_for(id) {
        Ok(g) => {
            if g.is_empty() {
                ToolResult::ok("暂无成绩记录".into())
            } else {
                let lines: Vec<String> = g
                    .iter()
                    .map(|x| {
                        format!(
                            "{}: {:.1}/{:.1} (考试日期 {})",
                            x.subject, x.score, x.max_score, x.exam_date
                        )
                    })
                    .collect();
                ToolResult::ok(lines.join("\n"))
            }
        }
        Err(e) => ToolResult::err(format!("查询失败: {e}")),
    }
}

async fn list_risk_students(
    ctx: Arc<RuntimeCtx>,
    _args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    match ctx.db.list_students() {
        Ok(list) => {
            let high: Vec<_> = list
                .into_iter()
                .filter(|s| matches!(s.risk_level, RiskLevel::High | RiskLevel::Critical))
                .collect();
            if high.is_empty() {
                ToolResult::ok("当前无高/危机风险学生".into())
            } else {
                let lines: Vec<String> = high
                    .iter()
                    .map(|s| {
                        format!(
                            "{}（{}{}）- {}",
                            s.name,
                            s.grade,
                            s.class,
                            s.risk_level.label()
                        )
                    })
                    .collect();
                ToolResult::ok(lines.join("\n"))
            }
        }
        Err(e) => ToolResult::err(format!("查询失败: {e}")),
    }
}

async fn count_students(
    ctx: Arc<RuntimeCtx>,
    _args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    match ctx.db.dashboard_stats() {
        Ok(st) => ToolResult::ok(format!(
            "学生总数：{}，风险分布：低{} 中{} 高{} 危机{}",
            st.total_students,
            st.risk_distribution[0],
            st.risk_distribution[1],
            st.risk_distribution[2],
            st.risk_distribution[3]
        )),
        Err(e) => ToolResult::err(format!("统计失败: {e}")),
    }
}

async fn dashboard_summary(
    ctx: Arc<RuntimeCtx>,
    _args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    match ctx.db.dashboard_stats() {
        Ok(st) => ToolResult::ok(format!(
            "总览：学生 {} 人，平均 GPA {:.2}，今日会话 {} 条，累计工具调用 {} 次。",
            st.total_students,
            st.avg_gpa,
            st.conversations_today,
            st.tool_calls_total
        )),
        Err(e) => ToolResult::err(format!("总览获取失败: {e}")),
    }
}

async fn search_students(
    ctx: Arc<RuntimeCtx>,
    args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    let q = arg_string(&args, "query").trim();
    if q.is_empty() {
        return ToolResult::err("缺少必填参数 query".into());
    }
    match ctx.db.list_students() {
        Ok(list) => {
            let found: Vec<_> = list
                .into_iter()
                .filter(|s| {
                    s.name.contains(q)
                        || s.grade.contains(q)
                        || s.class.contains(q)
                        || s.tags.iter().any(|t| t.contains(q))
                })
                .take(10)
                .collect();
            if found.is_empty() {
                ToolResult::ok(format!("未找到匹配「{q}」的学生"))
            } else {
                let lines: Vec<String> = found
                    .iter()
                    .map(|s| {
                        format!(
                            "{}（{}{}），风险：{}",
                            s.name,
                            s.grade,
                            s.class,
                            s.risk_level.label()
                        )
                    })
                    .collect();
                ToolResult::ok(lines.join("\n"))
            }
        }
        Err(e) => ToolResult::err(format!("查询失败: {e}")),
    }
}

async fn recent_grades(
    ctx: Arc<RuntimeCtx>,
    args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10)
        .clamp(1, 200) as usize;
    match ctx.db.all_grades() {
        Ok(mut g) => {
            // sort newest first by exam_date
            g.sort_by(|a, b| b.exam_date.cmp(&a.exam_date));
            g.truncate(limit);
            if g.is_empty() {
                ToolResult::ok("暂无成绩记录".into())
            } else {
                let lines: Vec<String> = g
                    .iter()
                    .map(|x| {
                        format!(
                            "{} | {}: {:.1}/{:.1}",
                            x.exam_date, x.subject, x.score, x.max_score
                        )
                    })
                    .collect();
                ToolResult::ok(lines.join("\n"))
            }
        }
        Err(e) => ToolResult::err(format!("查询失败: {e}")),
    }
}

async fn rag_query(
    ctx: Arc<RuntimeCtx>,
    args: Value,
    _cancel: CancellationToken,
) -> ToolResult {
    let q = arg_string(&args, "query").trim();
    if q.is_empty() {
        return ToolResult::err("缺少必填参数 query".into());
    }
    let top_k = args
        .get("top_k")
        .and_then(|v| v.as_u64())
        .unwrap_or(3)
        .clamp(1, 10) as usize;
    match ctx.db.list_rag_documents() {
        Ok(docs) => {
            if docs.is_empty() {
                return ToolResult::ok("知识库为空，请先在「知识库」页导入文档。".into());
            }
            // naive substring scoring — good enough for the local RAG use-case
            // since documents are short and queries are educational Chinese.
            let mut scored: Vec<(usize, &str, &str, f32)> = Vec::new();
            for d in &docs {
                for c in &d.chunks {
                    let hits = q
                        .chars()
                        .filter(|ch| c.text.contains(*ch))
                        .count() as f32;
                    let total = q.chars().count().max(1) as f32;
                    let s = hits / total;
                    if s > 0.0 {
                        scored.push((s as usize, &d.title, &c.text, s));
                    }
                }
            }
            scored.sort_by(|a, b| b.3.partial_cmp(&a.3).unwrap_or(std::cmp::Ordering::Equal));
            if scored.is_empty() {
                ToolResult::ok(format!("未找到与「{q}」相关的知识库片段"))
            } else {
                let lines: Vec<String> = scored
                    .iter()
                    .take(top_k)
                    .map(|(hits, title, text, _)| format!("《{title}》[{hits} 命中] {text}"))
                    .collect();
                ToolResult::ok(lines.join("\n---\n"))
            }
        }
        Err(e) => ToolResult::err(format!("知识库查询失败: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_defaults() {
        let r = ToolRegistry::with_defaults();
        let names = r.names();
        // sanity: all 9 built-ins present
        for n in [
            "lookup_student",
            "get_student",
            "get_grades",
            "list_risk_students",
            "count_students",
            "dashboard_summary",
            "search_students",
            "recent_grades",
            "rag_query",
        ] {
            assert!(names.contains(&n), "missing tool: {n}");
        }
    }

    #[test]
    fn unknown_tool_is_not_registered() {
        let r = ToolRegistry::with_defaults();
        assert!(r.get("nope").is_none());
    }
}
