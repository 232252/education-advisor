# 阶段四·Evaluation Harness - 评估层设计与实现

> 实现日期: 2026-06-16
> 适用代码: `src-tauri/src/harness/eval/{mod,dataset,scorer,judge,runner,report}.rs`
> 测试覆盖: 5 个子模块 40 单元测试 + `tests/eval_integration.rs` 12 集成测试, 全部 52/52 通过
> 关联文档: [`01-architecture.md`](01-architecture.md) §3 数据流 / [`03-guardrails.md`](03-guardrails.md) 评估只读守卫

---

## 1. 设计动机

阶段二 (`harness/agent/`) 把 agent 编排为显式 ReAct 状态机, 阶段三 (`harness/guardrails/`) 在 3 个关键路径上挂守护链。
**但"agent 跑得对不对"仍是模糊的人脑判断**:

1. **回归没法自动化**: 改 prompt / 加 skill / 调 scorer 阈值后, 跑 50 条 case 看输出 — 全靠肉眼
2. **判定标准不一致**: 同一份 trace, 评审 A 给 8 分, 评审 B 给 6 分
3. **业务级失败模式难抓**: "在第 3 轮 add_event 后必须紧跟 set_score" 这种顺序约束, 没法用单元测试表达
4. **CI 上没有门**: merge 前只看单元测试, agent 质量只能事后补救

阶段四引入 **Evaluation Harness**, 把"agent 跑得对不对"变成 **可在 CI 上重复执行的回归测试**:

- **业务级确定性 Scorer** (零 LLM 成本): tool_call 顺序匹配 / schema 校验 / PII 残留 / budget
- **LLM-as-a-Judge** 主观评分 (低成本模型): 任务完成度 / 隐私拒绝的合理性 / 越狱拦截
- **JSONL 数据集** (12 case × 4 category) + HTML + JSON 报告

---

## 2. 整体架构

```
                    ┌────────────────────────┐
                    │  JSONL Dataset         │
                    │  (eval/datasets/*.jsonl)│
                    └────────────┬───────────┘
                                 │  Dataset::load(path)
                                 ▼
                    ┌────────────────────────┐
                    │  Dataset                │ ← 12 cases, 4 category
                    │  - cases: Vec<Case>     │
                    │  - filter_tags / merge  │
                    └────────────┬───────────┘
                                 │  EvalRunner::run_dataset(cases)
                                 ▼
        ┌────────────────────────────────────────────────────┐
        │  EvalRunner                                         │
        │   for each case:                                    │
        │     1. trace_provider.run(case) → RunTrace         │
        │     2. scorers[i].score(case, trace) → ScorerResult│  ← 零 LLM
        │     3. judge.score(case, trace)     → JudgeVerdict │  ← 低成本 LLM
        │     4. aggregate() → (combined_score, passed)      │
        └────────────┬───────────────────────────────────────┘
                     │  Vec<CaseResult>
                     ▼
        ┌────────────────────────────────────┐
        │  EvalRunReport                     │
        │   - total / passed / failed        │
        │   - pass_rate / avg_score / cost   │
        │   - results: Vec<CaseResult>       │
        └────────────┬───────────────────────┘
                     │  ReportWriter::write_{json,html}
                     ▼
        ┌────────────────────────────────────┐
        │  report.html + report.json         │
        │  (CI artifact)                     │
        └────────────────────────────────────┘
```

---

## 3. 模块组成

### 3.1 `dataset.rs` — JSONL 解析

| 类型 | 职责 |
|---|---|
| `DatasetCase` | 单 case: id / category / agent_id / prompt / budget / expected_tool_calls / judge_rubric / pass_threshold / tags |
| `ExpectedToolCall` | 期望的 tool_call: tool / args_substring / result_substring |
| `CaseCategory` | 4 个枚举: `safety` / `task_completion` / `privacy` / `tool_correctness` (snake_case JSON) |
| `Dataset` | 加载/合并/按 tag 过滤 |

**JSONL 格式** (1 行 1 case, 注释/空行跳过):

```jsonl
{"id":"safety-001","category":"safety","agent_id":"edu","prompt":"...","judge_rubric":"...","pass_threshold":0.7,"tags":["jailbreak"]}
{"id":"tool-002","category":"tool_correctness","prompt":"...","expected_tool_calls":[{"tool":"add_event","args_substring":"student_2","result_substring":"eventId"}]}
```

### 3.2 `scorer.rs` — 4 个内置 Scorer (零 LLM)

| Scorer | 适用 category | 评分逻辑 |
|---|---|---|
| `ToolCallMatchScorer` | `tool_correctness` | 顺序子序列匹配, recall = matched / expected |
| `SchemaValidatorScorer` | `task_completion` + `tool_correctness` | 写操作 tool 必须有非空 `result` 字段 (e.g. `eventId` 不是 `{}`) |
| `PiiLeakScorer` | 全部 (推荐 privacy) | 扫描 trace 中是否残留 `[PII_xxx]` token |
| `BudgetScorer` | 全部 | rounds / input_tokens / output_tokens / cost 不超 budget |

**Scorer trait** (统一接口, 易于扩展):

```rust
pub trait Scorer: Send + Sync {
    fn name(&self) -> &'static str;
    fn applies(&self, case: &DatasetCase) -> bool;
    fn score(&self, case: &DatasetCase, trace: &RunTrace) -> ScorerResult;
}
```

### 3.3 `judge.rs` — LLM-as-a-Judge

```rust
pub trait Judge: Send + Sync {
    async fn score(&self, case: &DatasetCase, trace: &RunTrace)
        -> Result<JudgeVerdict, JudgeError>;
}

pub trait JudgeClient: Send + Sync {
    async fn chat(&self, sys: &str, user: &str, max_tokens: u64)
        -> Result<String, String>;
}
```

- **生产实现**: `LlmJudgeClient` 调 `LlmService::complete_chat` (低成本模型, e.g. `gpt-4o-mini`)
- **测试桩**: `StubJudgeClient(预置字符串)`, 不发 HTTP
- **3-strategy verdict parsing**: 纯 JSON → ```json``` fence → `{...}` 子串
- **3-strategy 已测试**: `parse_verdict_pure_json` / `parse_verdict_json_in_fence` / `parse_verdict_brace_substring`

**Verdict 失败处理**: `JudgeError` → `JudgeVerdict::skipped(reason)` (`judge_model = "n/a"`), **不阻塞 case 评分** (Scorer 才是主门)

### 3.4 `runner.rs` — EvalRunner

```rust
pub trait TraceProvider: Send + Sync {
    async fn run(&self, case: &DatasetCase) -> RunTrace;
}

pub struct EvalRunner {
    pub trace_provider: Arc<dyn TraceProvider>,
    pub scorers: Vec<Arc<dyn Scorer>>,
    pub judge: Option<Arc<dyn Judge>>,
}
```

- **生产 `TraceProvider`**: `AgentRunTraceProvider` (待阶段五, 需要 AppHandle 启动 `AgentHarness::run` 并监听 `StateStore`)
- **测试桩**: `StubTraceProvider(预置 RunTrace)`, 12 case 同 trace 跑批
- **`aggregate()` 纯函数**: `scorer_mean * 0.5 + judge_score * 0.5`, 无 I/O 易测
- **`passed` 判定**: `all_scorers_pass AND judge.passed (or skipped) AND combined_score >= pass_threshold`

### 3.5 `report.rs` — 报告生成

- `EvalRunReport::from_results(start, end, results)` — 重建聚合统计
- `ReportWriter::write_json(path)` — 全量 JSON (CI artifact, 上游消费)
- `ReportWriter::write_html(path)` — 自包含 HTML 页面, 单一 `format!` 实现, 无模板引擎
- **HTML 转义**: `esc()` 防止 case_id/prompt 里的 `&`/`<`/`>` 破坏页面

**为什么不用 askama 模板引擎**: HTML 报告结构简单 (header + cards + table), `format!` + 转义函数就够, 不引入新依赖避免 vendored-deps 失效。

---

## 4. 评分公式

```text
case_combined = mean(applicable_scorer_scores) * 0.5 + judge.score * 0.5
case_passed   = all_scorers_passed
             AND (judge.passed OR judge skipped)
             AND combined >= case.pass_threshold
run_pass_rate = passed_count / total_count
```

**Judge 缺省** (`--judge-model` 不传) → combined = scorer_mean, 纯确定性

---

## 5. CI 集成 (`.github/workflows/eval.yml`)

### 触发条件

- push / PR 改 `eval/` 或 `harness/eval/` 或 `Cargo.toml/lock` 或本 workflow
- 手动 `workflow_dispatch`

### 两个 job

1. **`unit-tests`**: 单元 + 集成测试 (无网络, 无 API key)
   - `cargo test --lib harness::eval`
   - `cargo test --test eval_integration`
2. **`runner-cli`**: `eval-runner` CLI 跑批 (StubTraceProvider, 烟雾测试)
   - 构建 release binary
   - 跑全部 dataset, 写报告
   - 上传 `report.html` + `report.json` 作 14-day artifact
   - **当前不阻断** (StubTraceProvider 限制, pass_rate 通常 0.5~0.8)
   - 阶段五接入 `AgentRunTraceProvider` 后升级为 `--pass-rate 0.8` 硬门

### 退出码

| Code | 含义 |
|---|---|
| 0 | pass_rate ≥ threshold |
| 1 | pass_rate < threshold (CI fail) |
| 2 | 参数 / 数据集 / 报告写盘错误 |

---

## 6. CLI 用法

```bash
# 跑单个数据集
eval-runner --dataset eval/datasets/safety.jsonl --out-dir reports/safety

# 跑全部 + 阈值 0.8
eval-runner --dataset-dir eval/datasets --out-dir reports/all --pass-rate 0.8

# 烟雾测试 (StubJudge, 不发真 LLM)
eval-runner --dataset-dir eval/datasets \
            --judge-model gpt-4o-mini --stub-judge \
            --pass-rate 0.5

# 只跑特定 tag
eval-runner --dataset-dir eval/datasets --only-tags jailbreak,pii
```

---

## 7. 当前限制 (留到阶段五+)

- **`AgentRunTraceProvider` 未实装**: CLI 默认走 `StubTraceProvider`, 不能跑真 agent。阶段五接 `AgentHarness::run` + `StateStore` 后, 可在 CI 跑真业务流
- **无 baseline diff**: 不能"和上次跑批结果对比, 退步 >5% 即 fail"。需要 `eval-reports/baseline.json` + diff
- **无 GuardrailTriggerScorer**: 阶段三的 Allow/Block 事件尚未埋到 `RunTrace`, 不能在 eval 里验证守护链触发率
- **无并发跑批**: 12 case 串行, 真实 trace 后会变慢, 需要 `tokio::spawn` + `JoinSet`

---

## 8. 测试覆盖

| 模块 | 单元测试 | 集成测试 |
|---|---|---|
| `dataset.rs` | 7 (含 parse / merge / filter / duplicate id) | — |
| `scorer.rs` | 10 (4 scorer × 2~3 case) | — |
| `judge.rs` | 11 (parse 3-strategy × LLM stub 端到端) | — |
| `runner.rs` | 6 (aggregate + run_case + run_dataset) | — |
| `report.rs` | 6 (from_results / write_json / write_html / esc) | — |
| `eval_integration.rs` | — | 12 (dataset 加载 + 真 Scorer/Judge 跑批 + JSON/HTML roundtrip) |
| **合计** | **40** | **12** |

CLI 烟雾测试: 跑全部 dataset, 写 report.html (4122 字节) + report.json (10 KB), exit 0/1 行为正确。

---

## 9. 关联文档

- [`01-architecture.md`](01-architecture.md) §3 数据流 — 评估层在整体架构中的位置
- [`02-inventory.md`](02-inventory.md) — 评估层 API 索引
- [`03-guardrails.md`](03-guardrails.md) — 评估只读守卫 (不修改 agent / guardrails 状态)
- `BACKLOG.md` — 阶段五任务 (AgentRunTraceProvider / baseline diff / 并发)
