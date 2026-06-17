# Education Advisor 全面审查报告

**审查时间**: 2026-06-16  
**项目路径**: `/home/admina/ZCodeProject/education-advisor`  
**版本**: `0.2.0-rc.1`  
**审查范围**: Agent 配置、Rust 后端服务、前端页面、测试状态、构建检查

---

## 执行摘要

| 维度 | 结果 | 说明 |
|------|------|------|
| Agent 配置 | ⚠️ 警告 | 18 个 agent 注册完整，但 **capabilities 与 Harness ToolRegistry 能力模型不匹配**，会导致 agent 在 Harness 执行路径下被大量拒绝工具调用。 |
| Rust 后端服务 | ✅ 基本健康 | 14 个 command 模块、15 个 service 模块、完整 harness 架构；存在 1 个文档占位 `unimplemented!` 和 1 个不稳定单元测试。 |
| 前端页面 | ✅ 结构完整 | 10 个路由/页面均正常导出；IPC 客户端与 Rust command 命名对齐；存在 1 处常量表遗漏。 |
| 测试状态 | ⚠️ 1 处失败 | 前端 12/12 通过；Rust 集成测试全部通过；Rust lib 测试 150/151 通过，1 个时间相关测试不稳定。 |
| 构建检查 | ✅ 通过 | `tsc`、`biome`、`vite build`、`cargo check` 均通过，仅有可忽略的 warning。 |

**结论**: 项目整体结构完整、构建可过，但 **Agent capability 模型与 Harness ToolRegistry 不一致是当前最大的功能性隐患**，建议优先修复。

---

## 1. Agent 配置审查

### 1.1 配置完整性

- `config/agents.yaml` 注册了 **18 个 agent**，字段完整（id/name/role/enabled/model_tier/capabilities/schedule/risk_thresholds）。
- `agents/` 下每个 agent 均同时存在 `SOUL.md` 与 `AGENTS.md`（`bug-hunter` 额外有 `USER.md`）。
- `config/reason-codes.json` 包含 22 个 reason code，JSON 合法。
- `config/default-settings.json` 结构完整，覆盖 general/models/chat/privacy/feishu/advanced/shortcuts。

### 1.2 Capability 不匹配（⚠️ 警告 / 准阻塞）

`config/agents.yaml` 中的 capabilities 使用**别名式**设计：

```yaml
capabilities:
  - read      # 期望覆盖 score/history/ranking/stats/... 等 11 个只读工具
  - write     # 期望覆盖 add_event/add_student/revert/... 等写入工具
  - academic  # 期望覆盖 academic_get / academic_add / bulk_add_academics
  - profile   # 期望覆盖 profile_get / profile_set
  - file_read / file_write / utility
```

该别名在旧的 `src-tauri/src/tools/eaa_tools.rs::is_allowed()` 中被正确展开（`read` → 11 个只读工具、`write` → 10 个写入工具等）。

但 **当前实际执行路径** `src-tauri/src/services/agent_runner.rs` → `AgentHarness::run()` → `harness/tools/ToolRegistry::get_checked()` 使用**命名空间式** capability：

```rust
// src-tauri/src/harness/tools/eaa_bridge.rs
GetScore   => caps: &["read:scores"]
GetHistory => caps: &["read:history"]
AddEvent   => caps: &["write:events"]
AcademicGet=> caps: &["read:academic"]
ProfileGet => caps: &["read:profile"]
```

`ToolRegistry::get_checked()` 仅做精确匹配或通配符匹配（`all` / `*`），**不会展开 `read`/`write`/`academic`/`profile` 等别名**：

```rust
// src-tauri/src/harness/tools/registry.rs:80-86
let missing: Vec<&str> = required
    .iter()
    .copied()
    .filter(|c| !caps.iter().any(|owned| owned == c || owned == "all" || owned == "*"))
    .collect();
```

**后果**: 绝大多数 agent（除 `main` 等明确给了 `all` 的）在 Harness 执行时调用 `get_score`/`add_event` 等工具会被 `CapabilityDenied` 拒绝。这与 `tests/links.rs` 等底层工具测试通过的假象形成对比——那些测试直接调用 `dispatch_cached` 走旧路径，不经过 Harness Registry。

**建议修复方向**（二选一）：
1. **在 Harness 层统一 capability 语义**：在 `harness/tools/registry.rs` 或 `harness/agent/mod.rs` 把 YAML 别名展开为 namespaced caps，保持与 `eaa_tools::is_allowed()` 一致。
2. **改写 `config/agents.yaml`**：把所有别名替换为具体 namespaced capabilities（工作量较大，但最精确）。

推荐方案 1，因为 `config/agents.yaml` 已有大量注释说明别名语义，且旧路径仍依赖这些别名。

### 1.3 其他配置观察

- 所有 agent 的 `risk_thresholds` 已统一为 `high: 85 / medium: 93 / low: 93`（P2-12 修复完成）。
- `bug-hunter` 的 `capabilities` 注释说明它不应改业务代码，但 capability 给了 `file_write`；依赖 Agent 自律，符合设计。

---

## 2. Rust 后端服务审查

### 2.1 架构与模块

- `src-tauri/src/main.rs` 正确通过 `tauri::generate_handler!` 注册了 **90+ 个 command**，覆盖 AI/Agent/EAA/Privacy/Compliance/Cron/Skill/Settings/Profile/Chat/Log/Feishu/Sys。
- `src-tauri/src/state.rs` 的 `AppState` 完整持有 db/privacy/agents/llm/scheduler/skills/settings/keystore/privacy_audit/feishu/profile/oauth/active_streams/approval_channel，初始化顺序合理。
- `src-tauri/src/services/mod.rs` 列出 15 个服务模块，分工清晰。
- `src-tauri/src/commands/mod.rs` 的 `register()` 函数是**文档占位**，返回 `unimplemented!()`；实际入口在 `main.rs`，不影响运行，但可能造成误读。

### 2.2 实现缺口

- `src-tauri/src/services/agent_runner.rs::run_scheduled()` 是 stub，直接返回 `Ok(())`。虽然当前 scheduler 的 runner 闭包直接调 `agent_runner::run()`，但 `run_scheduled` 签名未使用。
- 未发现 `TODO`/`FIXME`/`unimplemented!` 散落在 services 中；commands 中仅 `commands/mod.rs` 的占位。

### 2.3 Harness 运行时的能力校验问题

见 1.2。该问题位于 `harness/tools/eaa_bridge.rs` + `harness/tools/registry.rs` + `harness/agent/mod.rs` 的交界处。

---

## 3. 前端页面审查

### 3.1 页面完整性

- `src/renderer/App.tsx` 定义 10 条路由：`/dashboard`、`/chat`、`/students`、`/agents`、`/agents/history`、`/models`、`/skills`、`/scheduler`、`/privacy`、`/settings`。
- `src/renderer/layouts/MainLayout.tsx` 导航项与路由一一对应，并额外显示 agent 状态列表与隐私引擎状态徽章。
- 10 个 `*Page.tsx` 均正常导出（`export function XxxPage`）。
- 路由级懒加载已启用，仅 Dashboard 同步加载，其余页面按需 chunk。

### 3.2 IPC 契约

- `src/renderer/lib/ipc-client.ts` 完整封装 90+ invoke/listen，命名转换 `ai:list-models` → `ai_list_models` 与 Rust command 一致。
- `src/shared/ipc-channels.ts` 定义了大部分通道常量，但存在 2 处不一致：
  1. **遗漏**: `compliance:read-audit` 在 `ipc-client.ts` 中被使用，但未在 `ipc-channels.ts` 中定义常量（`IPC_COMPLIANCE_READ_AUDIT` 缺失）。
  2. **位置错位**: `IPC_SYS_SHOW_UPDATE_DIALOG` 被放在日志段之后，建议归入系统段。

### 3.3 构建产物

- `npm run build:renderer` 成功，产出 14 个 chunk；`index-C2FsHdsc.js` 801 KB（gzip 263 KB），`StudentsPage` 267 KB，提示可考虑进一步代码分割。

---

## 4. 测试状态审查

### 4.1 前端测试

```bash
npm test
# 结果: 2 test files, 12 tests, 全部通过, 耗时 2.21s
```

- 覆盖 `useDebounce` hook 与 `agentStore` 状态监听器。
- 整体前端测试覆盖率低（仅 2 个文件），属于已知薄弱项。

### 4.2 Rust 测试

**Lib 单元测试**:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
# 结果: 150 passed, 1 failed
```

失败项：

```text
harness::guardrails::tests::test_uuid_v4_short_is_hex
  left: 7
 right: 8
```

根因：`uuid_v4_short()` 实际实现是取当前时间戳纳秒的低 32 位格式化为十六进制：

```rust
fn uuid_v4_short() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}", nanos & 0xFFFF_FFFF)
}
```

当最高 nibble 为 0 时，生成的十六进制字符串长度为 7 而非 8。该测试**时间相关、不稳定**，且函数名与实现不符（不是 UUID v4）。

**建议修复**: 改为固定 8 字符十六进制，例如：

```rust
format!("{:08x}", nanos & 0xFFFF_FFFF)
```

**集成测试**:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test cache
# 4 passed
cargo test --manifest-path src-tauri/Cargo.toml --test contract
# 2 passed
cargo test --manifest-path src-tauri/Cargo.toml --test eval_integration
# 12 passed
cargo test --manifest-path src-tauri/Cargo.toml --test guardrails_integration
# 23 passed
cargo test --manifest-path src-tauri/Cargo.toml --test harness_react_loop
# 26 passed
cargo test --manifest-path src-tauri/Cargo.toml --test integration
# 9 passed
cargo test --manifest-path src-tauri/Cargo.toml --test links
# 13 passed
cargo test --manifest-path src-tauri/Cargo.toml --test llm_tool_loop
# 6 passed
cargo test --manifest-path src-tauri/Cargo.toml --test oauth
# 10 passed
cargo test --manifest-path src-tauri/Cargo.toml --test services
# 28 passed
cargo test --manifest-path src-tauri/Cargo.toml --test subcrates
# 18 passed
cargo test --manifest-path src-tauri/Cargo.toml --test tools_integration
# 17 passed
```

**集成测试总计约 168 个，全部通过。**

---

## 5. 构建检查

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run typecheck` | ✅ 通过 | `tsc --noEmit` 无错误。 |
| `npm run lint` | ✅ 通过（3 warnings） | Biome 对 `globals.css` 中 3 处 `!important` 发出 `noImportantStyles` 警告，均为 reduced-motion 可访问性样式，可忽略或加 `// biome-ignore`。 |
| `npm run build:renderer` | ✅ 通过 | Vite 生产构建成功，chunk 大小警告见 3.3。 |
| `cargo check --manifest-path src-tauri/Cargo.toml --lib` | ✅ 通过 | 仅有 `vendor/brotli-decompressor` 的 `unexpected_cfgs` 警告（已知并文档化）。 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ 通过 | 完整 binary + lib 检查通过。 |

---

## 6. 问题分级汇总

### 🔴 阻塞 / 准阻塞

1. **Agent capability 与 Harness ToolRegistry 不匹配**
   - 位置: `config/agents.yaml` + `src-tauri/src/harness/tools/registry.rs` + `src-tauri/src/harness/tools/eaa_bridge.rs` + `src-tauri/src/harness/agent/mod.rs`
   - 影响: agent 在 Harness 路径下运行时大量工具调用会被 `CapabilityDenied` 拒绝。
   - 修复: 在 Harness 层统一展开 YAML capability 别名，或改写 agents.yaml 为 namespaced caps。

### 🟡 警告

2. **`test_uuid_v4_short_is_hex` 单元测试不稳定**
   - 位置: `src-tauri/src/harness/guardrails/mod.rs:499`
   - 影响: CI 可能随机失败。
   - 修复: `format!("{:08x}", ...)` 或重命名函数并修正测试预期。

3. **`commands/mod.rs::register()` 文档占位 `unimplemented!()`**
   - 位置: `src-tauri/src/commands/mod.rs:34`
   - 影响: 不影响运行，但可能误导开发者直接调用。
   - 修复: 改为 `panic!("use generate_handler! in main.rs")` 或直接删除该函数。

4. **`ipc-channels.ts` 缺少 `IPC_COMPLIANCE_READ_AUDIT`**
   - 位置: `src/shared/ipc-channels.ts`
   - 影响: 通道常量表与 `ipc-client.ts` 实际使用不一致。
   - 修复: 增加 `export const IPC_COMPLIANCE_READ_AUDIT = 'compliance:read-audit'`。

5. **`agent_runner::run_scheduled` 为 stub**
   - 位置: `src-tauri/src/services/agent_runner.rs:40`
   - 影响: 当前 scheduler runner 闭包直接调 `run()`，该 stub 未实际使用，但签名残留。
   - 修复: 若不再需要，删除该函数；若保留，补全实现。

### 🟢 建议

6. **前端测试覆盖率低**：当前仅 2 个测试文件，建议为关键 pages/stores/hooks 增加测试。
7. **CSS `!important` 警告**：可在 `globals.css` 相关行加 `// biome-ignore` 或调整选择器特异性。
8. **`ARCHITECTURE.md` 仍描述 Electron 架构**：README 已更新为 Tauri，但 `ARCHITECTURE.md` 顶部说明后正文仍是旧架构，建议同步更新或归档。
9. **构建产物 chunk 过大**：`index.js` 801 KB / `StudentsPage` 267 KB，可考虑进一步拆分依赖（ECharts、react-markdown、shiki）。

---

## 7. 下一步建议

按优先级排序：

1. **修复 capability 不匹配**（最高优先级，直接影响 agent 功能）。
2. **修复不稳定测试** `test_uuid_v4_short_is_hex`。
3. **补齐 `IPC_COMPLIANCE_READ_AUDIT` 常量**。
4. 清理 `commands/mod.rs` 占位与 `agent_runner::run_scheduled` stub。
5. 更新/归档 `ARCHITECTURE.md`。
6. 扩展前端测试覆盖。

---

*报告生成于 2026-06-16，由自动化审查流程产出。*
