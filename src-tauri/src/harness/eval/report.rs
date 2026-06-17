//! 报告生成 (HTML + JSON)
//!
//! # 设计
//! - `EvalRunReport`: 单次跑批的完整结果 (cases, score 统计, 时间戳, 标签)
//! - `ReportWriter`: 写 HTML (人类阅读) + JSON (机器/上游消费)
//!
//! # HTML 渲染方案
//! 原计划用 askama 模板引擎; 实际采用 `format!` + 简单转义函数实现。
//! 理由:
//! 1. HTML 报告结构简单 (单一页面 + 表格), 模板引擎收益有限
//! 2. 不引入新依赖, 避免 vendored-deps 失效风险
//! 3. 单元测试可独立验证转义/汇总逻辑, 不依赖模板编译
//!
//! 若未来报告复杂度上升 (多页/分页/链接), 可平滑迁移到 askama/tera。

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::harness::eval::dataset::CaseCategory;
use crate::harness::eval::runner::CaseResult;

// =============================================================
// EvalRunReport
// =============================================================

/// 单次跑批的完整报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalRunReport {
    /// Unix epoch seconds
    pub started_at: i64,
    /// Unix epoch seconds
    pub finished_at: i64,
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub pass_rate: f32,
    pub avg_combined_score: f32,
    pub total_cost_usd_micros: u64,
    pub results: Vec<CaseResult>,
}

impl EvalRunReport {
    /// 用 results 重建聚合统计 (供 `run_dataset` 调用, 也可读盘后重新统计)
    pub fn from_results(started_at: i64, finished_at: i64, results: Vec<CaseResult>) -> Self {
        let total = results.len();
        let passed = results.iter().filter(|r| r.passed).count();
        let failed = total - passed;
        let pass_rate = if total == 0 {
            0.0
        } else {
            passed as f32 / total as f32
        };
        let avg_combined_score = if total == 0 {
            0.0
        } else {
            results.iter().map(|r| r.combined_score).sum::<f32>() / total as f32
        };
        let total_cost_usd_micros = results.iter().map(|r| r.trace.cost_usd_micros).sum();
        Self {
            started_at,
            finished_at,
            total,
            passed,
            failed,
            pass_rate,
            avg_combined_score,
            total_cost_usd_micros,
            results,
        }
    }

    /// 跑批是否通过 (按 pass_rate >= 0.8 判定; CI 可在外部调整)
    pub fn is_passing(&self, threshold: f32) -> bool {
        self.pass_rate >= threshold
    }

    /// 跑批耗时 (秒)
    pub fn duration_secs(&self) -> i64 {
        (self.finished_at - self.started_at).max(0)
    }
}

// =============================================================
// ReportWriter
// =============================================================

pub struct ReportWriter;

impl ReportWriter {
    /// 写 JSON 报告 (全量结果 + 汇总, 给 CI artifact / 后续 diff)
    pub fn write_json(report: &EvalRunReport, path: impl AsRef<Path>) -> io::Result<()> {
        let json = serde_json::to_string_pretty(report)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        fs::write(path, json)
    }

    /// 写 HTML 报告 (人类阅读, 单一自包含页面)
    pub fn write_html(report: &EvalRunReport, path: impl AsRef<Path>) -> io::Result<()> {
        let html = render_html(report);
        fs::write(path, html)
    }
}

// =============================================================
// HTML 渲染 (format! + 转义, 无模板引擎)
// =============================================================

fn render_html(report: &EvalRunReport) -> String {
    let mut s = String::with_capacity(8 * 1024);

    // ---- head ----
    s.push_str("<!doctype html>\n<html lang=\"en\"><head>\n");
    s.push_str("<meta charset=\"utf-8\">\n");
    s.push_str(&format!(
        "<title>Eval Report — {ts}</title>\n",
        ts = report.started_at
    ));
    s.push_str("<style>\n");
    s.push_str(HTML_CSS);
    s.push_str("</style>\n</head>\n<body>\n");

    // ---- header ----
    s.push_str("<h1>Evaluation Harness Report</h1>\n");
    s.push_str(&format!(
        "<p class=\"meta\">started={started} • finished={finished} • duration={dur}s</p>\n",
        started = report.started_at,
        finished = report.finished_at,
        dur = report.duration_secs()
    ));

    // ---- summary cards ----
    s.push_str("<section class=\"cards\">\n");
    push_card(&mut s, "Total", &report.total.to_string());
    push_card(&mut s, "Passed", &report.passed.to_string());
    push_card(&mut s, "Failed", &report.failed.to_string());
    push_card(
        &mut s,
        "Pass rate",
        &format!("{:.1}%", report.pass_rate * 100.0),
    );
    push_card(
        &mut s,
        "Avg score",
        &format!("{:.2}", report.avg_combined_score),
    );
    push_card(
        &mut s,
        "Total cost",
        &format!("${:.4}", report.total_cost_usd_micros as f64 / 1_000_000.0),
    );
    s.push_str("</section>\n");

    // ---- per-case table ----
    s.push_str("<h2>Cases</h2>\n<table>\n<thead><tr>");
    s.push_str("<th>Case ID</th><th>Category</th><th>Status</th><th>Combined</th>\
                <th>Scorers</th><th>Judge</th><th>Latency</th><th>Cost</th>");
    s.push_str("</tr></thead>\n<tbody>\n");
    for r in &report.results {
        let status = if r.passed { "✅" } else { "❌" };
        let judge = r
            .judge
            .as_ref()
            .map(|j| format!("{:.2} ({})", j.score, j.judge_model))
            .unwrap_or_else(|| "—".into());
        let scorers = if r.scorers.is_empty() {
            "—".into()
        } else {
            r.scorers
                .iter()
                .map(|s| {
                    let tag = if s.passed { "✓" } else { "✗" };
                    format!("{}:{:.2}", tag, s.score)
                })
                .collect::<Vec<_>>()
                .join(", ")
        };
        s.push_str(&format!(
            "<tr class=\"row-{cls}\"><td>{id}</td><td>{cat:?}</td><td>{st}</td>\
             <td>{score:.2}</td><td>{scorers}</td><td>{judge}</td>\
             <td>{lat}ms</td><td>${cost:.4}</td></tr>\n",
            cls = if r.passed { "pass" } else { "fail" },
            id = esc(&r.case_id),
            cat = r.case_category,
            st = status,
            score = r.combined_score,
            scorers = esc(&scorers),
            judge = esc(&judge),
            lat = r.latency_ms,
            cost = r.trace.cost_usd_micros as f64 / 1_000_000.0,
        ));
    }
    s.push_str("</tbody>\n</table>\n");

    // ---- category breakdown ----
    s.push_str("<h2>By category</h2>\n<table>\n<thead><tr>");
    s.push_str("<th>Category</th><th>Total</th><th>Passed</th><th>Pass rate</th>");
    s.push_str("</tr></thead>\n<tbody>\n");
    let by_cat = category_breakdown(&report.results);
    for (cat, tot, pass) in by_cat {
        let rate = if tot == 0 { 0.0 } else { pass as f32 / tot as f32 };
        s.push_str(&format!(
            "<tr><td>{cat:?}</td><td>{tot}</td><td>{pass}</td><td>{pct:.1}%</td></tr>\n",
            pct = rate * 100.0
        ));
    }
    s.push_str("</tbody>\n</table>\n");

    s.push_str("</body></html>\n");
    s
}

fn push_card(s: &mut String, label: &str, value: &str) {
    s.push_str(&format!(
        "<div class=\"card\"><div class=\"card-label\">{lbl}</div>\
         <div class=\"card-value\">{val}</div></div>\n",
        lbl = esc(label),
        val = esc(value)
    ));
}

fn category_breakdown(results: &[CaseResult]) -> Vec<(CaseCategory, usize, usize)> {
    let mut out: Vec<(CaseCategory, usize, usize)> = Vec::new();
    let cats = [
        CaseCategory::Safety,
        CaseCategory::TaskCompletion,
        CaseCategory::Privacy,
        CaseCategory::ToolCorrectness,
    ];
    for c in &cats {
        let total = results.iter().filter(|r| &r.case_category == c).count();
        let passed = results
            .iter()
            .filter(|r| &r.case_category == c && r.passed)
            .count();
        out.push((*c, total, passed));
    }
    out
}

/// HTML 转义: 防止 case_id/prompt 中的 `&`、`<`、`>` 破坏页面
fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
    out
}

const HTML_CSS: &str = r#"
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
       margin: 2em; color: #222; max-width: 1100px; }
h1 { margin-bottom: 0.2em; }
.meta { color: #666; font-size: 0.9em; margin-top: 0; }
.cards { display: flex; gap: 1em; flex-wrap: wrap; margin: 1.5em 0; }
.card { background: #f5f5f7; border-radius: 8px; padding: 1em 1.4em;
        min-width: 110px; }
.card-label { font-size: 0.8em; color: #666; text-transform: uppercase; }
.card-value { font-size: 1.6em; font-weight: 600; margin-top: 0.2em; }
table { width: 100%; border-collapse: collapse; margin: 1em 0; }
th, td { padding: 0.5em 0.7em; text-align: left; border-bottom: 1px solid #eee; }
th { background: #fafafa; font-weight: 600; }
.row-pass td { background: #f0fdf4; }
.row-fail td { background: #fef2f2; }
"#;

// =============================================================
// 单元测试
// =============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::agent::trace::{RunTrace, TraceToolCall};
    use crate::harness::eval::scorer::ScorerResult;
    use serde_json::json;

    fn trace_pass() -> RunTrace {
        RunTrace {
            case_id: "c1".into(),
            final_text: "ok".into(),
            tool_calls: vec![TraceToolCall {
                name: "add_event".into(),
                args: json!({}),
                result: Some(json!({"eventId": "e1"})),
                is_write: true,
                risk: "low".into(),
                status: "executed".into(),
                error: None,
            }],
            rounds: 1,
            input_tokens: 10,
            output_tokens: 5,
            cost_usd_micros: 100_000, // $0.0001
            status: "success".into(),
            error: None,
            latency_ms: 50,
        }
    }

    fn trace_fail() -> RunTrace {
        RunTrace {
            final_text: "leaked [PII_1]".into(),
            status: "success".into(),
            cost_usd_micros: 200_000,
            latency_ms: 80,
            ..trace_pass()
        }
    }

    fn result_pass() -> CaseResult {
        CaseResult {
            case_id: "c1".into(),
            case_category: CaseCategory::TaskCompletion,
            scorers: vec![ScorerResult::pass("pii", 1.0, vec![])],
            judge: None,
            combined_score: 1.0,
            passed: true,
            trace: trace_pass(),
            latency_ms: 50,
        }
    }

    fn result_fail() -> CaseResult {
        CaseResult {
            case_id: "c2".into(),
            case_category: CaseCategory::Privacy,
            scorers: vec![ScorerResult::fail("pii", "PII token leaked".into())],
            judge: None,
            combined_score: 0.0,
            passed: false,
            trace: trace_fail(),
            latency_ms: 80,
        }
    }

    #[test]
    fn from_results_aggregates_correctly() {
        let r = EvalRunReport::from_results(0, 10, vec![result_pass(), result_fail()]);
        assert_eq!(r.total, 2);
        assert_eq!(r.passed, 1);
        assert_eq!(r.failed, 1);
        assert!((r.pass_rate - 0.5).abs() < 0.001);
        assert!((r.avg_combined_score - 0.5).abs() < 0.001);
        assert_eq!(r.total_cost_usd_micros, 300_000);
        assert_eq!(r.duration_secs(), 10);
    }

    #[test]
    fn from_results_empty() {
        let r = EvalRunReport::from_results(0, 0, vec![]);
        assert_eq!(r.total, 0);
        assert_eq!(r.pass_rate, 0.0);
        assert_eq!(r.avg_combined_score, 0.0);
    }

    #[test]
    fn is_passing_uses_threshold() {
        // 单个 pass case: pass_rate = 1.0, 通过任何 threshold ≤ 1.0
        let r = EvalRunReport::from_results(0, 0, vec![result_pass()]);
        assert!(r.is_passing(0.5));
        assert!(r.is_passing(1.0));
        assert!(!r.is_passing(1.5));
    }

    #[test]
    fn write_json_roundtrip() {
        let report = EvalRunReport::from_results(0, 1, vec![result_pass()]);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("r.json");
        ReportWriter::write_json(&report, &path).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        let restored: EvalRunReport = serde_json::from_str(&raw).unwrap();
        assert_eq!(restored.total, 1);
        assert_eq!(restored.passed, 1);
        assert!((restored.pass_rate - 1.0).abs() < 0.001);
    }

    #[test]
    fn write_html_contains_key_sections() {
        let report = EvalRunReport::from_results(0, 5, vec![result_pass(), result_fail()]);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("r.html");
        ReportWriter::write_html(&report, &path).unwrap();
        let html = fs::read_to_string(&path).unwrap();
        assert!(html.contains("<title>Eval Report"));
        assert!(html.contains("Pass rate"));
        assert!(html.contains("c1"));
        assert!(html.contains("c2"));
        assert!(html.contains("row-pass"));
        assert!(html.contains("row-fail"));
        assert!(html.contains("By category"));
    }

    #[test]
    fn html_escapes_special_chars() {
        assert_eq!(esc("a&b"), "a&amp;b");
        assert_eq!(esc("<x>"), "&lt;x&gt;");
        assert_eq!(esc("\"q\""), "&quot;q&quot;");
        assert_eq!(esc("it's"), "it&#39;s");
        // 无特殊字符保持不变
        assert_eq!(esc("hello world"), "hello world");
    }
}
