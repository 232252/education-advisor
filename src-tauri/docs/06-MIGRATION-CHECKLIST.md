# 06 — 迁移验收清单

> 分阶段验收项 + 原项目"未打通的链路"修复点对照。

## 1. 阶段验收

### 阶段 0 — 工具链 & 骨架 ✅

- [x] rustup 安装 (stable 1.96 + 1.95 + 1.82, 经 8888 代理)
- [x] cargo 走代理 + git-fetch-with-cli 配置
- [x] `src-tauri/` 目录结构创建 (commands/services/tools/docs/tests)
- [x] `Cargo.toml` (含 [patch.crates-io] 修复 brotli)
- [x] `tauri.conf.json` (devUrl=5173, frontendDist=../dist/renderer, tray, bundle)
- [x] `capabilities/default.json` (权限白名单)
- [x] `build.rs` (tauri-build)

### 阶段 1 — 复用 Rust 核心 ✅

- [x] `core/eaa-cli/Cargo.toml` 加 `[lib] name="eaa_core"`
- [x] `core/eaa-cli/src/lib.rs` 新增 (re-export)
- [x] `core/eaa-cli/src/main.rs` 改 `use eaa_core::*`
- [x] `cargo check --lib` (eaa_cli) 通过
- [x] `cargo check --bin eaa` (CLI 仍可用) 通过
- [x] `commands/eaa.rs` + `commands/privacy.rs` 实现 (薄包装 storage/privacy)
- [x] 数据写入后广播事件 (`eaa:event-added` 等 4 个)

### 阶段 2 — 持久化 & 系统 ✅

- [x] `services/db.rs` (rusqlite, 4 表 schema 与 better-sqlite3 完全一致)
- [x] `services/settings_service.rs` (dot-path 更新 + 原子写)
- [x] `services/keystore.rs` (keyring 跨平台)
- [x] `commands/settings.rs` + `commands/sys.rs` (11 个系统命令)
- [x] 文件对话框走 `tauri-plugin-dialog`, 外链走 `tauri-plugin-opener` (限 https)

### 阶段 3 — LLM & Agent 主链路 ✅

- [x] `services/llm_service.rs`:
  - [x] OpenAI-compatible 通道 (覆盖 OpenAI/DeepSeek/Moonshot/Zhipu/Doubao/Qwen/Mistral/Ollama/LM Studio)
  - [x] Anthropic Messages 流式 (SSE, content_block_delta)
  - [x] Gemini streamGenerateContent (SSE)
  - [x] 统一 `StreamEvent` 输出 (Delta/Thinking/ToolCall/Usage/Done/Error)
  - [x] `CancellationToken` abort
- [x] `services/agent_service.rs`:
  - [x] 加载 `config/agents.yaml` (18 agents)
  - [x] SOUL/AGENTS.md 读写 (原子写)
  - [x] capability 校验 (`has_capability`, 含 read/write/all 展开规则)
  - [x] model_tier → (provider, model) 解析
- [x] `commands/ai.rs` (11) + `commands/agent.rs` (13)
- [x] 隐私脱敏前置: chat 前 `privacy.anonymize` (若 enabled)
- [x] agent run 历史持久化到 SQLite (agent_executions 表)

### 阶段 4 — 调度器 & 集成 ✅

- [x] `services/scheduler.rs` (tokio-cron-scheduler, 热重载, per-task 日志)
- [x] `services/feishu_service.rs` (reqwest, token/bitable/send)
- [x] 隐私预检: `feishu_send_preflight` / `feishu_send_confirm`
  (复用 `eaa_core::privacy::filter_for_receiver`)
- [x] `commands/cron.rs` + `feishu.rs` + `log_viewer.rs` + `profile.rs` + `chat.rs` + `compliance.rs`
- [x] `services/tray.rs` (`tauri::tray`, show/hide/quit 菜单)
- [x] `services/privacy_audit.rs` + 合规报告 (SHA-256 manifest)

### 阶段 5 — 前端适配 ✅

- [x] `ipc-client.tauri.ts` 新增 (~470 行, WindowAPI 完整实现)
- [x] `ipc-client.ts` `getAPI()` 加运行时 Tauri 探测 (双轨)
- [x] `package.json` 加 8 个 tauri:* / cargo:* scripts
- [x] `package.json` 加 8 个 @tauri-apps/* devDeps
- [x] 11 页面 / 4 store / hooks **零改动** (单一收口点保证)

### 阶段 6 — 文档 ✅

- [x] docs/00-OVERVIEW.md
- [x] docs/01-ARCHITECTURE.md
- [x] docs/02-RUST-CORE-REUSE.md
- [x] docs/03-COMMANDS-MAP.md
- [x] docs/04-FRONTEND-SHIM.md
- [x] docs/05-BUILD-RUN.md
- [x] docs/06-MIGRATION-CHECKLIST.md (本文件)
- [x] docs/07-PLUGINS.md
- [x] docs/CHANGELOG.md

## 2. 原项目"未打通的链路"修复对照

| 原链路 (Electron 版的问题) | Tauri 版的修复 |
|---------------------------|---------------|
| LLM 流式 abort 有时残留 | `tokio::select!` + `CancellationToken`, abort 即时 drop reqwest 流 |
| 数据写入需 spawn eaa 子进程 (慢) | `eaa_core` 库内调用, <1ms |
| 隐私预检仅 feishu.send 走, 其它出口裸发 | `privacy_audit.rs` 统一记录所有 anonymize/filter 调用 |
| 合规报告手动算 | `compliance_generate` 按 audit.log 季度聚合 + SHA-256 manifest |
| better-sqlite3 native 模块跨平台重编 | rusqlite `bundled` feature, 自带 SQLite 源码 |
| win-dpapi 仅 Windows | keyring 跨平台 (Win Credential Manager / macOS Keychain / Linux Secret Service) |
| tray-service 偶发菜单项错位 | `tauri::tray::TrayIconBuilder` + on_menu_event 显式路由 |
| settings 原子写依赖 fs-extra | 复用 eaa_core 同款 `tmp → fsync → rename` |
| 工具调用参数注入风险 | `tools/eaa_tools.rs` reason_code 白名单 `[A-Z_]`, 路径穿越防护 |

## 3. 仍待完善 (后续 PR, 非阻塞)

- [ ] agent run_manual 的 **多轮工具调用循环** (LLM 返 ToolCall → 执行 → 结果回喂 → 直到 Done)。
  当前实现单轮 tool 事件透传给前端, 多轮闭环标 TODO (见 CHANGELOG)。
- [ ] `tauri-plugin-updater` 接 GitHub Releases endpoint (sys_check_update 当前返回未配置提示)。
- [ ] OAuth 登录 (Notion 等): `tauri-plugin-deep-link` + loopback HTTP。
- [ ] 4 个子 crate 接线: feishu HMAC 校验 (callback-signature)、日志脱敏 (log-redact)。
- [ ] Tauri 版打包产物的代码签名 (Windows authenticode / macOS notarization)。
- [ ] 集成测试 (tests/) 覆盖 eaa_core + tools 分发。
- [ ] i18n 文案在 Tauri 版的验证 (renderer 共用, 应零问题)。

## 4. 回滚预案

若 Tauri 版出现问题, **不影响 Electron 版**:

- Electron 代码 (src/main, src/main/preload, package.json 原 scripts) 原样保留
- `npm run dev` / `npm run start` / `npm run package` 仍走 Electron
- 删除 `src-tauri/` + 撤销 `ipc-client.ts` 的 Tauri 分支 + 撤销 package.json 的 tauri scripts
  即可完全回滚 (eaa_cli 的 `[lib]` 改动可保留, 它不破坏 CLI 行为)
