---
title: 安装指南
description: 三平台详细前置依赖与坑点
---

# 📦 安装指南

## Linux（Debian/Ubuntu）

```bash
# 1. Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 2. Tauri 系统依赖
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev pkg-config build-essential

# 3. Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 中国大陆代理

```bash
export https_proxy=http://127.0.0.1:8888
export http_proxy=http://127.0.0.1:8888

# ~/.cargo/config.toml
[net]
git-fetch-with-cli = true
```

## macOS（Intel + Apple Silicon）

```bash
xcode-select --install
brew install rust nodejs
```

Apple Silicon（M1/M2/M3）无需额外配置，`rustup` 自动选 `aarch64-apple-darwin`。

## Windows

1. 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 **Desktop development with C++**
2. `winget install Rustlang.Rustup`
3. `winget install OpenJS.NodeJS.LTS`
4. WebView2 Runtime：Windows 11 自带；Windows 10 需[手动安装](https://developer.microsoft.com/microsoft-edge/webview2/)

## 已知问题

### brotli 编译错误（E0277）

`cargo check` 报 `StandardAlloc: Allocator<u8> is not satisfied`。

**原因**：brotli 8.x 与 alloc-no-stdlib v2/v3 版本冲突。

**解法**：本仓库已用 `[patch.crates-io]` + `vendor/` 修复，无需额外操作。详见 `src-tauri/docs/05-BUILD-RUN.md`。
