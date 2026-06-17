//! Evaluation Harness — 评估层
//!
//! # 设计目标
//! 把"agent 跑得对不对"变成 **可在 CI 上重复执行的回归测试**。
//! 业务级评分 (Scorer, 零 LLM 成本) + LLM-as-a-Judge 主观评分, 产出 HTML + JSON 报告。
//!
//! # 模块组成
//! - dataset: JSONL 数据集解析 ([`DatasetCase`] + [`ExpectedToolCall`])
//! - scorer: 确定性评分 (tool_call 匹配 / schema 校验 / PII 残留 / budget)
//! - judge: LLM-as-a-Judge 评分 (用 `LlmService::complete_chat` 调低成本模型)
//! - runner: 跑单 case 收集 trace, 聚合 case → run
//! - report: 报告生成 (HTML 自包含页面 + JSON 全量)
//!
//! # 数据流
//! ```text
//! JSONL dataset
//!   └─→ Dataset::load(path)                       (本模块)
//!       └─→ EvalRunner::run_case(case)
//!           ├─→ AgentHarness::run(cfg)            (阶段二 既有)
//!           ├─→ RunTrace (来自 StateStore)
//!           ├─→ scorers.score(case, trace)        (零 LLM)
//!           └─→ judge.score(case, trace)          (调低成本 LLM)
//!               └─→ CaseResult { scorers, judge }
//!                   └─→ EvalRunReport
//!                       └─→ report.write_html/json (askama)
//! ```
//!
//! # 与 Agent / Guardrails 的边界
//! - 评估 **只读** Agent / Guardrails, 不改
//! - 走 `AgentHarness::run` 与生产代码同路径
//! - 报告写 `report.html` / `report.json` 给 CI artifact
//!
//! # CI 门
//! - `pass_rate >= threshold` (默认 0.8) → exit 0
//! - 否则 → exit 1, 阻断 merge
//!
//! # 阶段四暂不实现 (留到阶段五+)
//! - 回归 diff (baseline vs current)
//! - GuardrailTriggerScorer (需要 guardrails 埋 Allow/Block 事件)
//! - 跨进程 trace 持久化

pub mod dataset;
pub mod judge;
pub mod report;
pub mod runner;
pub mod scorer;

pub use dataset::{CaseCategory, Dataset, DatasetCase, DatasetError, ExpectedToolCall};
pub use judge::{Judge, JudgeError, JudgeVerdict, LlmJudge, StubJudgeClient, DEFAULT_RUBRIC};
pub use report::{EvalRunReport, ReportWriter};
pub use crate::harness::agent::trace::{RunTrace, TraceToolCall};
pub use runner::{CaseResult, EvalRunner};
pub use scorer::{
    BudgetScorer, PiiLeakScorer, SchemaValidatorScorer, Scorer, ScorerResult, ToolCallMatchScorer,
};
