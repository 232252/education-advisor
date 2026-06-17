//! EvalRunner — 跑单个 case, 收集 trace
//!
//! # 设计
//! - `RunTrace` / `TraceToolCall` — trace 公共结构 (R1 已定义)
//! - `TraceProvider` trait — 提供 trace 的抽象 (生产: `AgentRunTraceProvider`, 测试: `StubTraceProvider`)
//! - `EvalRunner` — 聚合 Scorers + Judge, 产出 `CaseResult`
//! - `run_dataset` — 批量跑, 产出 `EvalRunReport`
//!
//! # 边界
//! - R5 不实装 `AgentRunTraceProvider` (需要 AppHandle, 留给 R7)
//! - R5 重点是 Scorer 聚合 + Judge 调度 + 评分公式
//!
//! # 评分公式
//! - `case_combined = mean(applicable_scorer_scores) * 0.5 + judge_score * 0.5`
//! - `case_passed = all_applicable_scorers_passed AND judge.passed` (跳过 Judge 时只看 Scorer)
//! - `run_pass_rate = pass_count / total_count`

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::harness::agent::trace::RunTrace;
use crate::harness::eval::dataset::DatasetCase;
use crate::harness::eval::judge::{Judge, JudgeVerdict};
use crate::harness::eval::scorer::{Scorer, ScorerResult};

pub use crate::harness::eval::scorer::ScorerResult as ScorerResultExport;

// =============================================================
// TraceProvider — 给一个 case, 返回其 trace
// =============================================================

#[async_trait::async_trait]
pub trait TraceProvider: Send + Sync {
    async fn run(&self, case: &DatasetCase) -> RunTrace;
}

/// 测试用 Stub: 返回预先指定的 trace
pub struct StubTraceProvider(pub RunTrace);

#[async_trait::async_trait]
impl TraceProvider for StubTraceProvider {
    async fn run(&self, _case: &DatasetCase) -> RunTrace {
        self.0.clone()
    }
}

/// 生产 TraceProvider: 调 AgentHarness 真实跑 case,收集 RunTrace
pub struct AgentHarnessTraceProvider {
    pub app: tauri::AppHandle,
    pub state: std::sync::Arc<crate::state::AppState>,
    pub registry: crate::harness::tools::ToolRegistry,
}

impl AgentHarnessTraceProvider {
    pub fn new(
        app: tauri::AppHandle,
        state: std::sync::Arc<crate::state::AppState>,
        registry: crate::harness::tools::ToolRegistry,
    ) -> Self {
        Self { app, state, registry }
    }
}

#[async_trait::async_trait]
impl TraceProvider for AgentHarnessTraceProvider {
    async fn run(&self, case: &DatasetCase) -> RunTrace {
        use std::sync::{Arc, Mutex};
        use std::time::Instant;

        let trace = Arc::new(Mutex::new(RunTrace {
            case_id: case.id.clone(),
            ..RunTrace::default()
        }));

        let cfg = crate::harness::agent::AgentRunConfig {
            agent_id: case.agent_id.clone(),
            prompt: case.prompt.clone(),
            history: case.history.clone(),
            cancel: None,
            budget: case.budget.clone(),
            app_context: None,
            trace_collector: Some(trace.clone()),
        };

        let harness = crate::harness::agent::AgentHarness::new(
            &self.state,
            self.registry.clone(),
            self.app.clone(),
        );
        let start = Instant::now();
        let result = harness.run(cfg).await;
        let latency_ms = start.elapsed().as_millis() as u64;

        match Arc::try_unwrap(trace) {
            Ok(mutex) => {
                let mut t = mutex.into_inner().unwrap_or_default();
                t.latency_ms = latency_ms;
                if let Err(e) = result {
                    t.error = Some(e.to_string());
                    if t.status.is_empty() || t.status == "failure" {
                        /* 已设置 */
                    } else {
                        t.status = "failure".into();
                    }
                }
                t
            }
            Err(arc) => {
                // 仍被 harness 引用, 复制当前状态
                let mut t = arc
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_else(|_| RunTrace::default());
                t.latency_ms = latency_ms;
                if let Err(e) = result {
                    t.error = Some(e.to_string());
                    t.status = "failure".into();
                }
                t
            }
        }
    }
}

// =============================================================
// CaseResult — 单 case 评分结果
// =============================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaseResult {
    pub case_id: String,
    pub case_category: super::dataset::CaseCategory,
    pub scorers: Vec<ScorerResult>,
    pub judge: Option<JudgeVerdict>,
    /// 综合分 (0.0-1.0)
    pub combined_score: f32,
    pub passed: bool,
    pub trace: RunTrace,
    pub latency_ms: u64,
}

// =============================================================
// EvalRunner
// =============================================================

pub struct EvalRunner {
    pub trace_provider: Arc<dyn TraceProvider>,
    pub scorers: Vec<Arc<dyn Scorer>>,
    pub judge: Option<Arc<dyn Judge>>,
}

impl EvalRunner {
    pub fn new(trace_provider: Arc<dyn TraceProvider>) -> Self {
        Self {
            trace_provider,
            scorers: Vec::new(),
            judge: None,
        }
    }

    pub fn with_scorer(mut self, scorer: Arc<dyn Scorer>) -> Self {
        self.scorers.push(scorer);
        self
    }

    pub fn with_judge(mut self, judge: Arc<dyn Judge>) -> Self {
        self.judge = Some(judge);
        self
    }

    /// 跑一个 case
    pub async fn run_case(&self, case: &DatasetCase) -> CaseResult {
        let start = Instant::now();
        let trace = self.trace_provider.run(case).await;
        let latency_ms = start.elapsed().as_millis() as u64;

        // 1. 跑 Scorers (同步, 无 I/O)
        let scorers: Vec<ScorerResult> = self
            .scorers
            .iter()
            .filter(|s| s.applies(case))
            .map(|s| s.score(case, &trace))
            .collect();

        // 2. 跑 Judge (异步, 调 LLM)
        let judge: Option<JudgeVerdict> = if let Some(j) = &self.judge {
            match j.score(case, &trace).await {
                Ok(v) => Some(v),
                Err(e) => Some(JudgeVerdict::skipped(&format!("Judge 错误: {e}"))),
            }
        } else {
            None
        };

        // 3. 聚合
        let (combined_score, passed) = aggregate(&scorers, judge.as_ref(), case);

        CaseResult {
            case_id: case.id.clone(),
            case_category: case.category,
            scorers,
            judge,
            combined_score,
            passed,
            trace,
            latency_ms,
        }
    }

    /// 批量跑
    pub async fn run_dataset(&self, cases: Vec<DatasetCase>) -> super::report::EvalRunReport {
        use super::report::EvalRunReport;
        let started_at = chrono::Utc::now().timestamp();
        let mut results = Vec::with_capacity(cases.len());
        for case in cases {
            let r = self.run_case(&case).await;
            results.push(r);
        }
        let finished_at = chrono::Utc::now().timestamp();
        EvalRunReport::from_results(started_at, finished_at, results)
    }
}

// =============================================================
// 聚合函数 — 独立可测
// =============================================================

/// 聚合 case 评分
/// - 有 Judge: combined = mean(scorer_scores) * 0.5 + judge.score * 0.5
/// - 无 Judge: combined = mean(scorer_scores)
/// - pass = (所有适用 Scorer 都 pass) AND (judge.passed 或 judge 缺省)
pub fn aggregate(
    scorers: &[ScorerResult],
    judge: Option<&JudgeVerdict>,
    case: &DatasetCase,
) -> (f32, bool) {
    let scorer_mean = if scorers.is_empty() {
        1.0 // 无 Scorer 适用 → 满分 (例如纯 Judge 类 case)
    } else {
        scorers.iter().map(|s| s.score).sum::<f32>() / scorers.len() as f32
    };

    let (combined_score, judge_pass) = match judge {
        Some(j) => {
            // judge 可能是 skipped (0.0 分) — 视为未跑
            let j_score = if j.judge_model == "n/a" { None } else { Some(j.score) };
            match j_score {
                Some(s) => (scorer_mean * 0.5 + s * 0.5, j.passed),
                None => (scorer_mean, true), // judge 跳过, 不阻塞
            }
        }
        None => (scorer_mean, true),
    };

    let all_scorers_pass = scorers.iter().all(|s| s.passed);
    let threshold = case.pass_threshold();
    let passed = all_scorers_pass && judge_pass && combined_score >= threshold;
    (combined_score, passed)
}

// =============================================================
// 单元测试
// =============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::agent::trace::TraceToolCall;
    use crate::harness::eval::dataset::CaseCategory;
    use crate::harness::eval::scorer::PiiLeakScorer;
    use serde_json::json;

    fn empty_trace() -> RunTrace {
        RunTrace {
            case_id: "t".into(),
            final_text: "ok".into(),
            tool_calls: vec![],
            rounds: 1,
            input_tokens: 10,
            output_tokens: 5,
            cost_usd_micros: 100,
            status: "success".into(),
            error: None,
            latency_ms: 10,
        }
    }

    fn case(category: CaseCategory) -> DatasetCase {
        DatasetCase {
            id: "c".into(),
            category,
            agent_id: "edu".into(),
            prompt: "p".into(),
            history: None,
            budget: None,
            expected_tool_calls: None,
            judge_rubric: None,
            pass_threshold: None,
            tags: vec![],
        }
    }

    // ---- aggregate ----

    #[test]
    fn aggregate_no_scorer_no_judge_passes() {
        let (score, passed) = aggregate(&[], None, &case(CaseCategory::Safety));
        assert_eq!(score, 1.0);
        assert!(passed);
    }

    #[test]
    fn aggregate_one_scorer_pass_judge_pass() {
        let s = vec![ScorerResult::pass("s", 1.0, vec![])];
        let j = JudgeVerdict {
            score: 0.8,
            passed: true,
            reasoning: "ok".into(),
            judge_model: "test".into(),
            cost_usd_micros: 0,
            latency_ms: 0,
        };
        let (score, passed) = aggregate(&s, Some(&j), &case(CaseCategory::Safety));
        // 1.0 * 0.5 + 0.8 * 0.5 = 0.9
        assert!((score - 0.9).abs() < 0.001);
        assert!(passed);
    }

    #[test]
    fn aggregate_scorer_fail_blocks_case() {
        let s = vec![ScorerResult::fail("s", "bad".into())];
        let j = JudgeVerdict {
            score: 1.0,
            passed: true,
            reasoning: "ok".into(),
            judge_model: "test".into(),
            cost_usd_micros: 0,
            latency_ms: 0,
        };
        let (_score, passed) = aggregate(&s, Some(&j), &case(CaseCategory::Safety));
        assert!(!passed);
    }

    #[test]
    fn aggregate_judge_skipped_does_not_block() {
        let s = vec![ScorerResult::pass("s", 1.0, vec![])];
        let j = JudgeVerdict::skipped("no key");
        let (score, passed) = aggregate(&s, Some(&j), &case(CaseCategory::Safety));
        // judge 跳过, 不算分: score = scorer_mean = 1.0
        assert_eq!(score, 1.0);
        assert!(passed);
    }

    // ---- EvalRunner::run_case ----

    #[tokio::test]
    async fn run_case_with_stub_and_scorer() {
        let trace = RunTrace {
            case_id: "c".into(),
            final_text: "ok".into(),
            tool_calls: vec![TraceToolCall {
                name: "add_event".into(),
                args: json!({}),
                result: Some(json!({"eventId": "e1"})),
                is_write: true,
                risk: "medium".into(),
                status: "executed".into(),
                error: None,
            }],
            rounds: 1,
            input_tokens: 10,
            output_tokens: 5,
            cost_usd_micros: 100,
            status: "success".into(),
            error: None,
            latency_ms: 10,
        };
        let runner = EvalRunner::new(Arc::new(StubTraceProvider(trace)))
            .with_scorer(Arc::new(PiiLeakScorer));
        let c = case(CaseCategory::TaskCompletion);
        let r = runner.run_case(&c).await;
        assert_eq!(r.case_id, "c");
        assert_eq!(r.scorers.len(), 1);
        assert!(r.judge.is_none());
        assert!(r.passed);
    }

    #[tokio::test]
    async fn run_dataset_aggregates_pass_rate() {
        let trace_pass = empty_trace();
        let trace_fail = RunTrace {
            final_text: "leaked [PII_1]".into(),
            ..empty_trace()
        };
        // 构造 2 case: 一个干净 trace (pass), 一个有 PII (fail)
        // 用单独的 EvalRunner 因为 StubTraceProvider 只接一个 trace
        let runner1 = EvalRunner::new(Arc::new(StubTraceProvider(trace_pass)))
            .with_scorer(Arc::new(PiiLeakScorer));
        let r1 = runner1.run_case(&case(CaseCategory::TaskCompletion)).await;
        assert!(r1.passed);

        let runner2 = EvalRunner::new(Arc::new(StubTraceProvider(trace_fail)))
            .with_scorer(Arc::new(PiiLeakScorer));
        let r2 = runner2.run_case(&case(CaseCategory::TaskCompletion)).await;
        assert!(!r2.passed);
    }
}
