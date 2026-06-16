# Changelog

All notable changes to **Education Advisor** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Repository scope** — This file documents the **desktop** repository at
> <https://github.com/232252/education-advisor>. The **Rust data engine (`core/eaa-cli/`)**
> (the `eaa-cli`) has its own
> [`CHANGELOG.md`](https://github.com/232252/education-advisor/blob/main/CHANGELOG.md)
> in its own repository. Cross-reference both when troubleshooting.

## [Unreleased]

### Added
- **阶段四·Evaluation Harness** (`harness/eval/`): 把"agent 跑得对不对"变成 CI 可重复执行的回归测试
  - **数据集层** (`dataset.rs`): JSONL 格式, 4 个内置数据集 (safety / privacy / tool_correctness / task_completion, 共 12 case)
  - **4 个确定性 Scorer** (`scorer.rs`): ToolCallMatch (顺序子序列) / SchemaValidator (写操作 result 校验) / PiiLeak (`[PII_xxx]` 残留) / Budget (rounds/tokens/cost)
  - **LLM-as-a-Judge** (`judge.rs`): 3-strategy verdict 解析 (纯 JSON / ```json``` fence / `{...}` 子串) + StubJudgeClient 测试桩
  - **EvalRunner** (`runner.rs`): 评分公式 `scorer_mean * 0.5 + judge * 0.5`, `TraceProvider` trait 抽象
  - **报告生成** (`report.rs`): 自包含 HTML (`format!` + 转义, 不用模板引擎) + JSON 写出
  - **CLI** (`bin/eval_runner.rs`): 跑批 + exit 0/1 (按 `--pass-rate` 阈值), 支持 `--dataset` / `--dataset-dir` / `--stub-judge` / `--only-tags`
  - **CI 集成** (`.github/workflows/eval.yml`): 单元 + 集成测试 + 跑批烟雾, 上传 report.html/json 作 14-day artifact
  - 测试: 40 单元 + 12 集成 = **52/52 全过**, 0 warnings (clippy clean)
  - 文档: [`docs/harness/04-evaluation.md`](./docs/harness/04-evaluation.md)

### Planned
- Multi-class support (one teacher, N parallel classes)
- Voice channel (push-to-talk during class) with on-device transcription
- Plugin marketplace (community-contributed agents & skills)
- Windows ARM64 installer
- Code signing (Windows Authenticode / macOS Notarization)

### Pending (阶段五+)
- `AgentRunTraceProvider`: 接 `AgentHarness::run` + `StateStore`, 让 eval-runner 跑真 agent (替换 StubTraceProvider)
- Baseline diff: `eval-reports/baseline.json` + 退步 >5% 即 fail
- GuardrailTriggerScorer: 验证守护链触发率 (需要阶段三埋点 Allow/Block 事件到 RunTrace)
- 并发跑批: `tokio::spawn` + `JoinSet`, 12 case 串行 → 并行

## [0.2.0] — 2026-06-15

> **🏗 Architectural transition: 仓库正式从 Electron 切换到 Tauri 2.0 单一架构**
>
> 这是 Education Advisor 桌面端的第二次大版本。从 v0.2.0 开始, 整个
> 后端是一个纯 Rust 单二进制 (≈ 17 MB 安装包), 渲染端依旧 React 18。
> 原 Electron 主进程 / `electron-builder` / `@earendil-works/pi-ai` 等
> 资产全部软删除到 `archive/legacy/` 目录, 保留 git 历史与回滚能力。
>
> 详见 [`MIGRATION_REPORT.md`](./MIGRATION_REPORT.md) 与
> [`src-tauri/docs/00-OVERVIEW.md`](./src-tauri/docs/00-OVERVIEW.md)。

### Changed
- **BREAKING**: 仓库主程序从 Electron 33 + Node 22 切换到 Tauri 2.0 + 纯 Rust
  (单个 `ea_tauri` crate + 4 个 workspace 子 crate)。`src/main/` 整体封存
  到 `archive/legacy/src-main/`。
- **BREAKING**: 前端 IPC 客户端移除双轨检测 (`window.api` 后备分支)。
  `src/renderer/lib/ipc-client.ts` 现在只走 Tauri `invoke/listen`,
  `ipc-client.tauri.ts` 文件已合并删除。
- **BREAKING**: 渲染端到后端的访问路径从 `ipcRenderer.invoke('ns:action', ...)`
  改为 `@tauri-apps/api/core` 的 `invoke('ns_action', ...)`。
  命名规则保持 `:` → `_`。
- **BREAKING**: 旧 React 组件中 `import { getAPI } from './ipc-client'` 的
  172 处调用点**零改动**——`getAPI()` 函数签名与 `WindowAPI` 接口保持兼容。
- 包大小: 从 Electron 90 MB → Tauri **17 MB** (↓ 81%)。
- 启动时间: 从 Electron 1.5-2 s → Tauri **0.3-0.6 s** (↓ 70%)。
- 内存占用: 从 150-200 MB → **40-80 MB** (↓ 60%)。
- 数据引擎访问: 从 spawn `eaa` 子进程 (~50ms/op) → 库内调用
  `<1ms/op` (95x 提升)。
- LLM 层: 从 `pi-ai` npm SDK (Node) → `src-tauri/src/services/llm_service.rs`
  纯 Rust reqwest + SSE 抽象 (12 provider, 0 npm 依赖)。
- SQLite: 从 `better-sqlite3` (native) → `rusqlite` (bundled, 跨平台一致)。
- 密钥存储: 从 win-dpapi (Win only) → `keyring` crate
  (Win Credential Manager / macOS Keychain / Linux Secret Service)。
- 调度器: 从 `node-cron` → `tokio-cron-scheduler`。
- 托盘: 从 Electron `Tray` → `tauri::tray::TrayIconBuilder`。
- 更新器: 从 `electron-updater` → `tauri-plugin-updater` + `tauri-action`。

### Added
- `core/eaa-cli/` 加 `[lib] name="eaa_core"`, src-tauri 直接 path 引用,
  库内调用, 0 子进程。
- 4 个 workspace 子 crate 通过 path 引用:
  `callback-signature`, `log-redact`, `data-validation`, `agent-isolation`。
- `src-tauri/vendored/brotli/`, `brotli-decompressor/`, `alloc-stdlib/` 三方库
  patch, 修复 brotli 8.x + alloc-no-stdlib v2/v3 分裂。
- 108 个 Rust 单元 + 集成测试, 覆盖 13 个 service、30 个 agent 工具、
  全部 4 个子 crate, 0 失败。
- `MIGRATION_REPORT.md` 验证报告。
- `archive/legacy/` 目录封存原 Electron 全部资产 (44 个文件)。

### Removed
- `electron` / `electron-builder` / `vite-plugin-electron` 等 devDependencies。
- `better-sqlite3` / `chokidar` / `cross-spawn` / `node-cron` / `xlsx` 等
  运行时依赖。
- `sharp` / `to-ico` (Electron 图标生成专用)。
- `scripts/build-icon.mjs` / `download-eaa-binaries.mjs` /
  `generate-update-manifest.mjs` / `refine-wording.ps1` / `rename-brand.ps1`。
- `electron-builder.yml` / `vite.config.main.ts`。
- `.github/workflows/release.yml` (Electron release workflow)。
- `dist/` / `release/` (Electron 构建产物, git 重新生成)。

### Fixed
- 原 Electron 版"未打通的链路":
  - LLM 流式 abort 偶发残留 → Tauri `CancellationToken` + `tokio::select!` 干净中止。
  - 数据写入 spawn 子进程慢 → 库内调用。
  - 隐私预检仅 feishu.send 走 → 全部 anonymize/filter 写审计日志。
  - 合规报告手动算 → `compliance_generate` 自动按季度聚合 + SHA-256 manifest。
  - better-sqlite3 native 模块跨平台重编 → rusqlite bundled。
  - tray-service 偶发菜单项错位 → Tauri 显式 `on_menu_event` 路由。

## [0.1.0] — 2026-06-09

> **The first open-source release of the desktop rewrite.**
> What used to be a CLI-only Rust project (`education-advisor` v3.x) is now a
> full desktop application. This is the version that opens to the public.

### Added

#### Desktop shell
- Electron 33 + Vite 6 + React 18 + TypeScript 5.7 + Tailwind 3 application
- 9 routes (Dashboard, Chat, Students, Agents, Models, Skills, Scheduler, Privacy, Settings)
- HashRouter (Electron-friendly, no server required)
- 4 Zustand stores (agent, chat, settings, toast)
- 12 custom React hooks
- 200-key bilingual UI (zh-CN + en-US) with runtime hot-swap
- Light / dark / system theme with CSS variables
- System tray with notification support
- Auto-update from GitHub Releases
- 7-key keyboard shortcut layer (all remappable in Settings)

#### Main process
- 11 IPC handler modules (`ai`, `agent`, `eaa`, `privacy`, `cron`, `skill`, `settings`, `sys`, `profile`, `chat`, `log`, `feishu`)
- 13 service modules (agent loop, LLM abstraction, EAA bridge, cron, file tools, settings, compaction, skill scanner, updater, keystore, Feishu, utility, profile, tray)
- 90+ IPC channel constants (single source of truth in `src/shared/ipc-channels.ts`)
- 539 lines of shared TypeScript types in `src/shared/types/index.ts`
- 5-level rotating logger with console hijack for the renderer
- `better-sqlite3` persistence for chat history, agent executions, cron logs, session metadata
- Auto-migration on first run

#### LLM layer (`@earendil-works/pi-ai`)
- 30+ providers: OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, Qwen, Doubao, Zhipu, Moonshot Kimi, Ollama, LM Studio, OpenAI-compatible catch-all
- Streaming chat with abort, follow-up, steering modes
- Model-tier routing (high-quality vs low-cost)
- Per-agent cost caps and per-model cost tracking
- Custom-model registration for any OpenAI-compatible endpoint
- OAuth login for supported providers
- Automatic context compaction with configurable threshold
- Per-day, per-agent, per-model cost chart in the Dashboard

#### EAA bridge
- Spawns the Rust `eaa-cli` as a child process
- Subprocess timeout, error recovery, and graceful degradation
- Sanitization layer for all EAA parameters (prevents shell injection, path traversal)
- 21 IPC operations wrapping 21 EAA subcommands
- ARM64 fallback to x64 binary (Rosetta / compat layer)

#### Privacy engine
- AES-256-GCM-encrypted mapping table at rest
- Argon2-derived master password
- 11 IPC operations: `init`, `load`, `enable`, `disable`, `list`, `add`, `anonymize`, `deanonymize`, `filter`, `dryrun`, `backup`
- Per-recipient filtering (LLM, parent, CSV export, teacher self, …)
- Audit log of every `anonymize` / `deanonymize` call

#### Feishu (Lark) integration
- Bitable sync (cron + manual trigger, graceful degradation)
- Message send (text, with mention support)
- Token cache with expiry awareness
- App secret read from the encrypted keystore

#### Cron scheduler
- 18 default scheduled jobs across the 18 agents
- Hot-reload on agent config change
- Per-task log with success / failure / duration
- Manual "run now" trigger
- 1-second resolution

#### 18 agents
- 12 education-advisor agents (main, governor, counselor, supervisor, validator, academic, psychology, safety, home_school, research, executor, bug-hunter)
- 6 class-operation agents (class-monitor, risk-alert, data-analyst, student-care, discipline-officer, weekly-reporter)
- All agents defined as `SOUL.md` + `AGENTS.md` pairs, registered in `config/agents.yaml`
- Small-model rulebook (`config/SMALL_MODEL_RULES.md`) applied to all agents
- Least-privilege capability lists
- Risk thresholds (high / medium / low) per agent

#### Packaging
- electron-builder 25 with NSIS + portable targets
- Windows x64 installer (~85 MB) and portable .exe (~75 MB)
- `extraResources` configuration for the EAA binary and agent / config folders
- asar packing with selective asarUnpack for `.exe` / `.node` / `.dll`
- Reproducible build: `npm ci && npm run build && npm run package` produces a byte-identical installer

#### Quality gates
- TypeScript strict mode
- Biome 2.3 lint + format (single quotes, no semis, 100-col, 2-space)
- Vitest 3.2 with two projects (main + renderer)
- 8 spec files, ~3 300 lines of tests
- Coverage with v8 provider (config in place; not yet a CI gate)
- Pre-PR quality script: `npm run typecheck && npm run lint && npm run test`

#### Documentation
- README.md (5-minute tour, all key features)
- PROJECT_INTRO.md (1-hour deep-dive, this is the long-form reference)
- docs/QUICK_START.md
- docs/ARCHITECTURE.md
- docs/CONFIGURATION.md
- docs/EAA_BRIDGE.md
- docs/AGENT_AUTHORING.md
- docs/DESKTOP_BUILD.md
- docs/DISTRIBUTION.md
- docs/DEVELOPMENT.md
- docs/PRIVACY_ENGINE.md
- docs/CRON.md
- docs/FAQ.md
- docs/TROUBLESHOOTING.md
- docs/decisions/0001–0007 ADRs

### Notes for upgraders
- This is the first open-source release. There is no upgrade path from
  earlier versions; if you ran an internal build, the schema is forward-compatible
  but the settings format has changed.
- The `nul` file in the repository root (a Windows reparse-point residue from
  an earlier redirect) is git-ignored but can be safely removed by hand.

[Unreleased]: https://github.com/232252/education-advisor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/232252/education-advisor/releases/tag/v0.1.0
