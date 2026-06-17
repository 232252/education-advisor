# AI 基础设施现状诊断（Harness Audit）

**项目**: Education Advisor v0.2.0-rc.1  
**审计时间**: 2026-06-16  
**审计目标**: 梳理当前 LLM 调用、上下文管理、工具调用实现，识别与业务逻辑的耦合点，为 Harness 化重构提供基线。

---

## 1. LLM 调用链路

```
前端 ChatPage / AgentsPage
    │ invoke('ai:chat') 或 agent:run-manual
    ▼
commands::ai::ai_chat  /  commands::agent::agent_run_manual
    │
    ├─ 直接聊天: llm_service::LlmService::stream_chat
    └─ Agent 运行: services::agent_runner::run
                    └─ harness::agent::AgentHarness::run
                        └─ llm_service::stream_chat
    ▼
reqwest + SSE parser
    ▼
Provider adapters (OpenAI-compatible / Anthropic / Gemini)
    ▼
统一 StreamEvent 枚举
    ▼
EventEmitter → 前端 ai:chat-stream / agent:status-update
```

### 1.1 关键文件

| 文件 | 职责 |
|------|------|
| `src-tauri/src/services/llm_service.rs` | Provider 注册表、SSE 解析、`StreamEvent` 统一输出、abort 控制。 |
| `src-tauri/src/commands/ai.rs` | `ai_chat`、`ai_chat_abort` 等 command。 |
| `src-tauri/src/commands/agent.rs` | `agent_run_manual`、`agent_abort`、`agent_approval_resolve` 等。 |
| `src-tauri/src/services/agent_runner.rs` | Agent 执行入口，装配 `AgentHarness`。 |

### 1.2 现状评价

- ✅ 已支持 30+ provider，通过 OpenAI-compatible 通用通道覆盖主流模型。
- ✅ 流式输出统一为 `StreamEvent`，前端只需处理一种事件格式。
- ✅ Abort 通过 `CancellationToken` 实现。
- ⚠️ LLM 调用与业务逻辑存在间接耦合：AgentHarness 直接调用 `llm_service`，但模型选择、api_key 解析仍散落在 Harness 内部。
- ⚠️ 重试/降级策略在 `llm_service.rs` 中不完整，需强化。

---

## 2. 上下文管理

### 2.1 当前实现

- **对话上下文**：`Vec<ChatMessage>` 在 `AgentHarness::react_loop` 中累积，包含 system/user/assistant/tool 消息。
- **工具结果回喂**：通过 `ReActMachine::build_tool_result_message` 构造 `role=tool` 消息，content 格式为 `"<tool_call_id>:::<json>"`。
- **运行状态外化**：`StateStore` 持久化到 SQLite 的 `agent_runs` / `agent_run_steps` / `agent_run_tool_calls` 表。
- **长期记忆**：❌ 当前无跨会话记忆；每次 run 从 `history` 参数取上文，重启后清空。
- **应用状态注入**：❌ System Prompt 仅包含 SOUL.md + AGENTS.md + skills + tool 描述，未注入当前页面/选中实体等动态上下文。

### 2.2 状态外化矩阵

| 状态类型 | 存储位置 | 生命周期 | 完整度 |
|----------|----------|----------|--------|
| 对话消息 | 内存 `Vec<ChatMessage>` | 单次 run | 60% |
| 运行元数据 | SQLite `agent_runs` | 永久 | 90% |
| ReAct 步骤 | SQLite `agent_run_steps` | 永久 | 90% |
| 工具调用记录 | SQLite `agent_run_tool_calls` | 永久 | 90% |
| 用户偏好/记忆 | ❌ 未实现 | — | 0% |
| 应用运行时上下文 | ❌ 未注入 | — | 0% |

---

## 3. 工具调用

### 3.1 双路径现状

项目存在两套工具实现：

1. **旧路径**：`src-tauri/src/tools/eaa_tools.rs::dispatch_cached()`
   - 被 `eaa:*` command 直接调用。
   - 使用 `is_allowed()` 做 capability 别名展开（`read`/`write`/`academic`/...）。
   - 同步执行，带 `DataCache`。

2. **Harness 路径**：`src-tauri/src/harness/tools/`
   - `ToolRegistry` + `eaa_bridge.rs` 生成 25+ Tool impl。
   - 使用命名空间 capability（`read:scores`/`write:events`/...）。
   - 异步 trait，支持 Guardrails 钩子。

### 3.2 耦合点

- `eaa_bridge.rs` 内部仍调用 `eaa_tools::dispatch_cached`，即 Harness 路径底层复用旧路径的实现。
- Capability 语义不一致已在本轮修复（新增 `harness/tools/capability.rs::expand_capabilities`）。

### 3.3 工具能力清单

| 类别 | 数量 | 代表工具 |
|------|------|----------|
| EAA 只读 | 11 | get_score / get_history / get_ranking / get_stats / search / list_students / ... |
| EAA 写入 | 11 | add_event / add_student / revert_event / academic_add / delete_student / reset_factory / ... |
| 文件/实用 | 4 | read_file / write_file / list_dir / calculate |

---

## 4. 安全与护栏

### 4.1 Guardrails Harness

已实现的护栏模块：

| 模块 | 文件 | 功能 |
|------|------|------|
| Input Filter | `harness/guardrails/input_filter.rs` | Prompt 注入检测、PII 过量检测、密钥泄露检测。 |
| Output Filter | `harness/guardrails/output_filter.rs` | JSON Schema 校验、结果截断、PII 反向脱敏检测。 |
| HITL | `harness/guardrails/hitl.rs` | 人类审批命令总线、风险等级、决策记录。 |
| Sandbox | `harness/guardrails/sandbox.rs` | 路径白名单、args/result 大小限制。 |

### 4.2 现状评价

- ✅ Guardrails Pipeline 已在 `AgentHarness::react_loop` 的三个钩子点接入。
- ⚠️ HITL 审批请求尚未推送到前端 UI（缺少前端弹窗）。
- ⚠️ Guardrails block 事件未向前端 emit，用户看不到拦截原因。
- ⚠️ Sandbox 缺少超时 kill 机制。

---

## 5. 评估体系

### 5.1 已存在组件

| 组件 | 文件 | 状态 |
|------|------|------|
| Dataset | `harness/eval/dataset.rs` | ✅ 加载 JSONL，支持分类与唯一性校验。 |
| Judge | `harness/eval/judge.rs` | ⚠️ 接口完整，`LlmJudgeClient` 未接入真实 LLM。 |
| Scorer | `harness/eval/scorer.rs` | ✅ 工具调用匹配、PII 泄露、预算、Schema 校验。 |
| Runner | `harness/eval/runner.rs` | ✅ 聚合 scorer + judge，生成报告。 |
| Report | `harness/eval/report.rs` | ✅ JSON/HTML 报告。 |

### 5.2 已存在数据集

- `privacy.jsonl`
- `safety.jsonl`
- `task_completion.jsonl`
- `tool_correctness.jsonl`

### 5.3 缺口

- 缺少教育业务专属数据集（操行分录入、周报、风险预警）。
- 未接入 CI/GitHub Actions 及格线。
- `eval_runner.rs` 命令行参数不完整。

---

## 6. 与业务逻辑的耦合点

| 耦合点 | 说明 | 解耦建议 |
|--------|------|----------|
| EAA 数据引擎 | Agent 工具直接读写学生/事件数据 | 已通过 ToolRegistry 抽象，保持 |
| 隐私引擎 | `AgentHarness` 在 LLM 输入前做 anonymize | 应在 Guardrails InputFilter 中统一处理 |
| Feishu | 独立 service，未经过 Harness | 可作为 Skill/Tool 注册给 Agent |
| 设置服务 | `AgentHarness` 解析 model tier 时读取 settings | 抽出 `ModelResolver` service |
| 前端 chatStore | 直接消费 `StreamEvent` | 保持不变，事件契约稳定 |

---

## 7. 本轮修复项（Phase 0）

- ✅ Windows 平台焦点修复模块 `src-tauri/src/platform/`。
- ✅ Capability 别名展开 `harness/tools/capability.rs`。
- ✅ 不稳定测试 `uuid_v4_short` 固定 8 字符。
- ✅ 补齐 `IPC_COMPLIANCE_READ_AUDIT` 常量。

---

## 8. 下一轮重点（Phase 2-5）

1. **Agent Harness 强化**：Reflect 阶段、并行工具调用、超时/重试/降级。
2. **Guardrails 完善**：HITL UI、block 事件 emit、Sandbox 超时。
3. **Evaluation 集成**：业务数据集、CI 及格线、真实 LLM Judge。
4. **深度融合**：上下文感知 prompt、skill tools、跨会话记忆。
