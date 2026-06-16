# 阶段一·架构蓝图 - Education Advisor 三层 AI Harness

> 设计日期: 2026-06-16
> 设计依据: `02-inventory.md` 实测现状
> 设计目标: 把"独立的 LLM 调用"重构为"深度嵌入应用流程、可被持续评估和优化的原生组件"

## 1. 三层 Harness 概览

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│                         应用前端 (React + Tauri WebView)                │
│                                                                        │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │
│   │ AI Chat Panel│  │ Agent Runner │  │ Skill Browser│                │
│   │  (人机对话)  │  │  UI (执行面板)│  │  (技能管理)  │                │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                │
│          │                 │                 │                        │
└──────────┼─────────────────┼─────────────────┼────────────────────────┘
           │   Tauri invoke │                 │
           │  + emit stream │
┌──────────▼─────────────────▼─────────────────▼────────────────────────┐
│                                                                        │
│                            Tauri 命令层                                │
│                                                                        │
│   commands/ai.rs    commands/agent.rs    commands/chat.rs              │
│                                                                        │
└──────────┬─────────────────┬─────────────────┬────────────────────────┘
           │                 │                 │
           ▼                 ▼                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │                                                               │   │
│   │                  ✦ AGENT HARNESS (执行层) ✦                  │   │
│   │                                                               │   │
│   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │   │
│   │   │  State   │  │   Plan   │  │  Tool    │  │  Event   │     │   │
│   │   │  Store   │◄─┤ Executor ├─►│ Registry │◄─┤  Bridge  │     │   │
│   │   └──────────┘  └────┬─────┘  └────┬─────┘  └──────────┘     │   │
│   │         ▲            │             │                          │   │
│   │         │            ▼             │                          │   │
│   │   ┌─────┴─────┐ ┌──────────┐      │                          │   │
│   │   │   ReAct   │ │  Budget  │      │                          │   │
│   │   │  State    │ │  Tracker │      │                          │   │
│   │   │  Machine  │ └──────────┘      │                          │   │
│   │   └───────────┘                   │                          │   │
│   │                                   │                          │   │
│   └───────────────────────────────────┼──────────────────────────┘   │
│                                       │                              │
│                                       ▼                              │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │                                                               │   │
│   │                ✦ GUARDRAILS HARNESS (护栏层) ✦               │   │
│   │                                                               │   │
│   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │   │
│   │   │  Input   │  │  Output  │  │ Approval │  │  Sandbox │     │   │
│   │   │ Filter   │  │ Filter   │  │  (HITL)  │  │  (资源)  │     │   │
│   │   └──────────┘  └──────────┘  └──────────┘  └──────────┘     │   │
│   │         ▲            ▲             ▲            ▲            │   │
│   │         │            │             │            │            │   │
│   │   ┌─────┴────────────┴─────────────┴────────────┴────┐       │   │
│   │   │          Guardrails 中间件链 (洋葱模型)           │       │   │
│   │   │  redact → validate → cap_check → budget_check   │       │   │
│   │   └──────────────────────────────────────────────────┘       │   │
│   │                                                               │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                       │                              │
│                                       ▼                              │
│   ┌───────────────────────────────────────────────────────────────┐   │
│   │                                                               │   │
│   │              ✦ EVALUATION HARNESS (评估层) ✦                 │   │
│   │                                                               │   │
│   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │   │
│   │   │ Dataset  │  │  Runner  │  │  Judge   │  │  Report  │     │   │
│   │   │ (JSONL)  │  │  (CI)    │  │(LLM-as-J)│  │  (HTML)  │     │   │
│   │   └──────────┘  └──────────┘  └──────────┘  └──────────┘     │   │
│   │                                                               │   │
│   └───────────────────────────────────────────────────────────────┘   │
│                                                                        │
└──────────┬─────────────────────────────────────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         LLM Provider 层 (现有)                         │
│   OpenAI / Anthropic / Gemini / DeepSeek / Moonshot / Zhipu / 兼容协议 │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. 三层职责划分

### Agent Harness (执行层) — 核心是"ReAct 状态机 + 工具调用编排"

**职责**:
- **状态外化**: 把 agent 运行时的 messages / tool_calls / 步骤进度从易失上下文剥离, 持久化到 SQLite (`agent_runs` / `agent_steps` / `agent_tool_calls` 三表)
- **任务编排**: 显式 ReAct 状态机 (Plan → Act → Observe → Reflect), 支持步骤依赖、并行工具、超时取消
- **工具调用**: 统一 `trait Tool` + `ToolRegistry`, 30 个 eaa_tools 改为 30 个 impl
- **流式推送**: EventBridge 把 StreamEvent + ReAct 状态变更 emit 给前端

**绝不负责** (职责边界):
- ❌ 不做 PII 检测 / 脱敏 (那是 Guardrails 的)
- ❌ 不做评分 / 评测 (那是 Evaluation 的)
- ❌ 不直接调 LLM Provider (它通过 LLM Service 的"单步 stream_chat"接口)

### Guardrails Harness (护栏层) — 核心是"洋葱模型中间件链"

**职责**:
- **输入过滤**: 用户 prompt 进 LLM 前, 脱敏 PII / 检测恶意指令 / 限长
- **输出过滤**: LLM 流式文本回来后, 还原脱敏 / 检测有害内容 / 拦截越权指令
- **工具调用前置钩子**: 参数校验 (data-validation) + capability 检查 (least-privilege) + 预算检查 (max_rounds/max_tokens)
- **Human-in-the-Loop**: 写操作 (add_event / delete_student / write_file) 冻结等用户确认
- **沙箱**: 工具执行的资源限制 (CPU/内存/时间), 通过 OS 进程隔离

**绝不负责**:
- ❌ 不编排任务 (那是 Agent 的)
- ❌ 不评分 (那是 Evaluation 的)
- ❌ 业务逻辑不参与, 只做"在 / 不在 / 改 / 等"

### Evaluation Harness (评估层) — 核心是"可重复执行的回归测试"

**职责**:
- **业务级评测集**: `eval/datasets/*.jsonl`, 每条包含 `input` / `expected_tool_calls` / `expected_output`
- **CI 集成**: GitHub Actions 工作流, 跑 eval, 得分低于阈值阻断合并
- **LLM-as-a-Judge**: 用 GPT-4 给开放性生成打分, 输出结构化理由 (reasoning + score + pass/fail)
- **退化捕获**: 对比两个 commit 的 eval 报告, 自动标注回归项

**绝不负责**:
- ❌ 不参与运行时 (eval 是离线 CI 跑, 不进生产代码)
- ❌ 不改业务逻辑 (只读 + 评分)

## 3. 完整数据流 (Mermaid)

### 3.1 运行时数据流: 用户操作 → AI 响应

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant FE as 前端 (React)
    participant CMD as Tauri Command
    participant AH as Agent Harness
    participant GR as Guardrails Harness
    participant LLM as LLM Service
    participant TR as Tool Registry
    participant TOOL as Tool Impl
    participant DB as SQLite
    participant EV as Evaluation (CI)

    User->>FE: 输入 "把张三月考扣 5 分"
    FE->>CMD: invoke('agent_run_manual', {...})
    CMD->>AH: run(agent_id, prompt, history)

    rect rgba(255, 200, 200, 0.3)
    Note over AH,GR: === Guardrails 输入过滤 ===
    AH->>GR: filter_input(prompt)
    GR->>GR: anonymize(PII)
    GR->>GR: length_check
    GR->>GR: injection_detect
    GR-->>AH: sanitized_prompt
    end

    AH->>DB: insert_execution(agent_id, status=Running)
    AH->>AH: build_system_prompt(SOUL + Rules + caps + skills)

    loop ReAct 循环 (max_rounds=8)
        AH->>LLM: stream_chat(messages, params)
        LLM-->>AH: StreamEvent::TextDelta{...}

        alt LLM 请求工具
            LLM-->>AH: StreamEvent::ToolcallStart{name="add_event"}
            AH->>TR: get(name).check_cap(agent_caps)
            TR-->>AH: Tool { name, schema, is_write=true }

            rect rgba(255, 200, 100, 0.3)
            Note over AH,GR: === Guardrails 工具前置 ===
            AH->>GR: pre_tool_hook(name, args, caps, budget)
            GR->>GR: validate_args(schema)
            GR->>GR: capability_check
            GR->>GR: budget_check(rounds/tokens)
            alt 写操作 → 需 HITL
                GR-->>AH: PendingApproval { reason="write_op" }
                AH->>FE: emit('agent:approval_request', {tool, args})
                FE->>User: 弹出审批对话框
                User->>FE: 确认 / 拒绝
                FE->>AH: resolve_approval(approved)
            end
            GR-->>AH: Approved
            end

            AH->>TR: dispatch(name, args)
            TR->>TOOL: tool_add_event(args)
            TOOL->>DB: write events.json (under FileLock)
            TOOL-->>TR: Result::Ok({event_id})
            TR-->>AH: ToolResult{...}

            rect rgba(200, 255, 200, 0.3)
            Note over AH,GR: === Guardrails 输出过滤 ===
            AH->>GR: post_tool_hook(result)
            GR->>GR: redact_log(result)
            end

            AH->>DB: insert_tool_call(step_id, name, args, result)
            AH->>FE: emit('agent:status-update', {step, tool, result})
        else LLM 输出最终文本
            LLM-->>AH: StreamEvent::Done
        end
    end

    rect rgba(200, 200, 255, 0.3)
    Note over AH,GR: === Guardrails 输出过滤 ===
    AH->>GR: filter_output(final_text)
    GR->>GR: deanonymize(PII)
    GR->>GR: harmful_content_check
    GR-->>AH: final_text
    end

    AH->>DB: update_execution(status=Success, usage)
    AH->>FE: emit('agent:status-update', {status: Success, text})
    AH-->>CMD: Result<RunSummary>
    CMD-->>FE: invoke 返回
    FE-->>User: 显示 AI 回复
```

### 3.2 状态机: ReAct 循环

```mermaid
stateDiagram-v2
    [*] --> Init: run() 开始

    Init --> Plan: 构建 system prompt
    Plan --> Plan: 读 SOUL/Rules/Caps

    Plan --> Act: 进入 ReAct 循环
    Act --> StreamLLM: LLM 流式生成
    StreamLLM --> ParseDelta: 累积 ToolCall args

    ParseDelta --> StreamLLM: 还在收 delta
    ParseDelta --> Decision: 本轮收敛

    Decision --> ToolCall: LLM 请求工具
    Decision --> Reflect: LLM 直接输出文本

    ToolCall --> GuardrailsPre: pre_tool_hook
    GuardrailsPre --> HITL: 写操作
    GuardrailsPre --> Execute: 只读 / 低危

    HITL --> Execute: 用户确认
    HITL --> Aborted: 用户拒绝
    HITL --> Timeout: 超时 (默认 30s)

    Execute --> ToolResult: dispatch(name, args)
    ToolResult --> GuardrailsPost: post_tool_hook
    GuardrailsPost --> RecordStep: insert_tool_call
    RecordStep --> BudgetCheck: 检查 rounds/tokens

    BudgetCheck --> Aborted: 超预算
    BudgetCheck --> Act: 继续下一轮

    Reflect --> FinalAnswer: LLM 输出 final
    FinalAnswer --> GuardrailsOut: filter_output
    GuardrailsOut --> Persist: update_execution
    Persist --> [*]: 完成

    Aborted --> Persist: status=Aborted
    Persist --> [*]
```

### 3.3 评估流 (CI 离线)

```mermaid
flowchart LR
    A[eval/datasets/*.jsonl] --> B[Eval Runner<br/>cargo run --bin eval-runner]
    B --> C[遍历 dataset<br/>每条 case]
    C --> D[启动 sandbox<br/>fresh eaa-data]
    D --> E[调用 Agent Harness<br/>同生产代码路径]
    E --> F[收集 trace<br/>steps / tool_calls / output]
    F --> G[对比 expected]

    G --> H{确定性检查<br/>expected_tool_calls match?}
    H -->|Yes| I[pass +1]
    H -->|No| J[fail +1]

    G --> K{开放性输出<br/>有 expected_output?}
    K -->|Yes| L[LLM-as-a-Judge<br/>GPT-4 评分]
    K -->|No| M[跳过]

    L --> N{Judge score >= 0.7?}
    N -->|Yes| I
    N -->|No| J

    I --> O[汇总]
    J --> O
    M --> O
    O --> P[生成 report.html<br/>+ report.json]
    P --> Q{pass_rate >= 阈值?}
    Q -->|Yes| R[CI 绿]
    Q -->|No| S[CI 红<br/>阻断合并]
```

## 4. 关键边界约束 (防越界)

| 层 | 可以调用 | 严禁调用 |
|:---|:---------|:---------|
| **Agent Harness** | LLM Service (单步 stream_chat)、Tool Registry、Guardrails 中间件、State Store、DB | LLM Provider 直接 API、Tool impl 直接函数 (必须经 Registry) |
| **Guardrails Harness** | PrivacyEngine、keystore (读 API key 元数据)、data-validation crate、OS 进程 API (沙箱) | 业务逻辑 (例如 add_event 的 reason_code 白名单)、Tool Registry 之外的工具 |
| **Evaluation Harness** | Agent Harness 公共 API (同生产路径)、LLM Provider (Judge 用) | 写业务数据 (只读 sandbox)、修改 prod DB |

## 5. 阶段二作战计划 (预览)

基于蓝图, 阶段二要做:

### 新增文件
- `src-tauri/src/harness/mod.rs` — Harness 模块根
- `src-tauri/src/harness/agent/mod.rs` — Agent Harness 主入口
- `src-tauri/src/harness/agent/state_store.rs` — 状态外化
- `src-tauri/src/harness/agent/react_machine.rs` — ReAct 状态机
- `src-tauri/src/harness/tools/mod.rs` — Tool trait + Registry
- `src-tauri/src/harness/tools/registry.rs`
- `src-tauri/src/harness/event_bridge.rs`
- `src-tauri/src/harness/error.rs`

### 修改文件
- `services/llm_service.rs` — **删除** `stream_chat_with_tool_loop`, 只保留单步 `stream_chat`
- `services/agent_runner.rs` — **瘦身为 ~80 行**, 调 `AgentHarness::run()`
- `tools/eaa_tools.rs` — **30 个 tool_xxx 改为 30 个 impl Tool**
- `tools/file_tools.rs`, `tools/utility.rs` — 同上
- `state.rs` — 加 `harness: Arc<AgentHarness>`

### 评估指标
- `agent_runner.rs` 从 290 行降到 ≤ 80 行
- `eaa_tools.rs` 不再有顶层 `match` (30 行分发 → 0)
- 新增集成测试: `tests/harness_react_loop.rs`, 跑通一个 add_event 用例

## 6. 风险与回退策略

| 风险 | 影响 | 回退策略 |
|:-----|:-----|:---------|
| 工具循环上移到 Harness 后, 性能下降 | LLM 单步调用 overhead | 保留 `stream_chat` 内部 mini-loop 路径, Harness 通过 `optimization_hint` 启用 |
| Tool trait 引入破坏现有 30 个工具 | 编译失败 | 一次性迁移 + 集成测试覆盖, commit 颗粒度小 |
| 状态外化增加 IO | agent 启动变慢 | L0 内存态保留, 只在 step 边界落 DB |

---

**下一步**: 阶段二实施 (用户批准后开始)