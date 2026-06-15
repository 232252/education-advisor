# 05 — 构建与运行

> 含 8888 代理配置、已知依赖问题 (brotli/alloc-stdlib) 的根因与解法、
> 完整的 dev/build/package 流程。

## 1. 前置依赖

### 1.1 Rust 工具链

```bash
# 经 8888 代理安装 (本环境实测)
export https_proxy=http://127.0.0.1:8888 http_proxy=http://127.0.0.1:8888
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 1.95+ 均可 (brotli/alloc-stdlib 冲突已通过 vendor patch 彻底解决, 见 §3)
rustup toolchain install 1.95.0 --profile minimal
rustup default 1.95.0
```

### 1.2 cargo 走代理 + git 走 cli

`~/.cargo/config.toml`:

```toml
[net]
git-fetch-with-cli = true   # 让 git 用 http.proxy 环境变量
```

shell 环境变量 (持久化到 ~/.bashrc 或 ~/.zshrc):

```bash
export https_proxy=http://127.0.0.1:8888
export http_proxy=http://127.0.0.1:8888
export HTTPS_PROXY=http://127.0.0.1:8888
export HTTP_PROXY=http://127.0.0.1:8888
```

### 1.3 Node 依赖

```bash
cd education-advisor
npm ci
```

### 1.4 系统库 (Tauri WebView, 仅打包/链接时需要)

Debian/Ubuntu:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev pkg-config build-essential
```

> 本环境无 sudo, 因此 `cargo check --lib` 在解析完所有依赖、到达**最终 native link**
> 阶段时报 `javascriptcoregtk-4.1 not found`。这是预期的 — 业务逻辑 (lib 部分)
> 已全部编译通过, 只是 GUI 二进制链接需要 OS WebView 开发头文件。
> 在有 sudo 的开发机/CI 上装上列出的库即可完成完整构建。

macOS: `xcode-select --install` (WebKit 系统自带)
Windows: WebView2 runtime (Win11 自带)

## 2. 开发流程

```bash
# Electron 版 (原, 双轨保留)
npm run dev                # vite 主进程 + 渲染端, 然后 npm run dev:electron

# Tauri 版 (新)
npm run tauri:dev          # 等价: tauri dev
                           # 自动跑 vite renderer (beforeDevCommand) + 编译 Rust + 开窗
```

`tauri.conf.json` 的关键字段:

```jsonc
{
  "build": {
    "beforeDevCommand": "npm run dev:renderer",   // 复用原 vite 渲染端
    "beforeBuildCommand": "npm run build:renderer",
    "devUrl": "http://localhost:5173",            // vite 端口
    "frontendDist": "../dist/renderer"
  }
}
```

## 3. 已知依赖问题: brotli 8.x + alloc-no-stdlib v2/v3 分裂

### 3.1 现象

`cargo check --lib` 报 36 个 `E0277: the trait bound StandardAlloc: Allocator<u8>
is not satisfied`, 根因:

```
tauri-codegen 2.6.2 ──brotli = "8"──▶ brotli 8.0.3
                                        ├─ alloc-no-stdlib = "2.0"  ← v2 (硬绑)
                                        └─ alloc-stdlib ~0.2 ─▶ alloc-stdlib 0.2.3
                                                                 └─ alloc-no-stdlib >=2,<4 ← 解析到 v3
                          + brotli-decompressor ~5.0 ─▶ 5.0.2
                                                      └─ alloc-no-stdlib >=2,<4 ← v3
```

全图同时存在 alloc-no-stdlib **v2.0.4** (被 brotli 8 硬要求) 和 **v3.0.0**
(被 alloc-stdlib / brotli-decompressor 5.0.1+ 选中), `Allocator` trait 歧义。

### 3.2 解法 (本轮采用: 本地 vendor + [patch.crates-io])

`src-tauri/vendor/` 下放 3 个本地副本, 通过 `[patch.crates-io]` 重定向:

```toml
# src-tauri/Cargo.toml
[patch.crates-io]
brotli = { path = "vendor/brotli" }                       # 8.0.3 源码
brotli-decompressor = { path = "vendor/brotli-decompressor" }  # 5.0.0 (硬绑 v2)
alloc-stdlib = { path = "vendor/alloc-stdlib" }           # 真 0.2.3 源码, bound 改 =2.0.4
```

关键改动:
- `vendor/alloc-stdlib/Cargo.toml`: `alloc-no-stdlib` bound 从 `">=2.0.4, <4.0.0"`
  改为 `"=2.0.4"` → 阻断 v3。
- `vendor/brotli-decompressor/` 用 **5.0.0** (不是 5.0.1/5.0.2), 因为 5.0.0 的
  Cargo.toml 是 `alloc-no-stdlib = "2.0"` (硬绑 v2), 5.0.1 起放宽为 `>=2,<4`。
- `vendor/brotli/` 用 8.0.3 (满足 tauri-codegen 的 `"8"` 要求), 它的 alloc-stdlib
  现在指向被 patch 过的本地 0.2.3 → 全图统一 v2。

验证: `cargo check --lib` 通过 (rustc 1.95 与 1.96 均已实测, vendor patch 后无 v3 残留)。

### 3.3 备选解法 (未采用, 留作参考)

- **降 rustc**: 早期 rustc (1.82 前) 对此 conflict 宽容, 但 1.82 不支持
  `edition2024` (dlopen2_derive 需要), 死路。
- **patch brotli-decompressor 到 git tag 5.0.0**: 需 `git-fetch-with-cli=true`
  + 代理, 但 `[patch]` 对 workspace 多 package 报 "more than one candidate",
  需额外加 `version = "=5.0.0"`。可行但不如本地 vendor 可控。
- **fork brotli 移除 alloc-stdlib 依赖**: 工作量大, 放弃。

### 3.4 升级路径

当上游 brotli 修了 (或 tauri-codegen 放宽 brotli bound), 删除:
- `vendor/` 目录
- `Cargo.toml` 的 `[patch.crates-io]` 段
即可回到纯 crates.io 依赖。

## 4. 构建 / 打包

```bash
# 调试构建 (带 devtools, 不压缩)
npm run tauri:build:debug

# 发布构建 (LTO + strip, 体积最小)
npm run tauri:build
# 产物: src-tauri/target/release/bundle/{deb,appimage,msi,nsis}/
```

`Cargo.toml` 的 release profile:

```toml
[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

## 5. 单元测试

```bash
npm run cargo:test
# 或单独:
cargo +1.95.0 test --manifest-path src-tauri/Cargo.toml
```

`src-tauri/tests/` 放集成测试; `lib.rs` 设计为可独立编译 (无 Tauri 运行时依赖),
便于在 CI 无 GUI 环境跑测。

## 6. 故障排查

| 症状 | 原因 | 解法 |
|------|------|------|
| `cargo check` 报 E0277 Allocator | brotli/alloc-stdlib v2/v3 共存 | 见 §3, 启用 vendor + patch |
| `javascriptcoregtk-4.1 not found` | 缺系统 WebView 开发头文件 | `apt-get install libwebkit2gtk-4.1-dev` |
| `reqwest` 连不上 LLM | 代理未配置 | 设 HTTPS_PROXY 环境变量 (reqwest 默认读) |
| 前端 `window.api is not available` | 在 Electron 模式跑了但 main 未注入 | 检查 `npm run dev` 是否完整 |
| invoke 找不到 command | 命名不符 | 确认 `ns:action` → `ns_action` (冒号→下划线) |
| listen 收不到事件 | capability 未声明 | `src-tauri/capabilities/default.json` 加 `core:event:allow-listen` |


## 6. 代码签名 (Tauri 打包)

### 6.1 Tauri updater 签名 (必做, 否则自动更新失效)

```bash
# 1. 生成 ed25519 密钥对 (私钥存 ~/.tauri/ea.key, 公钥打印到 stdout)
npm run signer:gen

# 2. 把公钥 (一行 base64) 替换到 src-tauri/tauri.conf.json 的 plugins.updater.pubkey

# 3. 把私钥内容配到 GitHub Secrets:
#    Settings → Secrets → New repository secret
#    Name:  TAURI_SIGNING_PRIVATE_KEY
#    Value: 私钥文件内容 (含 -----BEGIN PRIVATE KEY----- / END-----)
#    Name:  TAURI_SIGNING_PRIVATE_KEY_PASSWORD
#    Value: 生成时输入的密码

# 4. 推 v*.*.* tag → CI 自动签 latest.json + bundle 产物
git tag v0.1.0-rc.2
git push origin v0.1.0-rc.2
```

### 6.2 macOS Apple Developer ID 签名 (可选但推荐)

```bash
# 1. 准备 .p12 证书 (从 Apple Developer → Certificates → Developer ID Application 导出)
# 2. 转 base64 (去掉换行)
base64 -i cert.p12 | tr -d '\n' > cert.p12.b64
# 3. 配 GitHub Secrets (共 6 项):
APPLE_CERTIFICATE               # cert.p12.b64 内容
APPLE_CERTIFICATE_PASSWORD      # p12 密码
APPLE_SIGNING_IDENTITY          # "Developer ID Application: Name (TEAMID)"
APPLE_TEAM_ID                   # 10 位 team id
APPLE_ID                        # Apple ID 邮箱 (notarization 用)
APPLE_PASSWORD                  # app-specific password (appleid.apple.com → App Passwords)
```

CI 自动流程 (`release-tauri.yml`):
1. `Import Apple certificate (macOS)` step → 临时 keychain → `codesign`
2. tauri-action 自动 notarize (`xcrun notarytool submit --wait`)

### 6.3 Windows Authenticode (可选, 防 SmartScreen 拦截)

需 EV 证书或 Azure Trusted Signing 服务。配置较复杂, 本项目默认不配。
未签名 .exe 会被 SmartScreen 弹警告, 但不影响功能。

如需配, 参考:
- EV 证书: `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a app.exe`
- Azure Trusted Signing: GitHub Action `azure/trusted-signing-action@v1`

### 6.4 GitHub Secrets 配置清单 (8 项)

| Secret | 用途 | 获取方式 |
|--------|------|---------|
| `TAURI_SIGNING_PRIVATE_KEY` | updater latest.json 签名 | `npm run signer:gen` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 同上私钥密码 | 生成时输入 |
| `APPLE_CERTIFICATE` | macOS .app/.dmg 签名 | base64(p12) |
| `APPLE_CERTIFICATE_PASSWORD` | p12 密码 | 导出 p12 时设 |
| `APPLE_SIGNING_IDENTITY` | codesign identity | `security find-identity` |
| `APPLE_TEAM_ID` | notarize | developer.apple.com |
| `APPLE_ID` | notarize 账号 | Apple ID |
| `APPLE_PASSWORD` | notarize app-specific pw | appleid.apple.com → App Passwords |

任一 secret 缺失 → CI 仅跳过对应步骤, 不阻断 build。
