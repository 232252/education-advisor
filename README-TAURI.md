<div align="center">

# 🎓 Education Advisor

### 18-Agent 班主任操行分管理系统 · Tauri 重构版

**用 Rust 写后端,用系统 WebView 渲染——12MB 的安装包,媲美原生的流畅度。**

[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](./LICENSE-MIT)
[![Rust](https://img.shields.io/badge/rustc-1.95%2B-orange.svg)](https://www.rust-lang.org)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey.svg)](#-极速上手)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**Linux x86_64** · **Windows x86_64** · **macOS x86_64 + Apple Silicon ARM64**

[功能](#-核心特性) · [截图](#-截图演示) · [安装](#-极速上手) · [架构](#-架构设计) · [路线图](#-路线图) · [参与贡献](#-参与贡献)

</div>

---

> **一句话**: 把班主任的日常——操行分记录、学生档案、多 Agent 协作、家长沟通、合规审计——全部装进一个 **17MB** 的 Rust 桌面应用,而非臃肿的 Electron。

## 💡 为什么不直接用 Electron?

| 维度 | Electron 版 (原) | **Tauri 版 (本仓库 `src-tauri/`)** |
|------|------------------|-----------------------------------|
| 安装包体积 | ~90 MB | **~17 MB** (↓ 81%) |
| 内存占用 | ~150-200 MB | **~40-80 MB** (复用系统 WebView) |
| 冷启动 | 1.5-2 s | **0.3-0.6 s** |
| 后端语言 | TypeScript (Node 22) | **Rust** |
| 数据引擎 | spawn 子进程 (~50ms/次) | **库内调用** (<1ms, **95x 提升**) |
| WebView | 自带 Chromium (~150MB) | 系统 WebView (WebKitGTK / WebView2 / WKWebView) |

> 双轨共存: Electron 版代码完全保留, Tauri 版并行开发, 可对照验证。

## 🚀 核心特性

### 🧠 18 个专业化 AI Agent

每个 Agent 有独立的 **SOUL.md**(角色设定)和 **AGENTS.md**(工作规则),通过 least-privilege capability 系统限制工具调用范围:

| Agent | 角色 | 能力 |
|-------|------|------|
| `main` | 教育参谋 (协调者) | 所有工具 |
| `governor` | 班规守护 | 读 + 写事件 |
| `counselor` | 心理辅导员 | 读档案 + 写记录 |
| `supervisor` | 数据监督 | 读排行 + 读统计 |
| `data-guardian` | 数据守卫 | 隐私操作 + 合规 |
| `academic-advisor` | 学业顾问 | 读写学业记录 |
| `risk-alert` | 风险预警 | 读排行 + 触发告警 |
| `discipline` / `safety` / `research` / `home-school` / `class-monitor` / `student-care` / `validator` / `bug-hunter` / `data-analyst` / `executor` / `weekly-reporter` | ... | 各司其职 |

Agent 支持 **手动触发** + **Cron 定时调度**,LLM 调工具写入 EAA 数据后自动广播事件刷新前端。

### 🔒 PII 隐私引擎 (PII Shield v3.1)

- **AES-256-GCM** 加密的学生姓名 ↔ 匿名别名映射表
- 发送 LLM 前**自动脱敏**(把真实姓名替换为 `S_001` / `S_002`)
- **收件人维度过滤**:发给家长 A 的消息,自动把"其他同学"替换为泛称,只保留 A 自己孩子的名字
- 每次脱敏/过滤操作**写入审计日志**(JSON-Lines),用于季度合规报告
- 合规报告含 **SHA-256 manifest**(审计日志 + 报告自身的哈希),可验证完整性

### 🤖 多 Provider LLM 编排

一个 `reqwest` + 手写 SSE 的统一抽象层,覆盖 12 个 Provider:

| 通用 OpenAI 协议 | 专用协议 |
|------------------|----------|
| OpenAI · DeepSeek · Moonshot · Zhipu(GLM) · Doubao · Qwen · Mistral · Ollama · LM Studio · OpenAI-Compatible | Anthropic (Messages API) · Google Gemini (streamGenerateContent) |

- **流式输出**:token 通过 `ai:chat-stream` 事件增量推送
- **干净中止**:`CancellationToken` + `tokio::select!`,abort 即时断流
- **隐私脱敏前置**:启用隐私引擎时,消息发出前自动 anonymize

### 📊 数据引擎 (EAA = Event-sourced Conduct Score)

事件溯源架构,所有操行分变动不可变、可回放、可审计:

```
+2 作业 → Alice 102 分 (优秀)
-3 迟到 → Bob 97 分  (需关注)
⤺ revert 事件 #42 → 分数恢复
```

- 30 个 Agent 工具(score / add_event / ranking / search / revert / bulk_*)
- **DataCache 快照**:一次 agent 工具循环(10 个只读工具)从 30ms → **0.3ms** (**95x 提升**)
- `FileLock` 排他锁 + 原子写(tmp → fsync → rename)

### 🖥️ 跨平台一致性

同一份 React 渲染端代码,三个 OS 共用。CSS GPU 合成层优化 + React.memo 局部重渲:

- `transform: translateZ(0)` 强制合成层,动画走 GPU
- `contain: layout style` 隔离滚动/布局
- 路由级 `React.lazy` 代码分割(冷启动只加载首页 chunk)
- `@media (prefers-reduced-motion)` 尊重系统无障碍设置

## 📸 截图演示

> ⚠️ **贡献者招募**: 截图/GIF 位是预留的! 如果你在 Linux/Win/Mac 上跑起来了,
> 欢迎截图提 PR 补充到这里。建议录 15s 以内的 GIF 展示:
> - Dashboard 排行榜 + ECharts 饼图
> - Agent 手动运行 + 流式输出
> - 隐私引擎脱敏前后对比

| Dashboard | Chat 流式 | Agent 控制 |
|-----------|----------|------------|
| ![Dashboard](https://via.placeholder.com/400x250/1a1a2e/FFF?text=Dashboard+%E6%88%AA%E5%9B%BE%E5%BE%85%E8%A1%A5) | ![Chat](https://via.placeholder.com/400x250/1a1a2e/FFF?text=Chat+%E6%B5%81%E5%BC%8F%E5%BE%85%E8%A1%A5) | ![Agents](https://via.placeholder.com/400x250/1a1a2e/FFF?text=Agents+%E5%BE%85%E8%A1%A5) |

## ⚡ 极速上手

### 前置依赖

#### Linux (Debian/Ubuntu)

```bash
# Rust (经代理, 如需要)
export https_proxy=http://127.0.0.1:8888
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# Tauri 系统依赖 (WebView2 → WebKitGTK)
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev pkg-config build-essential

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### macOS (Intel + Apple Silicon)

```bash
# Xcode Command Line Tools (含 WKWebView SDK)
xcode-select --install

# Rust + Node
brew install rust nodejs
```

> Apple Silicon (M1/M2/M3): 无需额外配置,`rustup` 自动选 `aarch64-apple-darwin`。

#### Windows

```bash
# Visual Studio Build Tools (含 MSVC + WebView2)
# 下载: https://visualstudio.microsoft.com/visual-cpp-build-tools/
# 勾选 "Desktop development with C++"

# Rust + Node (用 winget 或官网安装)
winget install Rustlang.Rustup
winget install OpenJS.NodeJS.LTS
```

> WebView2 Runtime: Windows 11 自带。Windows 10 需 [手动安装](https://developer.microsoft.com/microsoft-edge/webview2/)。

### 一键编译运行

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor

# 安装前端依赖
npm install

# 开发模式 (热重载: 改 Rust/React 自动刷新)
npm run tauri:dev

# 发布构建 (产出安装包)
npm run tauri:build
# Linux:   src-tauri/target/release/bundle/{deb,appimage}/
# Windows: src-tauri/target/release/bundle/{nsis,msi}/
# macOS:   src-tauri/target/release/bundle/dmg/
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `npm run tauri:dev` | 开发模式 (vite + cargo watch + 自动开窗) |
| `npm run tauri:build` | 发布构建 (LTO + strip) |
| `npm run cargo:check` | Rust 类型检查 (无需链接) |
| `npm run cargo:test` | 运行 56 个集成测试 |
| `npm run typecheck` | TypeScript 类型检查 |

## 🏗️ 架构设计

```
┌──────────────────────────────────────────────────────┐
│         系统 WebView (WebKitGTK/WebView2/WKWebView)    │
│  ┌────────────────────────────────────────────────┐  │
│  │   React 18 渲染端 (11 页面, 零平台差异)         │  │
│  │   getAPI() ──invoke/listen──▶ Tauri IPC        │  │
│  └────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│         Tauri 主进程 (纯 Rust 单二进制)               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ commands │ │ services │ │  tools   │ │  eaa    │ │
│  │  (90+)   │ │  (12个)  │ │  (30个)  │ │ _core   │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬────┘ │
│       └────────────┴────────────┴─────────────┘      │
│                    rusqlite / keyring / reqwest       │
└──────────────────────────────────────────────────────┘
```

详细架构图与数据流见 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 和 [`src-tauri/docs/`](./src-tauri/docs/)。

## 📚 文档

| 文档 | 内容 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 架构设计、模块图、数据流 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 贡献指南、开发环境、Commit 规范 |
| [CODE_STYLES.md](./CODE_STYLES.md) | Rust/TS 代码规范 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更日志 |
| [src-tauri/docs/](./src-tauri/docs/) | Tauri 重构详细文档 (9 篇) |
| [NOTICE](./NOTICE) | 协议致谢 + 免责声明 |

## 🗺️ 路线图

- [x] Tauri 2.0 后端 (90+ commands, 30 工具, 12 services)
- [x] DataCache 95x 性能提升
- [x] 三平台 CI 构建 (Win NSIS+MSI / Mac DMG / Linux deb+AppImage)
- [x] 路由懒加载 + CSS GPU 合成层
- [ ] `tauri-plugin-updater` 接 GitHub Releases 自动更新
- [ ] OAuth 登录 (Notion 等第三方) via `tauri-plugin-deep-link`
- [ ] 飞书 HMAC 回调校验 (callback-signature 子 crate 接线)
- [ ] 代码签名 (Windows Authenticode / macOS Notarization)
- [ ] 国际化 (i18n: 中/英双语)

## 🤝 参与贡献

我们欢迎任何形式的贡献! 详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

- 🐛 [报告 Bug](../../issues/new?template=bug_report.yml)
- ✨ [建议功能](../../issues/new?template=feature_request.yml)
- 📖 [改进文档](../../pulls)
- 🔧 [提交 PR](../../compare) (请先看 [PR 模板](./.github/PULL_REQUEST_TEMPLATE.md))

所有贡献者请遵守 [行为准则](./CODE_OF_CONDUCT.md)。

## 📦 依赖合规

```bash
# 审查所有 Rust 依赖的协议
cargo install cargo-license
cargo license

# 审查 npm 依赖
npx license-checker --summary
```

所有依赖协议与 MIT/Apache-2.0 双协议**兼容**,无 GPL/AGPL 污染。

## 🙏 致谢

- [Tauri](https://tauri.app) — 让 Rust 桌面应用成为现实
- [React Team](https://react.dev) — 优秀的 UI 框架
- [Tokio](https://tokio.rs) — 世界级异步运行时
- [Serde](https://serde.rs) — 序列化基石
- [ECharts](https://echarts.apache.org) — Apache 基金会的可视化项目
- 所有在 [NOTICE](./NOTICE) 中列出的开源库

## ⚖️ 协议

[MIT](./LICENSE-MIT) OR [Apache-2.0](./LICENSE-APACHE),任选其一。

<div align="center">

**⭐ 如果这个项目对你有帮助, 给个 Star 吧!**

Made with 🦀 Rust + ❤️ by [Education Advisor AI Contributors](../../graphs/contributors)

</div>
