---
title: 极速上手
description: 5 分钟从零到运行
---

# ⚡ 极速上手

## 前置依赖

### Rust（1.95+）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version  # 需要 1.95.0+
```

### Node.js 22

```bash
# 用 nvm
nvm install 22 && nvm use 22

# 或直接下载: https://nodejs.org/
```

### Tauri 系统依赖

:::note[Linux]
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev pkg-config build-essential
```
:::

:::note[macOS]
```bash
xcode-select --install
```
:::

:::note[Windows]
安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **Desktop development with C++**。
:::

## 克隆与运行

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor

# 安装前端依赖
npm install

# 开发模式（热重载）
npm run tauri:dev
```

首次编译会拉取 ~400 个 Rust crate（经代理约 5-10 分钟），之后增量编译 <10 秒。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run tauri:dev` | 开发模式（vite + cargo watch） |
| `npm run tauri:build` | 发布构建（LTO + strip） |
| `npm run cargo:check` | Rust 类型检查 |
| `npm run cargo:test` | 56 个集成测试 |
| `npm run typecheck` | TypeScript 检查 |

## 下一步

- 配置你的 LLM Provider API Key（[Models 页面](/docs/llm)）
- 初始化隐私引擎（[Privacy 页面](/docs/privacy)）
- 添加学生并试一次 [Agent 手动运行](/docs/agents)
