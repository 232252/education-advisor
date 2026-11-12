# 官方 DSH 插件标准与产品插件化计划（已定）

- 状态：已拍板。方向变更须再明确同意。
- 日期：2026-11-11
- 范围：官方插件写法（0.2.2-rc.1 随包运行时实测）、现有桌面功能能否做成官方形态的插件/技能、以及「模型设置」作为第一个落地项。
- 相关：[核心运行时规划](./DSH_CORE_RUNTIME.md)、[插件化远景](./DSH_PLUGIN_VISION.md)

本文先锁定官方标准，再按模块给出建议。本轮只实现模型设置插件，不改写其它模块。

---

## 1. 官方插件标准（必须遵守）

依据随包运行时 `@deepseek-ai/*@0.2.2-rc.1`、第三方官方形态插件 `@xmanrui/dsh-im@5.10.0`，以及本仓库已采用的 `vendor/eaa-*` 写法。只认公开面，禁止按官方源码行号打补丁，禁止猴子补丁内部实现。

### 1.1 两种包，不要混用

**Bundle（功能束）** 才出现在 profile 的 `dsh.profile.bundles` 里。它是一个 npm 包，在 `package.json` 里声明：

```json
{
  "name": "@scope/example-bundle",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./host.js",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

可选公开字段：

- `dsh.bundle.listedByDefault`（布尔；官方 plugin-manager 用它决定默认是否在 GUI 列出）
- `dsh.client`（仅 Web/UI 插件需要，如 dsh-im 的 inject / platform）
- `dsh.compatibility.dsh`、`dsh.compatibility.dshReleases`、`dsh.compatibility.profiles`（第三方 bundle 声明兼容的 DSH 版本与 profile；dsh-im 即此写法）

官方例子：`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-experimental-ralph-bundle` 等实验束、`@xmanrui/dsh-im`。它们的 `cordis.patch.yml` 都是「向 loader 插入或覆盖行」。

**Plugin row（cordis 行）** 是被 bundle 的 patch `insert` 进去的包，通常**没有** `dsh` 键。例如 `@deepseek-ai/dsh-llm-pi-ai`、`@deepseek-ai/dsh-llm-deepseek-api-key`、`@deepseek-ai/dsh-tool-skill`、`@deepseek-ai/dsh-mcp-client`。它们靠 bundle（如 `dsh-base`）声明 `id` + `name` 加载。

本仓库现有 `vendor/eaa-tools`、`eaa-roster`、`eaa-grades`、`eaa-grading` 已经是 Bundle：`dsh.bundle.patch` 指向 YAML，`host.js` 只导出空的 `apply()`，patch 里 `insert` 官方 `@deepseek-ai/dsh-mcp-client` 并注入环境变量名。这与 dsh-im、ralph-bundle、terminal-bundle 同一套路，应继续沿用，不要另开加载通道。

### 1.2 如何装进 profile（公开形态）

官方加载只看两件事：

1. `profiles/<name>/package.json` 的 `dsh.profile.bundles`（包名列表）
2. 从该 profile 目录按 Node 规则能解析到 `node_modules/<包名>/package.json`

官方 `dsh plugin add` 还会改 lockfile 并调用 pnpm。教师机不带 pnpm，也不现场执行 `dsh plugin add`。本仓库用 `plugin-links.ts` 写出**与官方相同的最终形态**（`link:` 依赖、bundles 列表、junction/符号链接）。这是安装方式的替代，不是另一种插件格式。

官方模板与本仓库一致：新建 sdk profile 垫 `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-sdk-app`；web profile 垫 `dsh-base` + `dsh-web-app`。

Patch 层顺序（官方约定，以及本仓库 hardening 注释）：**bundle → profile 自身的 cordis.patch.yml → 命令行 --patch**。同一行 id 后写覆盖。目标行不存在只是 loader 警告，不会让进程起不来。

教师开关插件的官方模型：该 bundle 是否出现在当前 profile 的 `dsh.profile.bundles` 中（官方 plugin-manager 的 enabled / installed）。教育参谋的「技能」页插件页签应对齐这一模型，而不是再维护一套互不相认的开关。

### 1.3 模型路由：只用官方公开配置面

不要自己调用 `ctx.llm.registerAdapter`，不要改 `dsh-llm-pi-ai` 源码。

- `dsh-base` 的 `cordis.patch.yml` 已经插入 `id: llm-pi-ai`（`@deepseek-ai/dsh-llm-pi-ai`）和 `id: llm-deepseek`（`@deepseek-ai/dsh-llm-deepseek-api-key`）。
- `llm-deepseek` 注册的原生路由名写死为 **`deepseek-official`**。pi 侧的 `deepseek` 必须映射到这个名字（本仓库 `DSH_BUILTIN_ROUTE_ALIASES`），否则会报 `no adapter registered`。
- `llm-pi-ai` 的 `Config.providers` 默认是空字典（休眠）。要让第三方/国产线路出现在 `llm.listProviders()` 里，唯一稳定做法是给这一行写公开配置：`config.providers`。**字典的键就是路由名。**
- 公开字段（以运行时 schema 为准）：`apiKeyEnv`（只写环境变量名，不写密钥）、`api`（如 `openai-completions`）、`baseURL`、`models`（`id` / `name` / `contextWindow` / `maxTokens` / `input` / `reasoningEfforts`）、`retryPolicy`、`cacheRetention`、`timeoutMs` 等。
- 凭据：官方 Web Models 页写入 credentials 服务（DSH_HOME 下的 `.credentials.yaml`），或通过 `apiKeyEnv` 读进程环境。教育参谋的密钥留在应用 keystore，启动子进程时注入对应环境变量。插件文件、YAML、日志里不得出现密钥本身。
- SDK 握手（`dsh-sdk-jsonrpc-server` 的 `initialize`）：先 `hasAdapterFor(provider)`（查 `llm.listProviders()`）。没有该路由时，**只对 `deepseek-official` 自动挂载** DeepSeek 适配器；其它名字直接抛 `no adapter registered for provider "..."`。这就是 2026-11-11 教师对话用 `zai-coding-cn` 失败的直接报错点。

当前失败还说明：宿主把 `eaa-llm-providers.cordis.patch.yml` 作为 spawn 时的 `--patch` 传进去（命令行已核实包含该文件，内容也已列出 `zai-coding-cn`），但 initialize 仍看不到适配器。因此「EAA/pi 目录单独维护，再在启动时用外部 --patch 映射进 DSH」不是可靠的官方路径，也不能作为模型设置的源。新方案必须把路由声明放进 **bundle / profile 这两层官方配置**，让 `llm-pi-ai` 在 profile 加载时自己注册，而不是事后再补一刀。

官方没有单独的「设置 UI 插件」样板。模型设置应做成 **provider 配置 bundle + profile 层对 llm-pi-ai 的配置覆盖**。教育参谋的「模型」页只做宿主薄 UI，读写的是这一份 DSH 配置，不再维持一套 DSH 不认的运行时目录。

### 1.4 技能：技能仍是技能，不是插件本身

官方技能栈（均由 `dsh-base` 带上，公开行 id）：`dsh-skill`、`dsh-skill-filesystem`、`dsh-tool-skill`。技能正文是带 frontmatter 的 Markdown（官方要求小写短横线名称）。`skill-filesystem` 的公开配置包括 `customSkillDirs`、`includeDefaultRoots`、`watch` 等。本仓库已在用：每次运行把该角色可见的技能复制到临时目录，再写补丁把 `skill-filesystem` 钉在这份目录上（`skill-mount.ts`）。这就是接到官方 DSH skills 的正路，应保留并加强。

「技能」工作台已经有三个页签：技能 / MCP / 插件。这与下面的产品模型一致，应对齐做实，而不是把技能改写成插件：

- **技能**仍是技能文档（官方 skill 目录里的 Markdown），教师可启用或停用某一份技能。
- **插件**是技能工作台里的一类能力：对应 profile 上的官方 bundle，教师可启用或停用（写入 / 移出 `dsh.profile.bundles`）。
- **MCP** 仍是外部工具端点，不属于「把技能本身做成插件」。

### 1.5 小升级兼容（对齐核心运行时规划）

保持稳定、小升级只改 pin + CI 的面：

- bundle 清单格式（`dsh.bundle.patch`）与 profile `bundles` 列表
- cordis 行 id（`llm-pi-ai`、`skill-filesystem`、`dsh-mcp-client`、加固名单里的工具行等）
- `llm-pi-ai` 的 `providers` 配置字段
- SDK 公开方法：`initialize` / `prompt` / `subscribe` / `close`
- dsh-im 的 `dshImClient` 主版本

会变、禁止依赖：

- 官方源码行号或内部 `registerAdapter` 调用细节
- 官方 `dsh-client-ui-*` 设置页
- 教师机现场 `dsh plugin add` / pnpm
- 把官方「探索未至之境」嵌进产品 UI

新工具行未登记仍由现有 CI 门禁拦住，补进允许或关闭名单即可。

---

## 2. 现有功能盘点与建议

侧栏唯一数据源是 `src/renderer/config/nav-items.ts`，当前入口为：仪表盘、对话、学生、班级、学业、批改作业、Agent、模型、技能、任务（定时）、隐私、报告中心、设置。另有首次启动的 Welcome 介绍视频（`docs/intro-video.md` / `intro.mp4`），不是侧栏模块。

**没有「影视」功能模块。** 全库 `src/`、`docs/` 与导航配置中均无影视业务页。介绍视频只用于欢迎页播放，不要虚构一个影视插件或改造计划。

对每个现有模块的建议如下。「本轮」只做第 2.8 节的模型设置；其余保持现状，以后按同样的官方形态加，不在这一次重写。

### 2.1 仪表盘

应保持为 **EAA 宿主 UI**。它聚合本机已有数据，不是一套要交给模型调用的能力，也不存在对应的官方 DSH 页面或 bundle。做成 DSH 插件没有稳定公开面，小升级也得不到好处。

### 2.2 对话

**宿主 UI + 已在用的 DSH 后端。** 教师对话已经走 `dsh --profile sdk` / `createDshAgent`，事件映射到本应用对话界面。不要把官方会话页嵌进来（见核心运行时规划）。对话本身不是一个 bundle；它是 sdk profile 上所有教育插件与模型路由的宿主入口。

### 2.3 学生、班级

**已经是官方形态的 DSH 插件后端 + 宿主页面。** `vendor/eaa-roster` 以 bundle 插入官方 `dsh-mcp-client`，工具名在模型侧为 `mcp__roster__*`。页面 `/students`、`/classes` 留在宿主（学生数据不得进插件包）。教师开关应对齐是否把该 bundle 留在 sdk / web 的 `dsh.profile.bundles`。本轮不改写页面。

### 2.4 学业

**已经是插件后端 + 宿主页面。** `vendor/eaa-grades`，公开名 `mcp__grades__*`，页面 `/academics`。建议同 2.3：页面留在宿主，开关走 profile bundles。

### 2.5 批改作业

**工具面已经是插件，批改流水线与页面留在宿主。** `vendor/eaa-grading` 提供模型可调用的批改工具（`mcp__grading__*`）。识别试卷、评分、校准、页面 `/grading` 是本应用自己的流水线，没有可对等的官方 DSH 批改 UI。不要把整页搬进官方界面插件。教师对「批改工具」的开关走 bundle；页面本身随宿主保留。

### 2.6 Agent

**宿主管理界面 + 已在用的 DSH 循环。** `/agents` 管理本应用的角色、说明与调度；真正跑起来已经是 `createDshAgent`。远景里的「每个角色一个插件」可做，但不是必须，也不是本轮范围。调度仍由宿主叫醒（见 2.10）。不要把 Agent 页改成官方 agent-preset UI。

### 2.7 技能（含插件能力的开关）

**技能保持为官方 DSH skills；插件是技能工作台里可开关的一类能力。** 正文继续放在本仓库 `skills/` 与用户技能目录，经 `skill-filesystem` 加载。教师应能随时启用或停用：

- 某一份技能（是否进入该次运行的技能目录）
- 某一个教育 bundle / MCP 端点（是否出现在对应 profile 的 bundles，以及宿主是否注入该组地址）

「技能页」仍是宿主编辑与开关 UI，不要把技能文档本身做成 cordis 插件。本轮不重做技能页，只在标准里把模型锁定，避免以后走错。

### 2.8 模型（本轮唯一实现项）

**现状（应改变）：** 「模型」页维护的是本应用的 pi 目录与 keystore；教师对话再经 `provider-patch.ts` 写一份 `eaa-llm-providers.cordis.patch.yml`，作为 `createDshRuntime` 的 `--patch` 传给 DSH。2026-11-11 实测：pi 侧在线拉取 `zai-coding-cn` 的 12 个模型成功，设置里默认 `zai-coding-cn` / `glm-5.3-flash`，keystore 有该线路密钥，但 `dsh --profile sdk` 的 `initialize` 报 `no adapter registered for provider "zai-coding-cn"`。架构是反的：源在 EAA，DSH 只是被事后打补丁，而且这条补丁没有让适配器出现。

**决定：** 做成官方形态的 **模型设置 bundle**（建议目录 `vendor/eaa-llm-providers`，包名 `@education-advisor/eaa-llm-providers`）。它不实现新的 LLM 适配器，只按 1.3 节配置已有的 `llm-pi-ai` 行。实时路由名单写在 **profile 层** `profiles/sdk` 与 `profiles/web` 的 `cordis.patch.yml`（或与之合并的官方 profile 补丁），因为安装目录里的 bundle 文件在教师机上可能只读，而且每台教师的线路不同。Bundle 本身随包预装并 `link:` 进 sdk / web profile，与其它 `eaa-*` 相同（打包 extraResources + 首启/升级 `materializeProfileLinks`，无教师端 pnpm）。

「模型」页继续做教师面向的宿主 UI，但读写的是这份 DSH `llm-pi-ai` 配置（providers、baseURL、协议、模型条目、`apiKeyEnv` 名）。拉取模型目录仍可借助已随包的 pi-ai 目录/在线刷新来填写官方 `models` 列表，但 DSH 是否认这条路由，只取决于 profile 里是否声明了它。密钥仍只存在应用 keystore，启动时注入环境变量。覆盖本机已配置的线路（至少包括当前的 `zai-coding-cn` / `glm-5.3-flash` 与 `minimax-cn`），而不是写死一家。`deepseek` 仍走官方 `deepseek-official`，不要抢注册。旧的宿主 `--patch` 在新路径生效后降级或删除，不能再当主路径。

成功标准：用当前模型在教师对话走通一轮，不再出现 `no adapter registered`；以后官方小升仍然是改 pin、跑 CI，不必重写这个插件。

### 2.9 连接中心

**已经是官方插件。** `@xmanrui/dsh-im` + `eaa-dsh-im-panel` 按 bundle 装进 web profile。保持这一形态。

### 2.10 任务（定时）

**留在宿主。** `/scheduler` 负责「没有打开会话也要跑」的日报与定时角色。官方 `dsh-schedule` 只向已打开的会话投提醒，替不了这件工作（已在插件化远景中说明）。不要把本应用的定时器改成官方 schedule 工具。

### 2.11 隐私

**留在宿主。** 脱敏发生在工具结果离开本机之前，没有对应的官方 DSH 插件公开面。页面 `/privacy` 保持宿主实现。

### 2.12 报告中心

**当前是宿主页面。** 以后如需插件，可做读快照写文件的 `eaa-reports` bundle，不自己改操行数据。本轮不做。

### 2.13 设置、更新、托盘

**留在 Electron 宿主。** 窗口、自动更新、托盘、本机 WebUI 端口等不是 DSH bundle 的职责。

---

## 3. 本轮落地范围

只做 2.8 的模型设置插件，并补测试与本机对话验证。不重写学生/班级/批改/Agent/技能等模块。不推送、不打标签、不把未确认的包发到远程。

宿主仍只负责：窗口与更新、密钥与隐私、dsh 进程、插件安装目录与 profile 链接。