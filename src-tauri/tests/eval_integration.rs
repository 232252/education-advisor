//! Evaluation Harness 集成测试 (阶段四 Round 7)
//!
//! 覆盖点:
//! 1. 真实加载 `eval/datasets/*.jsonl` 4 个数据集 (12 个 case)
//! 2. 用 `StubTraceProvider` 跑全部 case, 收集 `EvalRunReport`
//! 3. `ReportWriter::write_json` roundtrip (写盘 → 读回 → 字段一致)
//! 4. `ReportWriter::write_html` 包含关键 section
//! 5. `is_passing` 阈值门正确
//! 6. `aggregate` 公式: scorer*0.5 + judge*0.5
//!
//! 不覆盖 (留到阶段五+ / CI):
//! - 真实 LlmJudgeClient (需要 API key)
//! - AgentRunTraceProvider (需要 AppHandle)
//! - CLI `eval-runner` 二进制 (需要子进程 + JSONL 解析)

use std::path::PathBuf;
use std::sync::Arc;

use ea_tauri::harness::eval::dataset::{CaseCategory, Dataset};
use ea_tauri::harness::eval::judge::{Judge, JudgeClient, JudgeVerdict, StubJudgeClient};
use ea_tauri::harness::eval::report::ReportWriter;
use ea_tauri::harness::agent::trace::{RunTrace, TraceToolCall};
use ea_tauri::harness::eval::runner::{EvalRunner, StubTraceProvider};
use ea_tauri::harness::eval::scorer::{
    BudgetScorer, PiiLeakScorer, SchemaValidatorScorer, Scorer, ToolCallMatchScorer,
};
use serde_json::json;

fn datasets_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("eval")
        .join("datasets")
}

fn load_all() -> Dataset {
    let dir = datasets_dir();
    let mut ds = Dataset::default();
    for entry in std::fs::read_dir(&dir).expect("datasets dir exists") {
        let p = entry.unwrap().path();
        if p.extension().and_then(|s| s.to_str()) == Some("jsonl") {
            let part = Dataset::load(&p).expect("dataset parses");
            ds = Dataset::merge(vec![ds, part]);
        }
    }
    ds
}

fn stub_pass_trace() -> RunTrace {
    RunTrace {
        case_id: "stub".into(),
        final_text: "ok answer".into(),
        tool_calls: vec![],
        rounds: 1,
        input_tokens: 50,
        output_tokens: 20,
        cost_usd_micros: 100_000,
        status: "success".into(),
        error: None,
        latency_ms: 10,
    }
}

fn stub_pii_trace() -> RunTrace {
    RunTrace {
        case_id: "stub".into(),
        final_text: "leaked [PII_NAME_1]".into(),
        tool_calls: vec![],
        rounds: 1,
        input_tokens: 50,
        output_tokens: 20,
        cost_usd_micros: 100_000,
        status: "success".into(),
        error: None,
        latency_ms: 10,
    }
}

fn stub_tool_trace() -> RunTrace {
    RunTrace {
        case_id: "stub".into(),
        final_text: "done".into(),
        tool_calls: vec![TraceToolCall {
            name: "get_student".into(),
            args: json!({"id": "student_1"}),
            result: Some(json!({"id": "student_1", "name": "小明"})),
            is_write: false,
            risk: "low".into(),
            status: "executed".into(),
            error: None,
        }],
        rounds: 2,
        input_tokens: 80,
        output_tokens: 40,
        cost_usd_micros: 200_000,
        status: "success".into(),
        error: None,
        latency_ms: 25,
    }
}

// =============================================================
// 1. 数据集加载
// =============================================================

#[test]
fn loads_all_four_datasets() {
    let ds = load_all();
    assert_eq!(ds.len(), 12, "expected 3+3+3+3 = 12 cases");
    let count_of = |c: CaseCategory| ds.cases.iter().filter(|x| x.category == c).count();
    assert_eq!(count_of(CaseCategory::Safety), 3);
    assert_eq!(count_of(CaseCategory::Privacy), 3);
    assert_eq!(count_of(CaseCategory::ToolCorrectness), 3);
    assert_eq!(count_of(CaseCategory::TaskCompletion), 3);
}

#[test]
fn datasets_have_unique_ids() {
    let ds = load_all();
    let mut ids: Vec<&str> = ds.cases.iter().map(|c| c.id.as_str()).collect();
    ids.sort();
    let original_len = ids.len();
    ids.dedup();
    assert_eq!(ids.len(), original_len, "duplicate ids detected");
}

// =============================================================
// 2. EvalRunner 集成 — 全部 pass trace
// =============================================================

#[tokio::test]
async fn runner_with_clean_traces_and_pii_scorer_all_pass() {
    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_pass_trace())))
        .with_scorer(Arc::new(PiiLeakScorer));

    let ds = load_all();
    let report = runner.run_dataset(ds.cases.to_vec()).await;

    // 12 cases, none leak PII, all pass
    assert_eq!(report.total, 12);
    assert_eq!(report.passed, 12);
    assert_eq!(report.failed, 0);
    assert!((report.pass_rate - 1.0).abs() < 0.001);
    assert!(report.is_passing(0.8));
}

#[tokio::test]
async fn runner_with_pii_traces_blocks_privacy_cases() {
    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_pii_trace())))
        .with_scorer(Arc::new(PiiLeakScorer));

    let ds = load_all();
    let report = runner.run_dataset(ds.cases.to_vec()).await;

    // PiiLeakScorer 适用所有 category → 全部 fail
    // (Scorer.applies 对所有 case 都返回 true)
    let privacy_fails: usize = report
        .results
        .iter()
        .filter(|r| r.case_category == CaseCategory::Privacy && !r.passed)
        .count();
    assert_eq!(privacy_fails, 3, "all 3 privacy cases should fail");
}

// =============================================================
// 3. ToolCallMatchScorer 只对 ToolCorrectness 适用
// =============================================================

#[tokio::test]
async fn tool_call_scorer_only_applies_to_tool_correctness() {
    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_tool_trace())))
        .with_scorer(Arc::new(ToolCallMatchScorer));

    let ds = load_all();
    let report = runner.run_dataset(ds.cases.to_vec()).await;

    for r in &report.results {
        let has_scorer = !r.scorers.is_empty();
        let expected = r.case_category == CaseCategory::ToolCorrectness;
        assert_eq!(
            has_scorer, expected,
            "case {} expected scorer={} got={}",
            r.case_id, expected, has_scorer
        );
    }
}

// =============================================================
// 4. BudgetScorer 不超预算
// =============================================================

#[tokio::test]
async fn budget_scorer_passes_for_cheap_traces() {
    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_pass_trace())))
        .with_scorer(Arc::new(BudgetScorer));

    let ds = load_all();
    let report = runner.run_dataset(ds.cases.to_vec()).await;
    assert_eq!(report.passed, 12);
}

// =============================================================
// 5. SchemaValidatorScorer 跳过 (无 expected_tool_calls 必填字段)
// =============================================================

#[test]
fn schema_validator_only_applies_to_write_categories() {
    // SchemaValidatorScorer 适用 TaskCompletion + ToolCorrectness, 不适用 Safety / Privacy
    let scorer = SchemaValidatorScorer;
    let ds = load_all();
    for case in &ds.cases {
        let expected = matches!(
            case.category,
            CaseCategory::TaskCompletion | CaseCategory::ToolCorrectness
        );
        assert_eq!(
            scorer.applies(case),
            expected,
            "case {} category={:?}",
            case.id,
            case.category
        );
    }
}

// =============================================================
// 6. Report 写出 + 读回
// =============================================================

#[tokio::test]
async fn report_writes_json_and_html() {
    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_pass_trace())))
        .with_scorer(Arc::new(PiiLeakScorer));
    let ds = load_all();
    let report = runner.run_dataset(ds.cases.to_vec()).await;

    let dir = tempfile::tempdir().unwrap();
    let json_path = dir.path().join("report.json");
    let html_path = dir.path().join("report.html");

    ReportWriter::write_json(&report, &json_path).unwrap();
    ReportWriter::write_html(&report, &html_path).unwrap();

    // JSON roundtrip
    let raw = std::fs::read_to_string(&json_path).unwrap();
    let restored: ea_tauri::harness::eval::report::EvalRunReport =
        serde_json::from_str(&raw).unwrap();
    assert_eq!(restored.total, report.total);
    assert_eq!(restored.passed, report.passed);

    // HTML 包含关键 section
    let html = std::fs::read_to_string(&html_path).unwrap();
    assert!(html.contains("<title>Eval Report"));
    assert!(html.contains("Pass rate"));
    assert!(html.contains("By category"));
    assert!(html.len() > 1000, "HTML should be substantial");
}

// =============================================================
// 7. Judge 集成 — StubJudgeClient 返回固定 verdict
// =============================================================

struct StaticJudgeClient(String);

#[async_trait::async_trait]
impl ea_tauri::harness::eval::judge::JudgeClient for StaticJudgeClient {
    async fn chat(&self, _system: &str, _user: &str, _max: u64) -> Result<String, String> {
        Ok(self.0.clone())
    }
}

#[tokio::test]
async fn judge_with_static_stub_full_pipeline() {
    use ea_tauri::harness::eval::judge::LlmJudge;
    let judge: Arc<dyn Judge> = Arc::new(LlmJudge::new(
        Box::new(StaticJudgeClient(
            r#"{"score": 0.9, "passed": true, "reasoning": "good"}"#.into(),
        )),
        "static-stub",
    ));

    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_pass_trace())))
        .with_scorer(Arc::new(PiiLeakScorer))
        .with_judge(judge);

    let ds = load_all();
    let report = runner.run_dataset(ds.cases.to_vec()).await;
    assert_eq!(report.passed, 12);
    // combined = scorer_mean(1.0)*0.5 + judge(0.9)*0.5 = 0.95
    for r in &report.results {
        assert!(
            (r.combined_score - 0.95).abs() < 0.001,
            "case {} combined_score={}",
            r.case_id,
            r.combined_score
        );
        assert!(r.judge.is_some());
    }
}

// =============================================================
// 8. 端到端 shape 验证 (单个 case 的 CaseResult 字段完整性)
// =============================================================

#[tokio::test]
async fn case_result_has_all_required_fields() {
    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_pass_trace())))
        .with_scorer(Arc::new(PiiLeakScorer));
    let case = Dataset::load(&datasets_dir().join("task_completion.jsonl"))
        .unwrap()
        .cases
        .first()
        .unwrap()
        .clone();
    let r = runner.run_case(&case).await;
    assert!(!r.case_id.is_empty());
    assert_eq!(r.scorers.len(), 1);
    assert!(r.judge.is_none());
    assert!(r.combined_score >= 0.0 && r.combined_score <= 1.0);
    assert!(r.latency_ms < 60_000);
}

// =============================================================
// 9. JudgeError 时 verdict.skipped — 不阻塞 case
// =============================================================

struct ErrorJudgeClient;

#[async_trait::async_trait]
impl ea_tauri::harness::eval::judge::JudgeClient for ErrorJudgeClient {
    async fn chat(&self, _system: &str, _user: &str, _max: u64) -> Result<String, String> {
        Err("network down".into())
    }
}

#[tokio::test]
async fn judge_error_returns_skipped_not_panic() {
    use ea_tauri::harness::eval::judge::LlmJudge;
    let judge: Arc<dyn Judge> = Arc::new(LlmJudge::new(Box::new(ErrorJudgeClient), "always-fail"));
    let runner = EvalRunner::new(Arc::new(StubTraceProvider(stub_pass_trace())))
        .with_scorer(Arc::new(PiiLeakScorer))
        .with_judge(judge);

    let ds = load_all();
    let report = runner.run_dataset(ds.cases.to_vec()).await;
    // judge error → verdict.skipped → 不阻塞 → 全 pass
    assert_eq!(report.passed, 12);
    for r in &report.results {
        let v = r.judge.as_ref().expect("judge is set");
        assert!(matches!(v, JudgeVerdict { .. }));
        // skipped verdicts carry the "n/a" model marker
        assert_eq!(v.judge_model, "n/a");
    }
}

// =============================================================
// 10. StubJudgeClient (从 judge.rs 自带) — 烟雾测试
// =============================================================

#[tokio::test]
async fn stub_judge_client_returns_preconfigured_text() {
    let s = StubJudgeClient(r#"{"score":0.7,"passed":true,"reasoning":"ok"}"#.into());
    let out = s.chat("sys", "user", 100).await.unwrap();
    assert!(out.contains("0.7"));
}
