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

### Planned
- Multi-class support (one teacher, N parallel classes)
- Voice channel (push-to-talk during class) with on-device transcription
- Plugin marketplace (community-contributed agents & skills)
- Windows ARM64 installer
- Tauri parity build

## [3.3.2] — 2026-09-12

### Fixed
- Windows 安装包启动弹出 **A JavaScript error occurred in the main process**（窗口标题 Error）：`require("@earendil-works/chord/context")` 命中 ESM-only `exports`，抛出 `ERR_PACKAGE_PATH_NOT_EXPORTED`。已把 `@earendil-works/*` 打进主进程 CJS bundle。
- 生产 `app://` 改为用 `fs.readFile` 读渲染文件，避免再走 `net.fetch(file://)`。

## [3.3.1] — 2026-09-12

### Fixed
- Windows 安装包打开后窗口标题为 Error、页面 403：`app://` 把 `/index.html` 拼成盘符根路径。现改为相对拼接，并用 `pathToFileURL` 读本地文件。

## [3.3.0] — 2026-09-11

### Added
- AI 批改作业：量规、卷面识别、复核、痕迹 PDF、发布进学业分析
- 花名册按文件导入；身份证写入档案并由隐私引擎脱敏
- 仪表盘操行 / 成绩双视图，学业与学生档案互跳
- 局域网 WebUI（去掉 Cloudflare 隧道）

### Changed
- Pi 底层 0.84.2 → 0.85.1，模型列表改跟 pi 目录
- 中文 README 封面；GitHub 社区标准文件（行为准则 / 贡献 / MIT / 安全）
- Release 改为 GitHub Actions 手动触发即可云端打包发布，质量门禁只跑一次

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

[Unreleased]: https://github.com/232252/education-advisor/compare/v3.3.2...HEAD
[3.3.2]: https://github.com/232252/education-advisor/releases/tag/v3.3.2
[3.3.1]: https://github.com/232252/education-advisor/releases/tag/v3.3.1
[3.3.0]: https://github.com/232252/education-advisor/releases/tag/v3.3.0
[0.1.0]: https://github.com/232252/education-advisor/releases/tag/v0.1.0
