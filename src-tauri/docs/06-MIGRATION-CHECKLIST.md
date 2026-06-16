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

## 4. 紧急回滚预案 (v0.2.0 后)

> **v0.2.0 起**, 仓库已转正为 Tauri 单一架构, 原 Electron 资产封存在
> [`archive/legacy/`](../../archive/legacy/)。 若 Tauri 版出现严重问题,
> 按 [`archive/legacy/README.md` §4](../../archive/legacy/README.md#4-回滚到-electron-的方法)
> 步骤回滚 (1-2 小时工作量)。
>
> 简单总结:
> 1. 复制 `archive/legacy/src-main/main/` 回 `src/main/`
> 2. 从 git history 恢复 `package.json` / `package-lock.json` 到 v0.1.0
> 3. 恢复 `electron-builder.yml` 和 `vite.config.main.ts`
> 4. 恢复 `.github/workflows/release.yml` 到 `.github/workflows/`
> 5. 恢复 `scripts/build-icon.mjs` 等
> 6. 渲染端 `ipc-client.ts` 恢复双轨检测 (从 git history 找回)
> 7. `npm ci && npm run build && npm run dev`

## 5. 阶段 8 — 仓库转正 ✅ (v0.2.0, 2026-06-15)

> 从 v0.2.0 起, 仓库正式从 Electron 切换到 Tauri 2.0 单一架构。
> 详见 [`MIGRATION_REPORT.md`](../../MIGRATION_REPORT.md)。

### 修改清单

- **封存** 原 Electron 资产 (44 个文件) 到 `archive/legacy/`:
  - `src/main/` 整体 (36 个 .ts 文件)
  - `electron-builder.yml` / `vite.config.main.ts`
  - `scripts/build-icon.mjs` / `download-eaa-binaries.mjs` /
    `generate-update-manifest.mjs` / `refine-wording.ps1` / `rename-brand.ps1`
  - `.github/workflows/release.yml`
- **删除** 渲染端 `ipc-client.tauri.ts`, 合并到 `ipc-client.ts`。
  移除运行时 `window.__TAURI_INTERNALS__` 探测分支,
  渲染端 100% 强制走 Tauri。
- **清理** `package.json`:
  - 删除 scripts: `dev`, `dev:main`, `dev:electron`, `build`, `start`,
    `package`, `package:portable`, `package:installer`, `build:icon`, `build:eaa`
  - 删除 dependencies: `better-sqlite3`, `chokidar`, `cross-spawn`,
    `node-cron`, `xlsx`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`
  - 删除 devDependencies: `electron`, `electron-builder`, `vite-plugin-electron`,
    `sharp`, `to-ico`, `@types/better-sqlite3`, `@types/cross-spawn`, `@types/node-cron`
- **CI**:
  - `ci.yml` 拆分为 `frontend-quality` (jsdom) + `rust-quality` (lib + tests) 两个 job
  - `release-tauri.yml` 升级为主 release, 去掉"Tauri"后缀和占位注释
- **顶层文档** 全面重写为 Tauri-only:
  - README.md badges / Quick start / FAQ 全部更新
  - README-TAURI.md / CONTRIBUTING-TAURI.md 删除 (内容已并入主 README / CONTRIBUTING.md)
  - CHANGELOG.md 添加 [0.2.0] 段
  - ROADMAP.md 标记 Tauri parity 为 ✅ shipped
  - BACKLOG.md 删除"Tauri parity build"项
  - docs/EAA_BRIDGE.md 改写为 EAA Core Integration (无 bridge)
  - docs/DESKTOP_BUILD.md / docs/FAQ.md 更新流程与对比

### 验证

- `cargo +1.95.0 check --manifest-path src-tauri/Cargo.toml --all-targets` 0 错误
- `cargo +1.95.0 test --manifest-path src-tauri/Cargo.toml --lib` 108 个测试通过
- `npm run typecheck` 通过
- `npm run lint` 通过
- `npm run test` (vitest) 通过
- `npm run build:renderer` 成功

### 资产归档

- `archive/legacy/README.md` 详细说明:
  - 44 个 Electron 资产的位置和内容
  - 删除条件 (连续运行 6 个月 + 三平台验证)
  - 完整回滚步骤
  - Git 历史完整保留 (rename detection)
