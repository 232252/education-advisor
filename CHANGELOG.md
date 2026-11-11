# Changelog

All notable changes to **Education Advisor** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Repository scope** — This file documents the **desktop** repository at
> <https://github.com/232252/education-advisor>. The **Rust data engine (`core/eaa-cli/`)**
> (the `eaa-cli`) has its own
> [`CHANGELOG.md`](https://github.com/232252/education-advisor/blob/main/CHANGELOG.md)
> in its own repository. Cross-reference both when troubleshooting.

## [3.3.7] — 2026-11-09

### Changed

- **安装提速四轮瘦身（合并口径）**：安装解包文件 22,802 → **15,120**（−33.7%）、解包写盘 969MB → 840MB；安装耗时代理 **36.5s → 26.4s（−27.7%）**（`scripts/bench-install.mjs` 同机口径：解出 NSIS payload + 落盘风暴两段计时）；Setup.exe 323.0MB → 302.0MB（本地构建口径，CI 出包后回填）。
- **node_modules 整树解包 → 选择性解包**（安装时间由解包文件数主导，逐文件解压 + 杀软逐文件扫描是大头）：prepackage 新增 `scripts/compute-unpack-closure.mjs`，从 `@deepseek-ai/dsh` 依赖闭包 + 固定保留（pnpm 工具链 / pdfjs-dist / better-sqlite3 等原生包）生成落盘清单（559 包），与打包器实际发货集（715 包）求交；其余 147 个只有 Electron 主进程用的纯 JS 包（openai/@aws-sdk/@anthropic-ai 等）收进 app.asar——主进程读归档透明，安装时变成单个大文件顺序写。守卫双向核对：afterPack 对照 `build/unpack-closure.json`（闭包包必须真实落盘、落盘树不许有清单外的包），`verify:dsh --dist` 解析 asar 头确认归档内/外形态，并用随包 node.exe 离线跑 `dsh --version` 作闭包完整性的最终证据。
- **office 转 PDF 组件（libreoffice-kit，184MB/735 文件）改随包 zip 首用本地解压**：安装包只带 1 个 zip（65.8MB，afterPack 复制进 `resources/office-kit/`），首次需要时 `office-kit-service` 校验 sha256 后解压到 userData（不联网，一次性；闲时预热在首启后台完成，教师无感）；在线下载降级为 zip 损坏修复通道。dsh 子进程经既有 NODE_PATH 机制解析，零改动。安装少写 735 个文件/~110MB。
- junk 大扫除（afterPack）删掉两棵 node_modules 里的非运行文件共 ~3,500 项（`*.d.ts` 2,211、非声明 `*.ts` 688、构建配置散件 44、examples 目录 25、非 README/CHANGELOG 文档 172）；`@deepseek-ai`、vendored pi-ai、pnpm、pdfjs-dist、typescript 为保护树一刀不碰，运行时入口指向 `.ts` 的包自动豁免。依赖包 LICENSE/COPYING/NOTICE（345 个）与根目录 `LICENSES.chromium.html`（5.4MB，运行时无进程读）一并聚合为 `resources/THIRD-PARTY-NOTICES.txt` 单文件，法律文本保留、散文件清零。
- 字体三包（lxgw-wenkai-webfont 595 文件、@fontsource/jetbrains-mono 324、@fontsource-variable/inter）移出打包树——它们是纯构建期依赖，vite 发射进 dist 后包体不被任何运行时代码引用。
- `release.yml` windows 构建新增 `verify:dsh --dist` 产物门禁（此前发布产物本身无断言）；本版该门禁扩到 51 项（新增闭包落盘对照、asar 头断言、离线闭包冒烟、随包 zip 与清单字节一致等）。

### Fixed

- **打包态霞鹜文楷全部 404、批注手写体静默回退楷体**：`fonts.css` 的 `@import` 被 Vite 内联但 url() 不重写，97 个 unicode-range 分片在安装包里整体悬空——v3.3.6 为「补全字体」多花的 31MB 在安装包里实际不可达。改为 `main.tsx` JS import（与 jetbrains-mono 同路径），97 个 light 子集正确哈希发射进 app.asar；`verify:dsh --dist` 新增双向断言（分片发射 ≥90、无悬空 `./files/` 引用）。
- **office-kit「解压成功却报缺主程序」的存量 bug**：资产主二进制在 `bin/libreoffice-kit.exe`（打资产时打的是整包目录），服务代码一直查包根路径——下载/随包两条安装链路的就绪检测、就绪戳、状态卡与修复通道全部静默失效（组件实际已解压到位，功能碰巧可用）。修正为 `bin/` 布局并让测试夹具对齐真实资产；随包 zip 首用链路（预热 → 校验 → 落位 → 就绪戳）装机实测全通。

## [3.3.6] — 2026-11-09

### Added

- 官网下载页改版：新增 `eea-releases` Cloudflare Worker（`api.eea.qdzwwqd.top`）归一化 GitHub/Gitee Releases 数据，GitHub API 403 时走 ungh.cc 兜底；下载页改数据驱动，支持通道（稳定/预发布/历史）×平台×架构×下载源（GitHub 直连 / ghfast.top / v6 / hk 加速 / Gitee 镜像）组合与三级降级兜底。

### Changed

- 安装包 −28.8%：Setup.exe 453.7MB → 323.0MB（CI 实测发布口径，`verify:dsh --dist` 36/36）。CI 全新安装顺带补全了本地构建树缺损的 500+ 个 lxgw 文楷字体子集文件——323.0MB 才是完整功能面。
- 停发 Portable 便携版：`win.target` 只留 nsis，发布产物 2→1，单版下载量 542MB → 323MB；历史版本的 Portable 仍可从旧 Release 下载，下载页分类器保留。
- 全离线直装：office 转 PDF 组件 libreoffice-kit（178MB）随包分发，`bundledPkgDir` 优先命中随包目录，Release 下载链路保留为损坏修复通道（sha256 + ghfast 双源）；连接中心依赖修复通道加 `--prefer-offline`、超时 10 分钟→3 分钟快速失败，首启预热命中随包目录即短路——安装与首开全程不联网。
- CI `release.yml` 显式跑 `prepackage`（此前 CI 从不 stage dsh-node / office-kit 资产 / dsh-im 依赖，一直靠本地出包）。

### Fixed

- 新装机器连接中心必坏的两处打包回归：electron-builder 复制 extraResources 时整目录丢弃 node_modules（`resources/dsh-im/node_modules` 缺失，qrcode 标记落空走在线回退）；复制模块树时无条件跳过嵌套 node_modules（`pnpm/dist/node_modules` 缺失，回退安装的 pnpm 启动链也是死的）。两处均由 afterPack 钩子（NSIS 压缩前）手工补齐并加守卫断言。
- 顺带清理：dxcompiler.dll、非本平台 eaa-binaries、better-sqlite3 非 win32-x64 prebuilds 与 deps、openai/src（TS 源码）不再进包；`verify:dsh --dist` 新增离线三件套断言（qrcode 标记 / pnpm dist / 随包 kit）。

## [3.3.5] — 2026-11-08

### Changed

- DeepSeek 底座升级到 `0.2.2-rc.1`：`@deepseek-ai/dsh`（由 `dsh-sdk-client` 传递 pin）及全部 325 个 `dsh-*` 包同版；`dsh-llm` / `dsh-sdk-client` / `dsh-sdk-protocol` / `dsh-session` 保持精确 pin，配套 `cordis` 4.0.5→4.1.0、`cordis-plugin-group` 1.0.5→1.1.0。rc.5→0.2.2 的 dsh-base 差异：`tool-subagent-list-agents` 行移除、新增 `tool-executor-native/ptc` 执行器行、sdk-app 新增 `tool-schedule`/`tool-ask-user`/`present` 三个模型工具——禁用补丁按 id 逐个点名补齐为 21 行，工具执行器（MCP 桥依赖的 native）不动。
- 连接中心插件 `@xmanrui/dsh-im` 从 4.37.0 升到 5.10.0：5.9.1 新增企业微信自建应用、WhatsApp、iMessage，5.10.0 再加 office 文档处理渠道与投递同步；`dshImClient` 仍为 v1（`render`/`setSettingsVisible` 面板接口逐个核对未变），`integrations/eaa-panel` 嵌入无需改壳。`DSH_IM_CHANNEL_IDS` 同步四个新渠道，避免设置页重复出卡。
- 模型目录 `@earendil-works/pi-ai` 从 1.3.0 升到 1.4.0，重放两处定制：流式 tool-call 参数不在每个 delta 重解析（仅保留完成事件的解析），`bedrock-converse-stream.lazy.js` 改静态 import 以便 Electron 打包产出 chunk；共享 SDK 的依赖 pin 保持不变。
- 模型目录随包的 `@earendil-works/pi-ai` 从 0.85.1 升到 0.87.1，与 DeepSeek Harness `dsh-llm-pi-ai@0.2.1-alpha.1` 声明的版本一致，并带上 Harness 的工具参数流式补丁。教师对话和智能体循环仍由 DeepSeek Harness 执行。

## [3.3.4] — 2026-09-25

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

### Removed

- pi-agent-core 依赖与 `vendor/pi-agent-core/` 源码树彻底移除（底层运行时已由 DeepSeek Harness(dsh) 接管并设为默认）：package.json/tsconfig/lockfile 同步收口，相关测试适配，agent-loop e2e 暂缓为 `.skip`（待 dsh 侧等价用例），安装包不再携带死代码。

### Fixed

- 设置「关于」与仓库对齐：Vite 写成 8.2；模型目录写成随包的 pi-ai 0.87.1；Agent 运行时写明 dsh 0.2.1-alpha.1；补上连接中心插件 dsh-im 4.37.0。
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

[Unreleased]: https://github.com/232252/education-advisor/compare/v3.3.7...HEAD
[3.3.7]: https://github.com/232252/education-advisor/compare/v3.3.6...v3.3.7
[3.3.6]: https://github.com/232252/education-advisor/compare/v3.3.5...v3.3.6
[3.3.5]: https://github.com/232252/education-advisor/releases/tag/v3.3.5
[3.3.4]: https://github.com/232252/education-advisor/releases/tag/v3.3.4
[3.3.3]: https://github.com/232252/education-advisor/releases/tag/v3.3.3
[3.3.2]: https://github.com/232252/education-advisor/releases/tag/v3.3.2
[3.3.1]: https://github.com/232252/education-advisor/releases/tag/v3.3.1
[3.3.0]: https://github.com/232252/education-advisor/releases/tag/v3.3.0
[0.1.0]: https://github.com/232252/education-advisor/releases/tag/v0.1.0
