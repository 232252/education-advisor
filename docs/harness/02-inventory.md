# 阶段一·现状测绘 - AI 基础设施清单

> 测绘日期: 2026-06-16
> 测绘范围: `src-tauri/src/**` 全部 9 个 AI 相关文件 + 工具模块 + 全局状态
> 测绘方法: 实读 `*.rs`, grep `#[tauri::command]` / `pub fn` / `pub struct` / `impl`, 交叉对照调用链

## 1. 模块拓扑

```
┌────────────────────────────────────────────────────────────────────────┐
│                            Tauri 2.0 命令层                            │
│  commands/ai.rs (324L)  commands/agent.rs (157L)  commands/chat.rs(88L)│
│  commands/eaa.rs (516L)  commands/skill.rs       commands/privacy.rs   │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ invoke() / emit()
┌──────────────────────────────▼─────────────────────────────────────────┐
│                       业务编排层 (耦合最重)                            │
│  services/agent_runner.rs (333L) ← 290 行的胖 run() 函数             │
│  services/llm_service.rs  (1104L) ← 含 stream_chat_with_tool_loop    │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────────┐
│                         工具与数据层                                   │
│  tools/eaa_tools.rs (1064L) ← 大 match 分发, 无 trait                 │
│  tools/file_tools.rs (84L)  tools/utility.rs (329L)                  │
│  services/db.rs (462L) ← SQLite 持久化                                │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────────┐
│                          全局状态层                                    │
│  state.rs (154L) ← AppState 单一容器, 13 个 Arc 字段                  │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. AI 相关文件清单 (按职责)

| 文件 | 行数 | 职责 | 关键 trait/struct | 暴露的 Tauri cmd |
|:-----|:----:|:-----|:-----------------|:----------------|
| `services/llm_service.rs` | 1104 | LLM 协议适配 + 工具循环 | `LlmService`, `SharedLlm`, `StreamEvent` | (无,被 ai.rs / agent_runner 调) |
| `services/agent_service.rs` | 293 | agent 注册表 + SOUL/Rules | `AgentService`, `ModelTier`, `AgentEntry` | (无,被 commands/agent.rs 调) |
| `services/agent_runner.rs` | 333 | agent 执行编排 (胖函数) | (无 struct, 两个 pub fn) | (无) |
| `services/skill_service.rs` | 289 | skill 注册表 (Markdown) | `SkillService`, `Skill` | (无) |
| `services/broadcaster.rs` | 37 | 事件 emit 封装 | (无 struct) | (无) |
| `services/redaction_layer.rs` | 92 | tracing 日志脱敏 | `RedactionLayer`, `RedactingMakeWriter` | (无) |
| `commands/ai.rs` | 324 | 11 个 ai:* command | (无 struct, 命令函数) | `ai_chat`, `ai_chat_abort`, `ai_*_model/provider` |
| `commands/agent.rs` | 157 | agent:* command | (无 struct) | `agent_run_manual`, `agent_get_*`, `agent_*_history` |
| `commands/chat.rs` | 88 | chat:* command | `SaveMsgArgs` | `chat_save_message`, `chat_load_messages` |
| `tools/eaa_tools.rs` | 1064 | 工具分发 (~30 个 tool) | (无 trait, 大 match) | (无) |
| `tools/file_tools.rs` | 84 | 路径白名单 IO | (无 struct) | (无) |
| `tools/utility.rs` | 329 | 表达式求值 | (无 struct) | (无) |
| `state.rs` | 154 | 全局状态容器 | `AppState`, `Paths` | (无) |

## 3. 已识别的耦合点 (按严重度排序)

### 🔴 P0 严重耦合

**1. `stream_chat_with_tool_loop` 的 `exec_tool` 闭包参数** (`llm_service.rs` L431-543)
- **问题**: LLM 适配层承担了"工具循环编排"(收集 ToolCall → 执行 → 回喂 tool 角色 message → 下一轮),这本是 agent harness 的职责
- **影响**: 任何业务工具改动都要进 llm_service;无法独立测试循环逻辑
- **Harness 化方案**: 把循环上移到 `AgentHarness`, LLM service 只暴露单步 `stream_chat`

**2. 工具结果错误判定靠字符串前缀** (`llm_service.rs` L530)
- **代码**: `exec_result.starts_with("{\"error\":")`
- **问题**: LLM 层对工具返回格式的隐式假设, 契约脆弱
- **Harness 化方案**: 引入 `trait Tool`, 错误用 `Result<Value, ToolError>`, 不要靠字符串拼接

**3. 隐私脱敏在两处重复实现**
- `commands/ai.rs::ai_chat` (L254-266)
- `services/agent_runner.rs::run` (L158-168)
- **问题**: 横切关注点被复制粘贴, 改一处忘另一处的风险高
- **Harness 化方案**: 抽 `RedactionMiddleware` 中间件, 统一在消息进 LLM 前过

### 🟡 P1 设计缺口

**4. `LlmService.custom_models` 无持久化** (`llm_service.rs`)
- **问题**: 进程重启即失
- **Harness 化方案**: 跟随 settings service 的 SQLite 持久化

**5. 写工具判定靠硬编码字符串列表** (`agent_runner.rs`)
- **代码**: `matches!(short, "add_event"|"add_student"|...)`
- **问题**: 新增写工具易漏, 事件不广播 → 前端不会刷新
- **Harness 化方案**: `trait Tool { fn is_write(&self) -> bool; }`, 工具自报家门

**6. `RedactionLayer` 已定义但未接线**
- **问题**: `main.rs` 里 `.with(RedactionLayer)` 没命中 (grep 全项目只有定义, 无注册)
- **影响**: 用户的 API key / 个人信息可能直接落到日志
- **Harness 化方案**: 阶段三必须补上注册

**7. 工具循环无 budget 控制**
- **代码**: `max_rounds = 8` 硬编码, 无 token/cost 预算
- **问题**: 用户被恶意 prompt 引导循环消耗, 静默
- **Harness 化方案**: 引入 `BudgetGuardrail` (max_rounds + max_tokens + max_cost_usd)

### 🟢 P2 一致性

**8. `data_changed` 判定逻辑分散**
- **问题**: 在 `agent_runner.rs` 里硬编码工具名列表
- **Harness 化方案**: `ChangeNotifier` 由 `ToolRegistry` 跟踪

**9. `broadcaster::emit_all` 没人用, `app.emit` 直接调**
- **问题**: 抽象与实际调用不一致, 维护混乱
- **Harness 化方案**: `EventBridge` 统一, 干掉 `app.emit` 直接调用

## 4. 状态分层现状

| 层级 | 内容 | 持久化 | 当前位置 |
|:-----|:-----|:-------|:--------|
| L0 进程内存 | `active_streams`, `LlmService.custom_models`, `AgentService.last_run` | ❌ 无 | `AppState` |
| L1 文件 | `config/agents.yaml`, `agents/<id>/SOUL.md`, `skills/*.md`, `eaa-data/*.json` | ✅ | `AppState` 字段 + 文件 IO |
| L2 SQLite | `ea.db` (对话消息, agent 执行历史, cron 日志) | ✅ | `services/db.rs` |
| L3 系统 | OS keychain (API key) | ✅ | `keystore_service` |

**缺口**: 跨重启的**对话/任务状态外化**(Harness 化的核心目标之一)目前是 chat 消息持久化在 SQLite, 但**任务进度 / 中间 tool_calls / ReAct 步骤**完全没有持久化 — 一旦 agent_runner 中途崩溃, 用户重连看不到"刚才走到哪一步了"。

## 5. 现有工具清单 (eaa_tools.rs)

约 30 个工具, 按类别分:
- **只读类** (12个): `score`, `history`, `ranking`, `stats`, `codes`, `search`, `list_students`, `summary`, `range`, `academic_get`, `profile_get`
- **写操作类** (15个): `add_event`, `add_student`, `revert_event`, `academic_add`, `profile_set`, `delete_student`, `delete_by_class`, `reset_events`, `reset_factory`, `bulk_add_*`
- **快照版**: `tool_*_snap` (配合 DataCache 优化)
- **辅助** (file_tools, utility): `read_file`, `write_file`, `list_dir`, `calculate`, `get_current_time`

**统一 trait 缺失**: 30 个工具以 `match short => tool_xxx(args)` 大分发, 无 `trait Tool`, 无 JSON Schema, 无 capability 标注, 无 `is_write()` 标记。

## 6. 现有 LLM 协议适配

3 套协议适配器, 统一产 `StreamEvent`:
- `stream_openai` — 覆盖 openai/deepseek/moonshot/zhipu/doubao/qwen/mistral/ollama/lmstudio/openai-compatible (用 `provider_base_url` 表切 baseUrl)
- `stream_anthropic`
- `stream_gemini`

StreamEvent tagged enum:
```
Start | TextStart | TextDelta | ToolcallStart | ToolcallDelta | 
ReasoningStart | ReasoningDelta | ToolResult | Done | Error | Aborted
```

事件契约稳定, 是阶段五前端集成 "应用状态即上下文" 的好基础。

## 7. 结论: 阶段二~五的优先级

基于耦合点分析, 我建议的优先级:
1. **阶段二** (Agent Harness 强化): 先做 **P0-1 + P0-2** — 把工具循环从 LlmService 上移, 引入 trait Tool
2. **阶段三** (Guardrails): 先做 **P0-3 + P1-6** — 统一脱敏 + 补全日志脱敏注册 + Human-in-the-Loop 审批
3. **阶段四** (Evaluation): 工具循环上移后, 加 LLM-as-a-Judge 才有干净接口可评
4. **阶段五** (深度融合): Skill 系统、上下文感知 Prompt、跨会话记忆 — 在前三阶段稳定后再做

---
**下一步**: 阶段一·架构蓝图 → `01-architecture.md`