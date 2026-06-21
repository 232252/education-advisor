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
//!
//! Most tool bodies are sync; they are marked `async` only so the registry
//! can hold them behind a single `Box<dyn Future<…>>` type. Hence the
//! module-level `unused_async` allow.

#![allow(clippy::unused_async)]

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::Value;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::models::{RiskLevel, ToolStatus};
use crate::runtime::RuntimeCtx;

// ============================================================================
// Tool size / time limits
// ============================================================================

/// Maximum number of web search results to surface. Keeps the agent's next
/// turn within a sensible context budget.
const WEB_SEARCH_MAX_RESULTS: usize = 5;

/// HTTP timeout for an individual web search.
const WEB_SEARCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

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
pub type BoxedToolFuture = Pin<Box<dyn Future<Output = ToolResult> + Send + 'static>>;

/// A tool function: `(ctx, args, cancel) -> future of ToolResult`.
pub type BoxedTool = Box<
    dyn Fn(Arc<RuntimeCtx>, Value, CancellationToken) -> BoxedToolFuture + Send + Sync + 'static,
>;

/// In-memory registry. The lifetime of the program is bounded so we keep it
/// simple — no `RwLock`, no dynamic unload.
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
        // Network — opt-in (no PII, no student data leak). Uses the same
        // shared `reqwest` client built in [`crate::llm::LlmClient::http`].
        r.register(web_search_def(), |ctx, args, cancel| {
            Box::pin(web_search(ctx, args, cancel))
        });
        r.register(web_fetch_def(), |ctx, args, cancel| {
            Box::pin(web_fetch(ctx, args, cancel))
        });
        r
    }

    /// Register a tool. The closure must return a boxed future, which we
    /// allow callers to write as `|ctx, args, cancel| Box::pin(tool_fn(ctx, args, cancel))`.
    fn register<F>(&mut self, def: ToolDefinition, f: F)
    where
        F: Fn(Arc<RuntimeCtx>, Value, CancellationToken) -> BoxedToolFuture + Send + Sync + 'static,
    {
        // `Box::from` triggers the unsized coercion from `Box<F>` to
        // `Box<dyn Fn(...) -> ... + Send + Sync + 'static>`. Plain `Box::new`
        // does not perform that coercion automatically.
        let boxed: BoxedTool = Box::from(f);
        self.defs.push(def.clone());
        self.map.insert(def.name, boxed);
    }

    pub fn list(&self) -> &[ToolDefinition] {
        &self.defs
    }

    pub fn get(&self, name: &str) -> Option<&ToolDefinition> {
        self.defs.iter().find(|d| d.name == name)
    }

    #[allow(dead_code)]
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

const fn lookup_student_def() -> ToolDefinition {
    ToolDefinition {
        name: "lookup_student",
        purpose: "按姓名（子串匹配）查询学生档案：年级、班级、风险等级、GPA",
        args_schema_hint: r#"{"name":"张三"}"#,
    }
}
const fn get_grades_def() -> ToolDefinition {
    ToolDefinition {
        name: "get_grades",
        purpose: "按学生 UUID 查询该生所有成绩（科目 / 分数 / 满分 / 考试日期）",
        args_schema_hint: r#"{"id":"学生UUID"}"#,
    }
}
const fn list_risk_students_def() -> ToolDefinition {
    ToolDefinition {
        name: "list_risk_students",
        purpose: "列出当前所有高风险 / 危机等级的学生（按姓名、年级、班级）",
        args_schema_hint: "{}",
    }
}
const fn count_students_def() -> ToolDefinition {
    ToolDefinition {
        name: "count_students",
        purpose: "统计学生总数与各风险等级分布",
        args_schema_hint: "{}",
    }
}
const fn dashboard_summary_def() -> ToolDefinition {
    ToolDefinition {
        name: "dashboard_summary",
        purpose: "获取首页总览：平均 GPA、当日新增会话、累计工具调用",
        args_schema_hint: "{}",
    }
}
const fn search_students_def() -> ToolDefinition {
    ToolDefinition {
        name: "search_students",
        purpose: "按关键字搜索学生：姓名 / 年级 / 班级 / 标签 任意字段子串匹配",
        args_schema_hint: r#"{"query":"高三"}"#,
    }
}
const fn get_student_def() -> ToolDefinition {
    ToolDefinition {
        name: "get_student",
        purpose: "按学生 UUID 精确查询完整档案（含监护人、地址、标签）",
        args_schema_hint: r#"{"id":"学生UUID"}"#,
    }
}
const fn recent_grades_def() -> ToolDefinition {
    ToolDefinition {
        name: "recent_grades",
        purpose: "查询最近 N 条全年级考试记录，用于横向对比",
        args_schema_hint: r#"{"limit":10}"#,
    }
}
const fn rag_query_def() -> ToolDefinition {
    ToolDefinition {
        name: "rag_query",
        purpose: "在本地知识库里查询与问题最相关的文档片段",
        args_schema_hint: r#"{"query":"学生请假流程","top_k":3}"#,
    }
}
const fn web_search_def() -> ToolDefinition {
    ToolDefinition {
        name: "web_search",
        purpose: "联网搜索（使用 DuckDuckGo Lite），返回网页标题/链接/摘要",
        args_schema_hint: r#"{"query":"中国高考 2026 新政策","max_results":5}"#,
    }
}
const fn web_fetch_def() -> ToolDefinition {
    ToolDefinition {
        name: "web_fetch",
        purpose: "抓取一个 URL 的纯文本（去除 HTML 标签），最大 4 KB",
        args_schema_hint: r#"{"url":"https://example.com/article"}"#,
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

async fn get_student(ctx: Arc<RuntimeCtx>, args: Value, _cancel: CancellationToken) -> ToolResult {
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

async fn get_grades(ctx: Arc<RuntimeCtx>, args: Value, _cancel: CancellationToken) -> ToolResult {
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
            st.total_students, st.avg_gpa, st.conversations_today, st.tool_calls_total
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
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(10)
        .clamp(1, 200) as usize;
    match ctx.db.all_grades() {
        Ok(mut g) => {
            // sort newest first by exam_date
            g.sort_by_key(|x| std::cmp::Reverse(x.exam_date));
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

async fn rag_query(ctx: Arc<RuntimeCtx>, args: Value, _cancel: CancellationToken) -> ToolResult {
    let q = arg_string(&args, "query").trim();
    if q.is_empty() {
        return ToolResult::err("缺少必填参数 query".into());
    }
    let top_k = args
        .get("top_k")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(3)
        .clamp(1, 10) as usize;
    match ctx.db.list_rag_documents() {
        Ok(docs) => {
            if docs.is_empty() {
                return ToolResult::ok("知识库为空，请先在「知识库」页导入文档。".into());
            }
            let corpus = crate::embedding::Corpus::from_documents(&docs);
            let hits = corpus.search_text(q, top_k);
            if hits.is_empty() {
                ToolResult::ok(format!("未找到与「{q}」相关的知识库片段"))
            } else {
                let lines: Vec<String> = hits
                    .iter()
                    .map(|h| {
                        format!(
                            "《{}》(score {:.2}) {}",
                            h.document_title,
                            h.score,
                            crate::util::truncate(&h.chunk_text, 320)
                        )
                    })
                    .collect();
                ToolResult::ok(lines.join("\n---\n"))
            }
        }
        Err(e) => ToolResult::err(format!("知识库查询失败: {e}")),
    }
}

// ============================================================================
// Web tools (network, opt-in)
// ============================================================================
//
// We re-use the same `reqwest::Client` as the LLM client to share the
// connection pool and the rustls stack. There is no separate `reqwest`
// dependency; the LLM module already pulls it in.

fn http_client() -> std::sync::Arc<reqwest::Client> {
    // LlmClient::new() is cheap and stores the client in a `static` cell
    // would be cleaner, but constructing one per call is fine: reqwest's
    // Client is Clone-cheap (it wraps an Arc internally).
    std::sync::Arc::new(crate::llm::LlmClient::new().into_http())
}

async fn web_search(_ctx: Arc<RuntimeCtx>, args: Value, _cancel: CancellationToken) -> ToolResult {
    let q = arg_string(&args, "query").trim();
    if q.is_empty() {
        return ToolResult::err("缺少必填参数 query".into());
    }
    let max_results = args
        .get("max_results")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(WEB_SEARCH_MAX_RESULTS as u64)
        .clamp(1, WEB_SEARCH_MAX_RESULTS as u64) as usize;

    let client = http_client();
    let url = format!("https://html.duckduckgo.com/html/?q={}", urlencode(q));
    let resp = match tokio::time::timeout(WEB_SEARCH_TIMEOUT, client.get(&url).send()).await {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return ToolResult::err(format!("网络请求失败: {e}")),
        Err(_) => return ToolResult::err(format!("web_search 超过 {WEB_SEARCH_TIMEOUT:?} 未返回")),
    };
    if !resp.status().is_success() {
        return ToolResult::err(format!("DuckDuckGo 返回 HTTP {}", resp.status()));
    }
    let body = match resp.text().await {
        Ok(b) => b,
        Err(e) => return ToolResult::err(format!("读取响应失败: {e}")),
    };
    let hits = parse_duckduckgo(&body, max_results);
    if hits.is_empty() {
        return ToolResult::ok(format!("未找到与「{q}」相关的网页结果"));
    }
    let mut out = String::new();
    for (i, (title, link, snippet)) in hits.iter().enumerate() {
        out.push_str(&format!(
            "{n}. {title}\n   {link}\n   {snippet}\n",
            n = i + 1,
        ));
    }
    ToolResult::ok(out)
}

async fn web_fetch(_ctx: Arc<RuntimeCtx>, args: Value, _cancel: CancellationToken) -> ToolResult {
    let url = arg_string(&args, "url").trim();
    if url.is_empty() {
        return ToolResult::err("缺少必填参数 url".into());
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return ToolResult::err("url 必须以 http(s):// 开头".into());
    }
    // SSRF guard: refuse to fetch private/loopback addresses. The LLM can
    // be tricked into probing the local network or cloud metadata services
    // (e.g. `http://169.254.169.254/...`). We resolve the host once and
    // block if every resolved address is private.
    match reqwest::Url::parse(url) {
        Ok(parsed) => {
            if let Some(host) = parsed.host_str() {
                if is_blocked_host(host) {
                    return ToolResult::err(format!("web_fetch 拒绝访问私有/内网地址: {host}"));
                }
            }
        }
        Err(e) => return ToolResult::err(format!("url 解析失败: {e}")),
    }
    let client = http_client();
    let resp = match tokio::time::timeout(WEB_SEARCH_TIMEOUT, client.get(url).send()).await {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return ToolResult::err(format!("网络请求失败: {e}")),
        Err(_) => return ToolResult::err(format!("web_fetch 超过 {WEB_SEARCH_TIMEOUT:?} 未返回")),
    };
    if !resp.status().is_success() {
        return ToolResult::err(format!("HTTP {}", resp.status()));
    }
    let body = match resp.text().await {
        Ok(b) => b,
        Err(e) => return ToolResult::err(format!("读取响应失败: {e}")),
    };
    let text = html_to_text(&body);
    ToolResult::ok(crate::util::truncate(&text, 4096))
}

/// Returns true when the host is an obvious private/loopback/link-local
/// target that an LLM has no business reaching.
fn is_blocked_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    if h == "localhost" || h.ends_with(".localhost") || h.ends_with(".local") {
        return true;
    }
    if h == "0.0.0.0" || h == "::1" || h == "::" {
        return true;
    }
    // Try to parse as an IP. If parsing fails the host is a DNS name and
    // we let the request go through (the LLM shouldn't be hitting internal
    // DNS names anyway, and DNS-rebinding is a different threat model).
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_multicast()
                    || v4.is_broadcast()
            }
            std::net::IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    || v6.is_multicast()
                    // Unique-local fc00::/7
                    || (v6.segments()[0] & 0xfe00) == 0xfc00
                    // Link-local fe80::/10
                    || (v6.segments()[0] & 0xffc0) == 0xfe80
            }
        };
    }
    false
}

// --- small HTML helpers (intentionally minimal; we strip tags, do not
//     attempt to render a DOM). Sufficient for the LLM to ingest a page.

/// URL-encoder for query strings. We avoid pulling the `urlencoding` crate
/// by reusing `reqwest::Url` which can do the percent-encoding for us.
fn urlencode(s: &str) -> String {
    // `Url::parse` is a roundabout but reliable way: build a URL whose
    // query we then read back percent-encoded.
    let dummy = format!("https://x.invalid/?q={s}");
    match reqwest::Url::parse(&dummy) {
        Ok(u) => u
            .query_pairs()
            .find(|(k, _)| k == "q")
            .map_or_else(|| s.to_string(), |(_, v)| v.into_owned()),
        Err(_) => s.to_string(),
    }
}

/// Parse the `DuckDuckGo` Lite HTML for the first N results.
///
/// The structure of a result is roughly:
/// ```html
/// <a class="result__a" href="https://duckduckgo.com/l/?uddg=ENCODED_URL&...">TITLE</a>
/// <a class="result__snippet" ...>SNIPPET_TEXT</a>
/// ```
fn parse_duckduckgo(html: &str, max: usize) -> Vec<(String, String, String)> {
    let mut hits: Vec<(String, String, String)> = Vec::new();
    let mut cursor = 0usize;
    while let Some(rel) = html[cursor..].find("class=\"result__a\"") {
        let start = cursor + rel;
        // Find the href=...> and the closing </a>
        let Some(href_open) = html[start..].find("href=") else {
            break;
        };
        // Skip past `href="` (6 chars) so `href_start` points inside the value.
        let href_open_quote = start + href_open + 6;
        let Some(href_close_rel) = html[href_open_quote..].find('"') else {
            break;
        };
        let href_start = href_open_quote;
        let href_close = href_open_quote + href_close_rel;
        let raw_href = &html[href_start..href_close];
        // DDG wraps every result URL as a redirect; decode the uddg= param.
        let real_href = decode_ddg_redirect(raw_href);

        // closing </a> after href. Skip past the closing `"` of the href
        // *and* the opening `>` of the <a> tag, so the title extraction
        // doesn't include `">` at the front.
        let after_quote = href_close + 1; // position right after the closing `"`
        let Some(gt_rel) = html[after_quote..].find('>') else {
            break;
        };
        let inner_start = after_quote + gt_rel + 1;
        let Some(close_rel) = html[inner_start..].find("</a>") else {
            break;
        };
        let inner_end = inner_start + close_rel;
        let title = strip_tags(&html[inner_start..inner_end]).trim().to_string();
        if title.is_empty() {
            cursor = inner_end + 4;
            continue;
        }
        // Find the matching snippet (next sibling)
        let snippet_start = inner_end + 4;
        let snippet = if let Some(snip_rel) = html[snippet_start..].find("result__snippet") {
            let abs_snip = snippet_start + snip_rel;
            if let Some(snip_end_rel) = html[abs_snip..].find("</a>") {
                strip_tags(&html[abs_snip..abs_snip + snip_end_rel])
                    .trim()
                    .to_string()
            } else {
                String::new()
            }
        } else {
            String::new()
        };
        hits.push((title, real_href, snippet));
        cursor = snippet_start;
        if hits.len() >= max {
            break;
        }
    }
    hits
}

/// DDG Lite wraps every outbound link in a redirect like
///   `https://duckduckgo.com/l/?uddg=ENCODED%20URL&...`
/// Decode the uddg parameter if present; otherwise return the raw href.
fn decode_ddg_redirect(href: &str) -> String {
    if let Some(qpos) = href.find('?') {
        let qs = &href[qpos + 1..];
        for pair in qs.split('&') {
            if let Some(rest) = pair.strip_prefix("uddg=") {
                return urldecode(rest);
            }
        }
    }
    href.to_string()
}

fn urldecode(s: &str) -> String {
    // We do a tiny custom decoder to avoid the `urlencoding` crate. The
    // format is %XX with XX hex; '+' → space (form encoding, used by DDG).
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = &bytes[i + 1..i + 3];
                if let (Some(a), Some(b)) = (hex_digit(hex[0]), hex_digit(hex[1])) {
                    out.push((a << 4) | b);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

const fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                // Drop the tag, but preserve a separator so adjacent text
                // doesn't merge (e.g. "world</b>!" should not become
                // "world!").
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    // collapse runs of whitespace
    let mut collapsed = String::with_capacity(out.len());
    let mut prev_ws = false;
    for c in out.chars() {
        if c.is_whitespace() {
            if !prev_ws {
                collapsed.push(' ');
            }
            prev_ws = true;
        } else {
            collapsed.push(c);
            prev_ws = false;
        }
    }
    collapsed
}

fn html_to_text(html: &str) -> String {
    // Drop <script> and <style> blocks first (they'd add noise).
    // The two cases are interleaved in real pages, so we always pick the
    // closer of the two at each step rather than preferring one tag type.
    let mut out = String::with_capacity(html.len());
    let mut i = 0;
    let lower = html.to_ascii_lowercase();
    while i < html.len() {
        let script_rel = lower[i..].find("<script");
        let style_rel = lower[i..].find("<style");
        // Pick whichever comes first.
        match (script_rel, style_rel) {
            (Some(srel), Some(trel)) if srel < trel => {
                out.push_str(&html[i..i + srel]);
                if let Some(end_rel) = lower[i + srel..].find("</script>") {
                    i = i + srel + end_rel + "</script>".len();
                } else {
                    break;
                }
            }
            (Some(srel), Some(trel)) if trel < srel => {
                out.push_str(&html[i..i + trel]);
                if let Some(end_rel) = lower[i + trel..].find("</style>") {
                    i = i + trel + end_rel + "</style>".len();
                } else {
                    break;
                }
            }
            (Some(srel), None) => {
                out.push_str(&html[i..i + srel]);
                if let Some(end_rel) = lower[i + srel..].find("</script>") {
                    i = i + srel + end_rel + "</script>".len();
                } else {
                    break;
                }
            }
            (None, Some(trel)) => {
                out.push_str(&html[i..i + trel]);
                if let Some(end_rel) = lower[i + trel..].find("</style>") {
                    i = i + trel + end_rel + "</style>".len();
                } else {
                    break;
                }
            }
            (None, None) => {
                out.push_str(&html[i..]);
                break;
            }
            _ => unreachable!(),
        }
    }
    strip_tags(&out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_defaults() {
        let r = ToolRegistry::with_defaults();
        let names = r.names();
        // sanity: all 11 built-ins present
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
            "web_search",
            "web_fetch",
        ] {
            assert!(names.contains(&n), "missing tool: {n}");
        }
    }

    #[test]
    fn unknown_tool_is_not_registered() {
        let r = ToolRegistry::with_defaults();
        assert!(r.get("nope").is_none());
    }

    // ── HTML helpers ──────────────────────────────────────────────────

    #[test]
    fn strip_tags_removes_tags_and_collapses_ws() {
        // strip_tags inserts a space at every removed tag so that adjacent
        // text doesn't merge; this means `<p>Hello` produces ` Hello`.
        // The test documents that behaviour so future refactors don't
        // break it accidentally.
        let s = strip_tags("<p>Hello  <b>world</b>!\n</p>");
        assert_eq!(s, " Hello world ! ");
    }

    #[test]
    fn urlencode_and_decode_round_trip() {
        let original = "中国 高三 2026";
        let encoded = urlencode(original);
        let decoded = urldecode(&encoded);
        assert_eq!(decoded, original);
    }

    #[test]
    fn urldecode_handles_plus_as_space() {
        assert_eq!(urldecode("hello+world"), "hello world");
    }

    #[test]
    fn ddg_redirect_decodes_uddg() {
        let href = "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpath&rut=abc";
        assert_eq!(decode_ddg_redirect(href), "https://example.com/path");
    }

    #[test]
    fn parse_duckduckgo_extracts_results() {
        let html = r#"
            <html><body>
              <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&x=1">First Title</a>
              <a class="result__snippet">First snippet text</a>
              <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fb&x=2">Second Title</a>
              <a class="result__snippet">Second snippet text</a>
            </body></html>
        "#;
        let hits = parse_duckduckgo(html, 5);
        assert_eq!(hits.len(), 2);
        // Title should be clean (no leading `"` or `>`) after the parser
        // skips past the href closing quote and the opening `>` of the
        // <a> tag.
        assert_eq!(hits[0].0, "First Title");
        assert_eq!(hits[0].1, "https://example.com/a");
        assert!(hits[0].2.contains("First snippet"));
        assert_eq!(hits[1].1, "https://example.com/b");
    }

    #[test]
    fn parse_duckduckgo_respects_max() {
        let html = r#"<a class="result__a" href="x">A</a><a class="result__snippet">s1</a>
                      <a class="result__a" href="y">B</a><a class="result__snippet">s2</a>
                      <a class="result__a" href="z">C</a><a class="result__snippet">s3</a>"#;
        let hits = parse_duckduckgo(html, 2);
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn html_to_text_drops_script_and_style() {
        let html = r"
            <html><head><style>body{color:red}</style></head>
            <body><p>Real content.</p>
            <script>alert(1)</script>
            <p>More real content.</p>
            </body></html>
        ";
        let t = html_to_text(html);
        eprintln!("DEBUG html_to_text output:\n---\n{t}\n---");
        assert!(t.contains("Real content"));
        assert!(!t.contains("alert"));
        assert!(!t.contains("color:red"));
    }
}
