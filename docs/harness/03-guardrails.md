# 阶段三·Guardrails Harness - 守护层设计与实现

> 实现日期: 2026-06-16
> 适用代码: `src-tauri/src/harness/guardrails/{mod,input_filter,output_filter,hitl,sandbox}.rs`
> 测试覆盖: 4 个子模块 35 单元测试 + `tests/guardrails_integration.rs` 23 集成测试, 全部 58/58 通过
> 关联文档: [`01-architecture.md`](01-architecture.md) §3 数据流 / [`02-inventory.md`](02-inventory.md) §3.3 已识别问题

---

## 1. 设计动机

阶段二 (`harness/agent/`) 把 agent 编排为显式 ReAct 状态机, 但 **agent 自身仍是"会犯错的 LLM"**:

1. **输入不可信**: 用户 prompt 可能含 PII (身份证/手机号), 也可能含 prompt-injection
2. **工具调用不可信**: LLM 生成的参数可能越权 (虽然 capability 已有第一道关)
3. **写操作不可逆**: 一次失误的 `reset_factory` / `delete_by_class` 把整个数据集清空
4. **输出可能含泄密 token**: LLM 收到的 prompt 已被脱敏为 `[PII_xxx]`, 但返回值可能把原始数据偷偷塞回

阶段三引入 **Guardrails Harness**, 在 ReAct 循环的 3 个关键路径上挂守护链, 全部短路, 第一道 Block 立即终止, 失败时把 `HarnessError::GuardrailBlocked` 抛给 `react_loop`, 由状态机降级为 `status=aborted` 并写入 DB。

---

## 2. 整体架构

```
                    ┌──────────────────────┐
                    │  AgentHarness        │
                    │  react_loop()        │
                    └──────────┬───────────┘
                               │ 每轮
                               ▼
       ┌───────────────────────────────────────────────────────┐
       │              GuardrailPipeline::standard()            │
       │  顺序短路, 第一个 Block 立即终止                        │
       └───────────────────────────────────────────────────────┘
            │            │              │              │
            ▼            ▼              ▼              ▼
   ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
   │ 1.Input    │ │ 2.Sandbox  │ │ 3.HITL     │ │ 4.Output   │
   │   Filter   │ │ (资源)     │ │ (命令总线) │ │   Filter   │
   └────────────┘ └────────────┘ └────────────┘ └────────────┘
       │              │              │              │
       │              │              │ oneshot       │
       │              │              ▼              │
       │              │       ApprovalChannel      │
       │              │       ├─ HitlPolicy        │
       │              │       ├─ emit Tauri event  │
       │              │       └─ wait resolve cmd  │
       │              │              │              │
       │              │              ▼              │
       │              │       前端 UI 对话框         │
       │              │       用户点 批准/拒绝/编辑  │
       │              │              │              │
       │              │              ▼              │
       │              │       agent_approval_resolve│
       │              │              │              │
       │              └──────────────┴──────────────┘
       │                              │
       ▼                              ▼
   PII 脱敏                      schema 校验
   injection 拦截                截断
   secret 字段拦截               PII 反向脱敏
```

---

## 3. 三个钩子点 (`GuardrailHook`)

| 钩子 | 触发时机 | 守护内容 | 文件位置 |
|:-----|:---------|:---------|:---------|
| `LlmInput` | ReAct 循环每次 LLM 调用前 | PII 脱敏 + injection 拦截 + 长度限制 | `react_loop` L#85 (构建 messages JSON 后) |
| `ToolCall` | `ToolRegistry::get_checked` 之后, `checked.call()` 之前 | args 校验 + 资源限制 + HITL 审批 | `react_loop` L#135 |
| `ToolResult` | `checked.call()` 返回后, 回写 messages 前 | schema 校验 + 截断 + PII 反向脱敏 | `react_loop` L#165 |

**核心数据结构** (`guardrails/mod.rs`):

```rust
pub enum GuardrailAction {
    Allow,
    AllowWith { reason: String, redactions: usize },  // 已改写
    Block { reason: String, severity: Severity, evidence: Option<String> },
}

pub struct GuardrailContext<'a> {
    pub run_id: &'a str,
    pub agent_id: &'a str,
    pub tool: Option<&'a str>,
    pub kind: GuardrailHook,
    pub data: &'a mut Value,                       // 待检查/可改写
    pub meta: &'a mut HashMap<String, Value>,      // 携带 capability / risk / schema
}
```

**短路语义**: `GuardrailPipeline::check_*` 顺序遍历, 遇到第一个 `Block` 立即返回 `HarnessError::GuardrailBlocked { guardrail, hook, reason }`, 不继续后续守卫。

---

## 4. 四个守护者

### 4.1 InputFilter — 输入脱敏与拦截

**文件**: `src/harness/guardrails/input_filter.rs`  (~280 行, 6 单元测试)

**双引擎**:
- `log_redact::SensitiveRedactor` (细粒度模式匹配: 身份证/手机/银行卡/邮箱)
- `eaa_core::privacy::PrivacyEngine` (PII token 替换为 `[PII_xxx]`, 保留可还原性)

**两个公开方法**:

```rust
/// 扫描用户 prompt + 历史 messages
pub async fn check_input(&self, ctx: &mut GuardrailContext<'_>)
    -> HarnessResult<GuardrailAction>;

/// 扫描工具调用 args (防止 secret/password/api_key 字段带明文)
pub async fn check_tool_call(&self, ctx: &mut GuardrailContext<'_>)
    -> HarnessResult<GuardrailAction>;
```

**判定矩阵**:

| 输入情况 | verdict | 后续动作 |
|:---------|:--------|:---------|
| 干净文本 | `Pass` | 放行 |
| 含 PII 但 < `max_pii` (默认 5) | `Redacted { tokens }` | 用 `[PII_xxx]` 替换, `AllowWith` |
| 含 PII 但 >= `max_pii` | `Blocked` | 提示"输入含过多敏感信息" |
| 含 9 类 prompt-injection 模式 | `Blocked { reason }` | 立即终止 |
| 工具 args 含 `password` / `api_key` / `token` / `secret` 字段 | `Blocked` | 拦截 |

**默认 injection 模式** (`default_injection_patterns`):
```
"ignore (previous|above|all) (instruction|prompt)"
"you are now (a|an) (DAN|jailbroken|admin)"
"drop table", "truncate table", "rm -rf"
"system:" 前缀注入
"<\|im_start\|>", "<\|im_end\|>" token 注入
"forget everything", "disregard safety"
```

**示例输出** (审计日志):
```json
{
  "verdict": "redacted",
  "pii_count": 3,
  "tokens": ["[PII_1]", "[PII_2]", "[PII_3]"],
  "evidence": "用户输入含 3 处 PII, 已脱敏"
}
```

---

### 4.2 OutputFilter — 输出反向脱敏与校验

**文件**: `src/harness/guardrails/output_filter.rs` (~310 行, 7 单元测试)

**职责** (与 InputFilter 严格对称):
- 工具返回值中的 `[PII_xxx]` token **反查** `PrivacyEngine`, 还原成原始值 (给前端展示)
- 对写操作 (add_event/delete_student 等) 强制做 **JSON schema 校验**, 缺字段即 Block
- 单条返回值超 `max_result_bytes` (默认 1MB) → 截断到 `max_truncated_bytes` (64KB) + `AllowWith`

**关键 API**:
```rust
pub async fn check_tool_result(&self, ctx: &mut GuardrailContext<'_>)
    -> HarnessResult<GuardrailAction>;

/// 递归遍历 Value, 把所有 "[PII_xxx]" 子串 deanonymize
fn deanonymize_value(value: &mut Value);

/// 极简 JSON schema 校验 (type + required + properties 类型)
fn validate_against_schema(value: &Value, schema: &Value) -> Result<(), String>;
```

**判定矩阵**:

| 输出情况 | verdict | 后续动作 |
|:---------|:--------|:---------|
| 干净 / 已 deanonymize | `Pass` | 放行 |
| 写入 schema 不符 | `Blocked { reason, evidence }` | 拦截, 阻止污染 DB |
| 超过 1MB | `Truncated { original_size, kept_size }` | 截断 + 标记 |
| 含 `[PII_xxx]` 残余 | `Deanonymized { count }` | 还原 + 放行 |

---

### 4.3 HITL — 命令总线 + 一次性审批

**文件**: `src/harness/guardrails/hitl.rs` (~430 行, 9 单元测试)

**核心抽象**:
```rust
pub struct HitlPolicy {
    pub auto_approve_readonly: bool,       // 默认 true
    pub auto_approve_safe_writes: bool,    // 默认 false
    pub require_approval_for: HashSet<String>, // 显式覆盖
    pub timeout: Duration,                 // 默认 30s
}

pub struct ApprovalChannel {
    pending: Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>,
    policy: HitlPolicy,
    app: AppHandle,
}
```

**风险等级启发式** (`RiskLevel::from_tool_name`):

| 工具名模式 | 风险等级 | 是否需 HITL |
|:-----------|:---------|:------------|
| `reset_factory*`, `delete_by_class*`, `bulk_*` | `Destructive` | ✅ |
| `delete_*`, `reset_*` | `High` | ✅ |
| `add_*`, `bulk_add_*` | `Medium` | ⚠ 视 `auto_approve_safe_writes` |
| 其他只读 | `Low` | ❌ 自动放行 |

**审批流程** (5 步):

```
AgentHarness (后台线程)              前端 UI                ApprovalChannel
       │                              │                          │
       │ 1. ToolCall 钩子触发         │                          │
       ├─→ request(req) ──────────────┼─────────────────────────►│
       │                              │                          │ 2. 评估 HitlPolicy
       │                              │                          │    - readonly? → 直接 Approve
       │                              │                          │    - safe_write? → 视配置
       │                              │                          │    - 其他? → oneshot 等待
       │                              │                          │
       │                              │ 3. emit                  │
       │                              │ "agent:approval-required"◄┤
       │                              │   { id, tool, args }     │
       │                              │                          │ 注册 sender
       │                              │                          │
       │                              │ 4. 渲染确认对话框         │
       │                              │    用户点 批准/拒绝/编辑   │
       │                              │                          │
       │                              │ 5. invoke                │
       │                              │ "agent_approval_resolve" ─►│
       │                              │   { id, decision }       │ sender.send()
       │                              │                          │
       │                              │                  oneshot 接收
       │◄─────────────────────────────┼──────────────────────────┤
       │ ApprovalDecision             │                          │
       │ 继续执行 checked.call(args)  │                          │
```

**决议类型** (`ApprovalDecision`):
```rust
pub enum ApprovalDecision {
    Approve { by: String },                          // 用户名
    Reject  { by: String, reason: String },          // 含原因, 写 audit
    Edit    { by: String, new_args: Value },         // 用户改了 args, 用 new_args
}
```

**超时**: 默认 30s oneshot 超时后, 返回 `HarnessError::ApprovalTimeout`, agent 状态机降级为 `aborted`。此时 sender 仍注册, 若前端后续发了 `resolve` 会得 `NoSender` (被忽略, 不 panic)。

**显式覆盖**: `policy.require_approval_for = {"get_student"}` 可强制只读工具也走 HITL; 配合 `auto_approve_safe_writes=true` 可让 `add_event` 不弹窗。

---

### 4.4 Sandbox — 资源限制

**文件**: `src/harness/guardrails/sandbox.rs` (~250 行, 7 单元测试)

**资源限制** (`ResourceLimits` 默认值):
```rust
pub struct ResourceLimits {
    pub max_args_bytes: usize,        // 64 KB
    pub max_result_bytes: usize,      // 1 MB
    pub max_truncated_bytes: usize,   // 64 KB
    pub max_tool_timeout_sec: u64,    // 30 s
    pub allowed_path_prefixes: Vec<PathBuf>, // 白名单
    pub blocked_path_prefixes: Vec<PathBuf>, // 黑名单 (先查)
}
```

**默认黑名单** (跨平台):
- Linux/macOS: `~/.ssh`, `~/.gnupg`, `~/.aws`, `/etc`, `/var/log`, `/root`
- Windows: `C:\Windows\System32`, `C:\Program Files`

**两个公开方法**:
```rust
/// 检查工具 args 大小
pub async fn check_tool_call(&self, ctx: &mut GuardrailContext<'_>)
    -> HarnessResult<GuardrailAction>;

/// 检查工具返回值大小
pub async fn check_tool_result(&self, ctx: &mut GuardrailContext<'_>)
    -> HarnessResult<GuardrailAction>;
```

**判定矩阵**:
| 情况 | 动作 |
|:-----|:-----|
| args > 64KB | Block + 提示 "参数过大" |
| args 含黑名单路径 | Block + 提示 "禁止访问 {path}" |
| 路径不在白名单 (若白名单非空) | Block + 提示 "未授权路径" |
| 路径在白名单 (或白名单为空) | Allow |
| result > 1MB | 截断到 64KB + AllowWith |

**白名单 vs 黑名单顺序**: 先查黑名单, 再查白名单。若白名单非空, 路径必须命中白名单; 命中黑名单则直接 Block (不管白名单)。

---

## 5. 与 AgentHarness 的接线 (`react_loop` 三钩子点)

**文件**: `src-tauri/src/harness/agent/mod.rs`  `react_loop` 方法

```rust
// === 钩子点 1: LLM Input ===
let mut messages_json = json!({ "messages": messages });
pipeline.check_input(&run_id, &agent_id, &mut messages_json).await?;
// 把 messages_json 喂给 LLM

// === 钩子点 2: Tool Call ===
let checked = registry.get_checked(&tool_call.name, &capabilities)?;
let tool_schema = checked.input_schema();   // 提前 capture
let is_write = checked.is_write_op();
let risk = RiskLevel::from_tool_name(&tool_call.name);
let mut args_value = tool_call.args.clone();
pipeline.check_tool_call_with_meta(
    &run_id, &agent_id, &tool_call.name,
    &mut args_value, is_write, &risk_str,
).await?;

// === 执行 (HITL 已通过后) ===
let result = checked.call(args_value, ctx).await?;

// === 钩子点 3: Tool Result ===
let mut result_value = serde_json::to_value(&result)?;
pipeline.check_tool_result_with_meta(
    &run_id, &agent_id, &tool_call.name,
    &mut result_value, is_write, &tool_schema,
).await?;
```

**AppState 接线** (`src-tauri/src/state.rs`):
```rust
pub struct AppState {
    // ... 既有 13 个 Arc 字段
    pub approval_channel: Arc<ApprovalChannel>,
}

impl AppState {
    pub async fn init(paths: Paths, app: tauri::AppHandle) -> Result<Self> {
        // ...
        approval_channel: Arc::new(ApprovalChannel::new(app)),
    }
}
```

**Tauri commands** (`src-tauri/src/commands/agent.rs`):
```rust
#[tauri::command]
pub async fn agent_approval_resolve(
    state: State<'_, AppState>,
    request_id: String,
    decision: Value,
) -> Result<Value>;

#[tauri::command]
pub async fn agent_approval_pending_count(state: State<'_, AppState>) -> Result<Value>;
```

**前端契约** (待实现, R5):
```typescript
// 监听
listen("agent:approval-required", (e) => {
    const { id, tool, args, risk } = e.payload;
    showApprovalDialog(id, tool, args, risk);
});

// 响应
invoke("agent_approval_resolve", {
    requestId: id,
    decision: { type: "approve", by: "alice" },
    // 或: { type: "reject", by: "alice", reason: "..." }
    // 或: { type: "edit", by: "alice", newArgs: {...} }
});
```

---

## 6. 错误传播与状态机降级

**新增错误变体** (`harness/error.rs`):
```rust
#[error("Guardrail 拦截: {guardrail} 在 {hook} 阶段拒绝 — {reason}")]
GuardrailBlocked {
    guardrail: String,
    hook: String,    // "input" | "tool_call" | "tool_result"
    reason: String,
},

#[error("审批超时 ({}s)", .0)]
ApprovalTimeout(u64),
```

**react_loop 降级路径**:
```
GuardrailBlocked
    └─→ react_loop 捕获
        └─→ state_store.finish_run("aborted", None, Some(&err.to_string()))
            └─→ emit("agent:status-update", { status: "aborted", reason })
                └─→ 前端展示拒绝原因
```

**HITL 拒绝也走同一路径**: 用户的 `Reject { by, reason }` 通过 oneshot 返回, `HitlGuard` 把它转成 `GuardrailAction::Block { reason: format!("用户 {} 拒绝: {}", by, reason), severity: Warn, evidence: None }`, 立即短路。

---

## 7. 测试覆盖

### 7.1 单元测试 (35 个, 在各子模块 `#[cfg(test)] mod tests`)

| 模块 | 测试数 | 覆盖点 |
|:-----|:------:|:-------|
| `mod.rs` (Pipeline) | 3 | 短路 / 顺序 / 改写 |
| `input_filter.rs` | 6 | clean / injection / 大量 PII / secret 字段 / 脱敏还原 / 长度 |
| `output_filter.rs` | 7 | pass / deanonymize / 截断 / schema 通过 / schema 拒绝 / 写操作校验 / 多层嵌套 |
| `hitl.rs` | 9 | readonly / write_medium / high_risk / destructive / safe_writes_auto / 显式覆盖 / 超时 / Reject 路径 / Edit 路径 |
| `sandbox.rs` | 7 | 超大 args / 黑名单路径 / 白名单通过 / 跨平台默认 / 大小截断 / 嵌套 args / path 规范化 |
| `mod.rs` HitlGuard | 3 | 适配器 / tool 钩子外不介入 / 默认 Allow |

### 7.2 集成测试 (23 个, `tests/guardrails_integration.rs`)

| 分组 | 数量 | 内容 |
|:-----|:----:|:-----|
| `InputFilter` | 5 | clean / injection / excessive_pii / secret 字段 / 脱敏还原 |
| `OutputFilter` | 5 | pass / deanonymize / truncate / schema 校验通过 / schema 校验拒绝 |
| `Sandbox` | 3 | 超大 / 黑名单 / 安全路径 |
| `Pipeline` | 4 | allow / 短路 / 全过 / 全链路干净 |
| `HitlPolicy` | 6 | readonly / write_medium / high_risk / destructive / safe_writes_auto / 显式覆盖 |

**总计**: **264 个测试, 0 失败** (含阶段二 73 lib + 26 react_loop)。

---

## 8. 已知限制与未来扩展

### 8.1 已知限制

1. **PII 反查表常驻内存**: `PrivacyEngine` 的 token → 原始值映射当前是 in-process, 跨进程/重启会丢
2. **审批超时 30s 是硬编码**: 未来应让 `HitlPolicy` 可按 `risk` 动态调整 (`Destructive` → 5min)
3. **白名单是 path 前缀匹配**: 不支持 glob 模式 (如 `*.pdf`)
4. **schema 校验是极简版**: 只校验 `type` + `required` + 简单 properties, 不校验 `oneOf` / `anyOf` / 数值范围

### 8.2 阶段四 / 五扩展

| 计划 | 阶段 | 描述 |
|:-----|:----:|:-----|
| Guardrail 指标埋点 | 四 | 把每次 Allow/Block/Redacted 写进 `eval/guardrails.jsonl`, 供 Evaluation 评分 |
| Schema 验证器替换 | 四 | 用 `jsonschema` crate 替代极简版 |
| 跨进程 PII 表 | 五 | 持久化到 `{eaa_data}/privacy/pii_table.json`, 启动时加载 |
| Guardrail 可视化 | 五 | 前端实时显示每轮 "经过几道关、被改写了几处" |
| 审批策略 DSL | 五 | `policy.toml` 配置, 非程序员可改 |

---

## 9. 模块文件清单

```
src-tauri/src/harness/guardrails/
├── mod.rs              # 3 hook + Action + Pipeline + HitlGuard (170 行)
├── input_filter.rs     # PII/Injection/Secret 三合一 (280 行)
├── output_filter.rs    # Deanonymize/Truncate/Schema 校验 (310 行)
├── hitl.rs             # Policy/Channel/Risk/Decision (430 行)
└── sandbox.rs          # 资源限制 + 路径黑白名单 (250 行)

src-tauri/tests/
└── guardrails_integration.rs   # 23 集成测试 (310 行)

src-tauri/src/commands/
└── agent.rs            # 新增 agent_approval_resolve + agent_approval_pending_count

src-tauri/src/state.rs  # 新增 approval_channel 字段

src-tauri/src/harness/agent/
└── mod.rs              # react_loop 3 处 hook 调用
```

---

## 10. 引用

- 阶段一架构蓝图: [`01-architecture.md`](01-architecture.md) §2.2, §3
- 阶段二 Agent Harness: `src-tauri/src/harness/agent/`
- PrivacyEngine 实现: `core/eaa-cli/src/privacy/mod.rs`
- SensitiveRedactor: `core/eaa-cli/src/log_redact.rs`
- 错误类型: `src-tauri/src/harness/error.rs` (新增 `GuardrailBlocked`, `ApprovalTimeout`)

---

**维护者**: AI Harness 工作组
**最后更新**: 2026-06-16 (阶段三 R7 完成)
