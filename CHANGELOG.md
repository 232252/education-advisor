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

- 成绩汇总 CSV 导出（任务详情「导出成绩汇总」）：纯函数 `buildSummaryCsv` 生成 utf-8-sig（`\uFEFF`，Excel 直开）CSV，列=序号｜姓名｜逐题生效分｜总分｜缺题数｜批语，末尾统计块含平均/最高/最低/中位数与分数段人数；逐题/总分与发布同口径（教师覆盖优先），未归组/未批改/分数不完整卷不进学生行；路径来自渲染层保存对话框，主进程写盘（新 IPC `grading:export-summary-csv`）。
- 逐页批注 PDF 直出（批阅痕迹预览工具栏「导出 PDF 文件」）：主进程 `webContents.printToPDF({printBackground:true})` 落盘（新 IPC `grading:export-annotated-pdf`）。pageSize 走新增 `paperSpecToPdfPageSize`（mm/25.4 英寸、round 0.001in；A4/A3 仍原生枚举）——printToPDF 的数字 pageSize 单位是英寸，与 `webContents.print` 的微米口径 `paperSpecToPrintPageSize` 并列互斥，禁止跨 API 复用。**pageSize 单位实测（人工/集成验收 demo，`tmp/pdf-pagesize-demo.mjs`）**：对隐藏 BrowserWindow 以 B5(176×250mm)→{width:6.929, height:9.843}in 调 printToPDF，pdfjs-dist 读回第 1 页 MediaBox=498.96×708.96pt（6.9300×9.8467in，合 176.02×250.11mm），与传入英寸值误差 0.0010/0.0037in（<0.02in 判据），证实英寸口径接线正确。真实打印机双面属人工验收，UI 保留「驱动不支持时手动双面」提示。
- 打印排序与双面：`sortPapersForPrint` 迁至 `@shared/grading-helpers`（hook 文件含渲染层依赖，共享测试不可直 import），支持 name-asc（默认）/name-desc/upload-asc 三序（任务详情「打印顺序」下拉）；静默连打透传 `duplexMode`（simplex/shortEdge/longEdge，electron 字段名为 duplexMode 非 duplex）并在套打工作台提供双面选择，非法值由 handler 值域校验拒绝。
- AI 批改置信分级：`AiQuestionResult` 新增可选 `confidence`——客观题转写复验后仍读不准、主观题贴边界复验分歧取中位的题标 `medium`（判分照旧，参考包 M 级「采信但登记待复核」口径）；`reviewPriority(paper)` 纯函数（双评分歧 > 中置信题 > 普通卷）驱动复核列表排序。
- 无姓名续页兜底归组：卷面识别主循环后新增续页链式并入——同源文件名（PDF 拆页 `原名-pN.jpg`）+ 连续页号的前一页已归属、且该生卷尚无 AI 结果时，空身份续页自动并入该生（`shouldMergeContinuation` 保守口径：读出过姓名/编号的页绝不自动并——可能是名册外学生；识别失败未留痕的页不并——读失败≠卷面没写；页链断档不跨并）；`IdentifyPapersResult` 新增 `continuationMerged`，识别完成提示带「续页自动并入 N 页」。
- 人工合并入口：试卷列表指派到「名下已有卷」的学生时内联三选（并入续页/另立一份/取消），经新 IPC `grading:merge-papers` 走 `appendPaperPages`（已批改卷拒绝并入），自动识别兜不住的多页卷由教师一键指路。
- 复核工作台逐题置信徽标：中/低置信题（涂色偏淡/字迹模糊/两评居中）在题名旁显示「待斟酌」标记（悬停说明原因），不再只影响列表排序。
- 样卷文件选择器补齐主进程已支持的全部格式（xlsx/xls/csv/yaml/yml/zip），清单收敛到 `@shared SAMPLE_PICK_EXTENSIONS` 单一来源，与 `isSampleExt` 的双向契约由测试锁定（tests/main/sample-ingest.test.ts）。

### Changed

- 词耗节省（不降质量）：① locate 复用母版——`overlayTemplate.boxes` 覆盖全部量规题且卷页数与标定页数一致时直接用模板坐标跳过逐卷 locate（每卷省一次全页图输入），不一致回落；② 双评共享——dual 档两模型共享一次 locate 与页图缓存（几何定位/读盘非评分判断），各自批改调用独立计数不减；③ 重试收敛双路——staged `withRetry` 与 `regradePapers` 外层重试共用 `isGradingParseError` 分类器，解析类错误（坏 JSON/缺题/越界）不再重试直接上抛（坏 JSON 从整卷 2 次调用收敛为 1 次），传输/中止类照旧；④ fast 档输出预算自适应——量规超 8 题每题 +512（`fastGradeMaxTokens`，8192 基数），仍被 `model.maxTokens` 钳制，防截断→缺题→failed→整卷重跑。
- AI 批改发布与逐题成绩统一按量规口径：AI 主结果缺题（如模型输出截断）不再落库，该卷标 failed 可重试；存量缺题任务重新发布时整卷跳过（教师需重改或补复核该卷）——把「总分=部分和、逐题缺一科」的错分显性化。
- 单选/判断题参考答案解析支持区段与逐题对混排合并；题名可推导出期望小题数（「共 N 小题」/「每小题 X 分」）时按期望校验，部分解析回落模型批改，不再静默按「缺省=对」计分。
- 卷面识别结果通知补齐合并/重复/续页计数（`IdentifyPapersResult` 契约含 `merged`/`continuationMerged`/`duplicates` 字段，由识别链路透传）。

### Fixed

- 卷面识别页眉裁剪只认 jpeg/png：webp/bmp 试卷首页此前无图调模型必然读空身份归 unresolved，现在同样走页眉放大裁剪（`HEADER_CROP_MIMES` 路由，loadImage 按内容解码）。
- 发布写成绩失败后重试不再生成同名新考试：考试 id 创建后立即回填落盘，重试按 (examId, subjectId) 幂等覆盖残分。
- 主观题贴边界复验取中位落在第二/三采样时，批注 box 统一映射为整页坐标（此前会保留裁剪图口径）。
- 规则判分每小题分值取消前置舍入：整除性差的除法分支（如 10 分 3 小题全错）不再出现 0.01 残差。
- 清扫套打迭代遗留的 5 个零引用 i18n 键（underlay/calibrationPage/needManual/silentPrint/masterHint），i18n 死键守卫恢复通过（该失败先于本次改动存在）。

### Planned
- Multi-class support (one teacher, N parallel classes)
- Voice channel (push-to-talk during class) with on-device transcription
- Plugin marketplace (community-contributed agents & skills)
- Windows ARM64 installer
- Tauri parity build

## [3.3.3] — 2026-09-12

### Added
- 模型供应商列出 pi 全部内置厂商；智谱 / MiniMax / 通义千问 / 小米等中国区显示中文名，可用「智谱」「中国版」搜索。

### Changed
- 推送 `main` 且 `package.json` 版本尚未发过时，由 GitHub Actions 云端打包并发布安装包（不再依赖本机编译或手动 Run workflow）。

### Fixed
- 智谱测试连接不再选用 Highspeed 套餐模型（目录标价 0），避免普通套餐 429/1311 被误判为密钥无效。

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

[Unreleased]: https://github.com/232252/education-advisor/compare/v3.3.3...HEAD
[3.3.3]: https://github.com/232252/education-advisor/releases/tag/v3.3.3
[3.3.2]: https://github.com/232252/education-advisor/releases/tag/v3.3.2
[3.3.1]: https://github.com/232252/education-advisor/releases/tag/v3.3.1
[3.3.0]: https://github.com/232252/education-advisor/releases/tag/v3.3.0
[0.1.0]: https://github.com/232252/education-advisor/releases/tag/v0.1.0
