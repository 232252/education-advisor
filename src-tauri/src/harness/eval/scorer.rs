//! 确定性评分器 — 零 LLM 成本
//!
//! # 4 个内置 Scorer
//! 1. [`ToolCallMatchScorer`] — `expected_tool_calls` 与 trace 顺序匹配, 召回率
//! 2. [`SchemaValidatorScorer`] — 写操作 tool 返回值能通过该 tool 的 input_schema (反向校验)
//! 3. [`PiiLeakScorer`] — 检查 final_text 中是否含 `[PII_xxx]` 残留
//! 4. [`BudgetScorer`] — rounds / tokens / cost 不超 budget, 否则 0 分
//!
//! # 聚合策略
//! EvalRunner 收集所有 `applicable` 的 Scorer, 取最高分作 case 评分。
//! 若任一适用 Scorer 给 0 分, 该 case 0 分 (fail-fast)。
//!
//! # 扩展
//! 实现 [`Scorer`] trait, 加到 `EvalRunner::scorers` 即可。

use crate::harness::agent::trace::{RunTrace, TraceToolCall};
use crate::harness::eval::dataset::{CaseCategory, DatasetCase, ExpectedToolCall};

/// 单个 Scorer 的结果
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScorerResult {
    pub scorer: String,
    /// 0.0-1.0
    pub score: f32,
    pub passed: bool,
    /// 人类可读
    pub details: Vec<String>,
}

impl ScorerResult {
    pub fn pass(scorer: &str, score: f32, details: Vec<String>) -> Self {
        Self { scorer: scorer.to_string(), score, passed: score > 0.0, details }
    }
    pub fn fail(scorer: &str, reason: String) -> Self {
        Self { scorer: scorer.to_string(), score: 0.0, passed: false, details: vec![reason] }
    }
}

/// Scorer trait
pub trait Scorer: Send + Sync {
    fn name(&self) -> &'static str;
    /// 该 case 是否适用此 scorer (用于过滤)
    fn applies(&self, case: &DatasetCase) -> bool;
    fn score(&self, case: &DatasetCase, trace: &RunTrace) -> ScorerResult;
}

// =============================================================
// 1. ToolCallMatchScorer
// =============================================================

/// 期望的工具调用序列与 trace 实际调用做顺序匹配
/// - 期望工具名 + args_substring (可选) 必须出现且按顺序
/// - 召回率 = matched / expected
/// - 多余的调用不算扣分 (LLM 自主决定调几次)
pub struct ToolCallMatchScorer;

impl Scorer for ToolCallMatchScorer {
    fn name(&self) -> &'static str {
        "tool_call_match"
    }

    fn applies(&self, case: &DatasetCase) -> bool {
        case.expected_tool_calls
            .as_ref()
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    }

    fn score(&self, case: &DatasetCase, trace: &RunTrace) -> ScorerResult {
        let expected = case.expected_tool_calls.as_ref().unwrap();
        let actual = &trace.tool_calls;
        let (matched, details) = match_sequence(expected, actual);
        let score = if expected.is_empty() {
            1.0
        } else {
            matched as f32 / expected.len() as f32
        };
        ScorerResult {
            scorer: self.name().to_string(),
            score,
            passed: matched == expected.len(),
            details,
        }
    }
}

/// 顺序子序列匹配: expected 工具必须在 actual 中按顺序出现
/// 返回 (matched_count, details)
fn match_sequence(expected: &[ExpectedToolCall], actual: &[TraceToolCall]) -> (usize, Vec<String>) {
    let mut exp_idx = 0;
    let mut details = Vec::new();
    for (i, act) in actual.iter().enumerate() {
        if exp_idx >= expected.len() {
            break;
        }
        let exp = &expected[exp_idx];
        if act.name != exp.tool {
            continue;
        }
        // args_substring 检查
        if let Some(arg_sub) = &exp.args_substring {
            let arg_str = act.args.to_string();
            if !arg_str.contains(arg_sub) {
                details.push(format!(
                    "工具 {}[{}] args 缺 '{}', 实际 args: {}",
                    i, act.name, arg_sub, truncate(&arg_str, 100)
                ));
                continue;
            }
        }
        // result_substring 检查
        if let Some(res_sub) = &exp.result_substring {
            let res_str = act
                .result
                .as_ref()
                .map(|v| v.to_string())
                .unwrap_or_default();
            if !res_str.contains(res_sub) {
                details.push(format!(
                    "工具 {}[{}] result 缺 '{}', 实际 result: {}",
                    i,
                    act.name,
                    res_sub,
                    truncate(&res_str, 100)
                ));
                continue;
            }
        }
        details.push(format!("✓ 匹配 {}[{}]", act.name, i));
        exp_idx += 1;
    }
    (exp_idx, details)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

// =============================================================
// 2. SchemaValidatorScorer
// =============================================================

/// 写操作 tool 的返回值应符合该 tool 的 input_schema (反向校验)
/// 当前是简化版: 只检查返回值是 object 且非空
/// 完整版 (R5 之后) 可用 `jsonschema` crate
pub struct SchemaValidatorScorer;

impl Scorer for SchemaValidatorScorer {
    fn name(&self) -> &'static str {
        "schema_validator"
    }

    fn applies(&self, case: &DatasetCase) -> bool {
        // 只对写操作类 case 适用 (TaskCompletion + ToolCorrectness)
        matches!(case.category, CaseCategory::TaskCompletion | CaseCategory::ToolCorrectness)
    }

    fn score(&self, _case: &DatasetCase, trace: &RunTrace) -> ScorerResult {
        let write_calls: Vec<&TraceToolCall> =
            trace.tool_calls.iter().filter(|t| t.is_write).collect();
        if write_calls.is_empty() {
            // 写操作 case 但 trace 无写调用 = 0 分
            return ScorerResult::fail(
                self.name(),
                "case 需要写工具调用, 但 trace 中无写操作".into(),
            );
        }
        let mut details = Vec::new();
        let mut bad = 0;
        for tc in write_calls.iter() {
            if tc.status != "executed" {
                details.push(format!("✗ {}[{}] 状态: {}", tc.name, tc.status, tc.error.clone().unwrap_or_default()));
                bad += 1;
                continue;
            }
            let result = match &tc.result {
                Some(r) => r,
                None => {
                    details.push(format!("✗ {}[..] 成功但无返回值", tc.name));
                    bad += 1;
                    continue;
                }
            };
            if !result.is_object() {
                details.push(format!("✗ {}[..] 返回非 object: {}", tc.name, truncate(&result.to_string(), 60)));
                bad += 1;
                continue;
            }
            if result.as_object().unwrap().is_empty() {
                details.push(format!("✗ {}[..] 返回空 object", tc.name));
                bad += 1;
                continue;
            }
            details.push(format!("✓ {}[..] 返回值 OK", tc.name));
        }
        let total = write_calls.len();
        let score = if total == 0 { 0.0 } else { (total - bad) as f32 / total as f32 };
        ScorerResult {
            scorer: self.name().to_string(),
            score,
            passed: bad == 0,
            details,
        }
    }
}

// =============================================================
// 3. PiiLeakScorer
// =============================================================

/// 检查 trace.final_text 是否含 `[PII_xxx]` 残留 (期望为 0)
/// 任何残留 = 0 分
pub struct PiiLeakScorer;

impl Scorer for PiiLeakScorer {
    fn name(&self) -> &'static str {
        "pii_leak"
    }

    fn applies(&self, _case: &DatasetCase) -> bool {
        // 所有 case 都查 (即使是 Privacy 类)
        true
    }

    fn score(&self, _case: &DatasetCase, trace: &RunTrace) -> ScorerResult {
        let leaked: Vec<&str> = find_pii_tokens(&trace.final_text);
        if leaked.is_empty() {
            ScorerResult::pass(self.name(), 1.0, vec!["✓ final_text 无 PII token 残留".into()])
        } else {
            ScorerResult::fail(
                self.name(),
                format!("final_text 含 {} 个 PII token: {:?}", leaked.len(), leaked),
            )
        }
    }
}

/// 扫描文本中所有 `[PII_xxx]` token
fn find_pii_tokens(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            if let Some(end_rel) = text[i..].find(']') {
                let end = i + end_rel;
                let token = &text[i..=end];
                // 匹配 [PII_<anything non-]>]
                if token.starts_with("[PII_") && token.len() > 6 {
                    out.push(token);
                    i = end + 1;
                    continue;
                }
            }
        }
        i += 1;
    }
    out
}

// =============================================================
// 4. BudgetScorer
// =============================================================

/// 检查 trace 的 rounds / tokens / cost 不超 budget, 否则 0 分
pub struct BudgetScorer;

impl Scorer for BudgetScorer {
    fn name(&self) -> &'static str {
        "budget"
    }

    fn applies(&self, case: &DatasetCase) -> bool {
        case.budget.is_some()
    }

    fn score(&self, case: &DatasetCase, trace: &RunTrace) -> ScorerResult {
        let budget = match &case.budget {
            Some(b) => b,
            None => return ScorerResult::pass(self.name(), 1.0, vec!["无 budget 限制".into()]),
        };
        let mut details = Vec::new();
        let mut over = 0;
        if trace.rounds as u64 > budget.max_rounds {
            details.push(format!(
                "✗ rounds: trace={} > budget={}",
                trace.rounds, budget.max_rounds
            ));
            over += 1;
        } else {
            details.push(format!("✓ rounds: {} <= {}", trace.rounds, budget.max_rounds));
        }
        if trace.input_tokens > budget.max_input_tokens {
            details.push(format!(
                "✗ input_tokens: {} > {}",
                trace.input_tokens, budget.max_input_tokens
            ));
            over += 1;
        } else {
            details.push(format!("✓ input_tokens: {} <= {}", trace.input_tokens, budget.max_input_tokens));
        }
        if trace.output_tokens > budget.max_output_tokens {
            details.push(format!(
                "✗ output_tokens: {} > {}",
                trace.output_tokens, budget.max_output_tokens
            ));
            over += 1;
        } else {
            details.push(format!("✓ output_tokens: {} <= {}", trace.output_tokens, budget.max_output_tokens));
        }
        if trace.cost_usd_micros > budget.max_cost_usd_micros {
            details.push(format!(
                "✗ cost: {} > {}",
                trace.cost_usd_micros, budget.max_cost_usd_micros
            ));
            over += 1;
        } else {
            details.push(format!("✓ cost: {} <= {}", trace.cost_usd_micros, budget.max_cost_usd_micros));
        }
        let total_checks = 4;
        let score = (total_checks - over) as f32 / total_checks as f32;
        ScorerResult {
            scorer: self.name().to_string(),
            score,
            passed: over == 0,
            details,
        }
    }
}

// =============================================================
// 单元测试
// =============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn trace_with_calls(calls: Vec<TraceToolCall>) -> RunTrace {
        RunTrace {
            case_id: "t".into(),
            final_text: "ok".into(),
            tool_calls: calls,
            rounds: 1,
            input_tokens: 100,
            output_tokens: 50,
            cost_usd_micros: 1000,
            status: "success".into(),
            error: None,
            latency_ms: 10,
        }
    }

    fn tc(name: &str, args: Value, result: Option<Value>, is_write: bool) -> TraceToolCall {
        TraceToolCall {
            name: name.into(),
            args,
            result,
            is_write,
            risk: "medium".into(),
            status: "executed".into(),
            error: None,
        }
    }

    fn case_with_expected(expected: Vec<ExpectedToolCall>) -> DatasetCase {
        DatasetCase {
            id: "x".into(),
            category: CaseCategory::TaskCompletion,
            agent_id: "edu".into(),
            prompt: "x".into(),
            history: None,
            budget: None,
            expected_tool_calls: Some(expected),
            judge_rubric: None,
            pass_threshold: None,
            tags: vec![],
        }
    }

    // ---- ToolCallMatchScorer ----

    #[test]
    fn tool_call_match_perfect() {
        let case = case_with_expected(vec![ExpectedToolCall {
            tool: "add_event".into(),
            args_substring: Some("张三".into()),
            result_substring: Some("eventId".into()),
        }]);
        let trace = trace_with_calls(vec![tc(
            "add_event",
            json!({"student": "张三", "delta": -5}),
            Some(json!({"eventId": "e1", "name": "张三"})),
            true,
        )]);
        let r = ToolCallMatchScorer.score(&case, &trace);
        assert!(r.passed);
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn tool_call_match_partial() {
        let case = case_with_expected(vec![
            ExpectedToolCall { tool: "add_event".into(), args_substring: None, result_substring: None },
            ExpectedToolCall { tool: "add_event".into(), args_substring: None, result_substring: None },
        ]);
        let trace = trace_with_calls(vec![tc(
            "add_event",
            json!({}),
            Some(json!({})),
            true,
        )]);
        let r = ToolCallMatchScorer.score(&case, &trace);
        assert!(!r.passed);
        assert_eq!(r.score, 0.5);
    }

    #[test]
    fn tool_call_match_out_of_order_partial() {
        let case = case_with_expected(vec![
            ExpectedToolCall { tool: "get_student".into(), args_substring: None, result_substring: None },
            ExpectedToolCall { tool: "add_event".into(), args_substring: None, result_substring: None },
        ]);
        let trace = trace_with_calls(vec![
            tc("add_event", json!({}), Some(json!({})), true),
            tc("get_student", json!({}), Some(json!({})), false),
        ]);
        let r = ToolCallMatchScorer.score(&case, &trace);
        // 顺序子序列匹配: get_student 在 i=1 匹配 (0.5), add_event 期望在 get_student 之后 → 未匹配
        assert!(!r.passed);
        assert_eq!(r.score, 0.5);
    }

    #[test]
    fn tool_call_match_strict_order_required() {
        // 期望 add_event 必须在 get_student 之后; trace 中 add_event 在前
        let case = case_with_expected(vec![
            ExpectedToolCall { tool: "get_student".into(), args_substring: None, result_substring: None },
            ExpectedToolCall { tool: "add_event".into(), args_substring: None, result_substring: None },
        ]);
        // 完全逆序: 先 add_event 再 get_student, 期望顺序是 get_student → add_event
        // 实际匹配: get_student 在 i=1 命中 (exp_idx=1), 然后需要 add_event 在 get_student 之后 → 找不到
        let trace = trace_with_calls(vec![
            tc("add_event", json!({}), Some(json!({})), true),
            tc("get_student", json!({}), Some(json!({})), false),
            tc("add_event", json!({}), Some(json!({})), true),
        ]);
        let r = ToolCallMatchScorer.score(&case, &trace);
        // get_student 在 i=1 匹配 → exp_idx=1, 然后在 i=2 又一个 add_event 匹配 → exp_idx=2
        assert!(r.passed);
        assert_eq!(r.score, 1.0);
    }

    // ---- SchemaValidatorScorer ----

    #[test]
    fn schema_validator_writes_present_and_object() {
        let case = DatasetCase {
            category: CaseCategory::TaskCompletion,
            ..case_with_expected(vec![])
        };
        let trace = trace_with_calls(vec![
            tc("add_event", json!({}), Some(json!({"eventId": "e1"})), true),
            tc("get_student", json!({}), Some(json!({"name": "张三"})), false),
        ]);
        let r = SchemaValidatorScorer.score(&case, &trace);
        assert!(r.passed);
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn schema_validator_empty_object_is_bad() {
        let case = DatasetCase {
            category: CaseCategory::TaskCompletion,
            ..case_with_expected(vec![])
        };
        let trace = trace_with_calls(vec![tc("add_event", json!({}), Some(json!({})), true)]);
        let r = SchemaValidatorScorer.score(&case, &trace);
        assert!(!r.passed);
    }

    // ---- PiiLeakScorer ----

    #[test]
    fn pii_leak_clean() {
        let trace = RunTrace { final_text: "张三的月考扣了 5 分".into(), ..trace_with_calls(vec![]) };
        let case = case_with_expected(vec![]);
        let r = PiiLeakScorer.score(&case, &trace);
        assert!(r.passed);
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn pii_leak_detects_residual_token() {
        let trace = RunTrace {
            final_text: "已经把 [PII_1] 的分数扣了".into(),
            ..trace_with_calls(vec![])
        };
        let case = case_with_expected(vec![]);
        let r = PiiLeakScorer.score(&case, &trace);
        assert!(!r.passed);
        assert_eq!(r.score, 0.0);
        assert!(r.details[0].contains("[PII_1]"));
    }

    // ---- BudgetScorer ----

    #[test]
    fn budget_within_limits() {
        let mut case = case_with_expected(vec![]);
        case.budget = Some(crate::harness::agent::budget::Budget {
            max_rounds: 8,
            max_input_tokens: 1000,
            max_output_tokens: 500,
            max_cost_usd_micros: 10000,
            max_wall_time_sec: 60,
        });
        let trace = trace_with_calls(vec![]);
        let r = BudgetScorer.score(&case, &trace);
        assert!(r.passed);
        assert_eq!(r.score, 1.0);
    }

    #[test]
    fn budget_exceeded() {
        let mut case = case_with_expected(vec![]);
        case.budget = Some(crate::harness::agent::budget::Budget {
            max_rounds: 1,
            max_input_tokens: 1000,
            max_output_tokens: 500,
            max_cost_usd_micros: 10000,
            max_wall_time_sec: 60,
        });
        let mut trace = trace_with_calls(vec![]);
        trace.rounds = 5;
        let r = BudgetScorer.score(&case, &trace);
        assert!(!r.passed);
        assert_eq!(r.score, 0.75); // 4 checks, 1 over
    }
}
