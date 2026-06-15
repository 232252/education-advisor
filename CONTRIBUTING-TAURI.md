# 贡献指南 (Tauri 版)

> 本文件补充 [CONTRIBUTING.md](./CONTRIBUTING.md) 中 Tauri/Rust 特有的开发指引。
> 通用流程(行为准则、Issue/PR 规范、Conventional Commits)请先读主贡献指南。

感谢你对 Education Advisor Tauri 版的兴趣! 🦀 这个指南帮你从零搭好本地开发环境,
到提交第一个被 merge 的 PR。

## 📋 目录

- [快速开始](#-快速开始)
- [本地开发环境](#️-本地开发环境保姆级指南)
- [代码规范](#-代码规范)
- [提交规范](#-提交规范-conventional-commits)
- [测试要求](#-测试要求)
- [性能基准](#-性能基准)
- [常见问题排查](#-常见问题排查)

---

## 🚀 快速开始

```bash
# 1. Fork + Clone
git clone https://github.com/<你的用户名>/education-advisor.git
cd education-advisor

# 2. 安装前端依赖
npm install

# 3. (Linux) 装 Tauri 系统依赖
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev pkg-config

# 4. 启动开发模式 (vite 热重载 + cargo 增量编译)
npm run tauri:dev
```

首次 `tauri:dev` 会编译 ~400 个 Rust crate(经代理约 5-10 分钟),之后增量编译 <10 秒。

---

## 🛠️ 本地开发环境(保姆级指南)

### Rust 工具链

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version  # 需要 1.95+ (用到 edition 2024 + 最新 trait 解析)
```

### 代理配置(中国大陆开发者)

```bash
# ~/.cargo/config.toml — cargo 走代理 + git 走 cli
export https_proxy=http://127.0.0.1:8888
export http_proxy=http://127.0.0.1:8888

# ~/.cargo/config.toml 内容:
cat >> ~/.cargo/config.toml <<'EOF'
[net]
git-fetch-with-cli = true

[build]
rustflags = ["-C", "target-cpu=native"]
EOF
```

### 已知坑点

<details>
<summary><b>brotli 编译错误 (E0277)</b></summary>

**症状**: `cargo check` 报 `StandardAlloc: Allocator<u8> is not satisfied`

**原因**: brotli 8.x 与 alloc-no-stdlib v2/v3 版本冲突。

**解法**: 本仓库 `src-tauri/Cargo.toml` 已用 `[patch.crates-io]` + `vendor/` 修复,
无需额外操作。详见 [`src-tauri/docs/05-BUILD-RUN.md`](./src-tauri/docs/05-BUILD-RUN.md)。
</details>

<details>
<summary><b>linux: javascriptcoregtk-4.1 not found</b></summary>

**原因**: 缺 WebKitGTK 开发头文件。

**解法**: `sudo apt-get install -y libwebkit2gtk-4.1-dev`
</details>

<details>
<summary><b>macOS: clang: error: unknown argument</b></summary>

**原因**: Xcode Command Line Tools 未装。

**解法**: `xcode-select --install`
</details>

<details>
<summary><b>Windows: lib.exe not found</b></summary>

**原因**: 缺 MSVC Build Tools。

**解法**: 安装 Visual Studio Build Tools,勾选 "Desktop development with C++"。
</details>

<details>
<summary><b>tokio::sync::Mutex 跨 await 的 Send 错误</b></summary>

**症状**: `RwLockReadGuard cannot be sent between threads safely`

**原因**: parking_lot 的锁守卫是 `!Send`,在 async 函数里跨 `.await` 持有会破坏 Send 约束。

**解法**: 把 `state.xxx.read()` 用 `{}` 块严格限定作用域,在第一个 `.await` 前释放:
```rust
let value = {
    let guard = state.settings.read();
    guard.get_path("xxx").cloned()
}; // guard 在此释放
// .await 在这里安全
```
</details>

---

## 📐 代码规范

### Rust

```bash
# 强制: 提交前必须通过
cargo +1.95.0 fmt --all -- --check    # 格式检查
cargo +1.95.0 clippy -- -D warnings   # lint (warning 当 error)
cargo +1.95.0 test                    # 56 个测试全过
```

#### 错误处理规范

- **禁止** `.unwrap()` / `.expect()` 出现在非启动期、非测试代码中(除 Serialize→Value 这类不可能失败的场景)
- 用 `?` 传播 `Result`,统一走 `crate::error::AppError`
- 用 `thiserror` 派生错误枚举,**不要** `Box<dyn Error>`

```rust
// ✅ 正确
fn load(name: &str) -> Result<Entity> {
    let data = std::fs::read(name)?;  // io::Error 自动转 AppError::Io
    Ok(serde_json::from_slice(&data)?)
}

// ❌ 错误
fn load(name: &str) -> Entity {
    let data = std::fs::read(name).unwrap();  // 生产 panic!
    serde_json::from_slice(&data).expect("??")
}
```

#### Async 规范

- `#[tauri::command]` 必须 `async fn`(不阻塞 WebView 主线程)
- 文件 IO 在 async 路径上用 `std::fs`(小文件)或 `tokio::fs`(大文件)
- 锁守卫(parking_lot)不跨 `.await` 持有

### TypeScript / React

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # biome check
```

- 所有 IPC 调用走 `getAPI()`,不直接访问 `window.api` / `invoke`
- 新增 IPC 通道: (1) commands/*.rs 加 `#[command]` → (2) main.rs 注册 → (3) ipc-client.tauri.ts 加 invoke

---

## 📝 提交规范 (Conventional Commits)

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `perf` | 性能优化 |
| `refactor` | 重构 (无功能变化) |
| `test` | 测试 |
| `docs` | 文档 |
| `chore` | 构建/工具 |
| `ci` | CI 配置 |

示例:
```
perf(eaa_tools): 接入 DataCache 快照,工具循环提速 95x

- 新增 dispatch_cached 入口,只读工具从内存快照取数据
- 写操作后 cache.invalidate() 保证一致性
- 实测: 10工具循环 30ms→0.3ms
```

---

## 🧪 测试要求

```bash
# 全量测试 (56 个)
cargo +1.95.0 test

# 基准测试
cargo +1.95.0 bench --bench tool_dispatch
```

| 测试文件 | 覆盖 |
|----------|------|
| `tests/links.rs` | 完整链路(add_event→score→ranking, revert→分数恢复) |
| `tests/services.rs` | service 层(settings/profile/privacy_audit/llm/db) |
| `tests/integration.rs` | agent tool loop、capability、注入防护 |
| `tests/tools_integration.rs` | 30 个工具逐个验证 |

**新功能必须附带测试**,覆盖核心路径。PR 的 CI 会跑全部测试。

---

## ⏱️ 性能基准

性能敏感的改动,请在 PR 描述里附 `criterion` 对比数据:

```bash
# 对比前 (改之前 stash, 跑基准)
cargo +1.95.0 bench --bench tool_dispatch -- --save-baseline before

# 改动后
cargo +1.95.0 bench --bench tool_dispatch -- --baseline before
```

输出示例:
```
tool_loop_cached_10_calls
                        change: [-95.3% -95.5% -95.7%] (p = 0.00 < 0.05)
                        Performance has improved.
```

---

## 🔧 常见问题排查

### `cargo check` 报 `alloc-no-stdlib` 冲突

见上方"已知坑点 → brotli"。

### Tauri 窗口白屏

```bash
# 检查 vite 渲染端是否在 5173 跑
curl http://localhost:5173
# 检查 tauri.conf.json 的 devUrl
```

### `invoke` 找不到 command

通道名映射: `ns:action` → `ns_action`(冒号换下划线)。确认 main.rs 的 `generate_handler!` 里有该 command。

---

<div align="center">

问题? 在 [Discussions](../../discussions) 提问,或开 [Issue](../../issues/new)。

</div>

---

## 🔐 发布签名 (Maintainer 指南)

发布 Tauri 安装包需要配 GitHub Secrets。**普通贡献者无需关心**, 仅 release maintainer 配一次即可。

### 必配 (updater 签名, 不配则自动更新失效)

| Secret | 值 |
|--------|----|
| `TAURI_SIGNING_PRIVATE_KEY` | `npm run signer:gen` 输出 (含 BEGIN/END) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时输入的密码 |

### 可选 (macOS 完整签名 + notarization)

| Secret | 值 |
|--------|----|
| `APPLE_CERTIFICATE` | `base64 -i cert.p12` 输出 (单行) |
| `APPLE_CERTIFICATE_PASSWORD` | p12 密码 |
| `APPLE_SIGNING_IDENTITY` | `security find-identity -v -p codesigning` 输出的完整字符串 |
| `APPLE_TEAM_ID` | 10 位 team id (developer.apple.com → Membership) |
| `APPLE_ID` | Apple ID 邮箱 |
| `APPLE_PASSWORD` | app-specific password ([appleid.apple.com](https://appleid.apple.com) → App-Specific Passwords) |

任一缺失 → CI 跳过对应步骤, **不阻断 build**。但产物会被 Gatekeeper / SmartScreen 拦截。

详细步骤见 [src-tauri/docs/05-BUILD-RUN.md §6](./src-tauri/docs/05-BUILD-RUN.md#6-代码签名-tauri-打包)。
