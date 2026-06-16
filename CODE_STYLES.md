# Code style

> **本项目的 Rust 编码规范。** 这是评审 PR、写新模块、重构旧代码时的统一标尺。
> 详细架构见 [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)（本文件是它的兄弟篇，专管"怎么写"）。

---

## 0. 一句话原则

**像 Rust 程序员一样思考，而不是"用 Rust 语法写 TypeScript/Java"。**

本项目的 src-tauri 后端是从 Electron + TypeScript 重写而来的，规范的核心目的就是
**消除"翻译腔"**：该借引用时不要 clone，该用 `?` 时不要 unwrap，该用 channel 时不要共享锁。

---

## 1. 错误处理（最高优先级）

### 1.1 统一错误类型 `AppError`

所有 `#[tauri::command]` 和 service 方法的返回值统一用 `Result<T, AppError>`：

```rust
// ✅ 正确：返回 Result，让 ? 传播
pub fn update(&mut self, dot_path: &str, value: Value) -> Result<()> {
    let parts: Vec<&str> = dot_path.split('.').collect();
    if parts.is_empty() {
        return Err(AppError::Config("空设置路径".into()));
    }
    set_by_path(&mut self.settings, &parts, value)?;
    self.save_now()?;
    Ok(())
}
```

`AppError` 已实现 `From<io::Error>` / `From<serde_json::Error>` / `From<rusqlite::Error>` 等，
**不要手写 `map_err(|e| AppError::Other(e.to_string()))`**，直接 `?` 即可。

### 1.2 `unwrap()` / `expect()` 红线

| 场景 | 允许？ | 说明 |
|------|--------|------|
| `#[cfg(test)]` 测试代码 | ✅ 允许 | 测试失败就该 panic |
| `#[cfg(test)]` 测试夹具构造 | ✅ 允许 | `tempdir().unwrap()` 合理 |
| 构造常量（`Lazy::new` 里的正则） | ⚠️ 仅限编译期可证明不变量 | 见 `log_redact::SENSITIVE_PATTERNS` |
| 命令/服务运行时路径 | ❌ 禁止 | 必须用 `?` 或返回 `Result` |
| `Option::unwrap` 处理外部输入 | ❌ 禁止 | 用 `ok_or_else(|| AppError::...)?` |

**为什么**：Tauri command 的 `unwrap` 会 panic 到主线程，导致整个窗口无响应。
前端拿到的是 IPC 超时而不是错误信息。运行时任何可能失败的路径都必须走 `Result`。

### 1.3 错误信息要可读

前端 `invoke().catch(e => e.message)` 直接展示给用户，所以 `AppError` 的 `#[error("...")]`
文案用中文 + 业务上下文：

```rust
#[error("数据库错误: {0}")]
Db(String),

#[error("隐私引擎错误: {0}")]
Privacy(String),
```

**不要**：`#[error("{0:?}")]`（泄漏 Rust Debug 结构）、空字符串、英文技术黑话。

---

## 2. 所有权与借用

### 2.1 默认用引用，只在跨边界时 clone

```rust
// ❌ 翻译腔：把字符串到处 clone
fn greet(name: String) -> String { format!("hi {name}") }

// ✅ Rust 风：借引用，调用方决定是否 clone
fn greet(name: &str) -> String { format!("hi {name}") }
```

**判定标准**：函数不持有参数（用完就丢）→ 用 `&str` / `&[T]` / `&T`；
函数要存起来（存到 struct 字段、缓存）→ 接收 owned `String` / `Vec<T>`。

### 2.2 `Arc<RwLock<T>>` vs `Arc<Mutex<T>>`

本项目的 `AppState` 用 `parking_lot`：

- **读多写少**（settings、agents、skills、privacy）→ `Arc<RwLock<T>>`
- **写多读少 / 需要持有锁做连续操作**（db、scheduler、active_streams）→ `tokio::sync::Mutex<T>`（异步场景必须用 tokio 的，不能用 std 的，否则 `.await` 时阻塞 executor）

```rust
// ✅ AppState 里的正确选择
pub settings: Arc<RwLock<SettingsService>>,        // 读设置远多于写
pub db: Arc<Mutex<DbService>>,                     // 每次事务要独占
```

### 2.3 不要 `Box` 大对象做返回

```rust
// ❌ 多一次堆分配
fn load() -> Box<Vec<Event>> { ... }

// ✅ 直接返回 Vec
fn load() -> Vec<Event> { ... }
```

---

## 3. IPC 契约（command 层）

### 3.1 command 是薄包装

`commands/*.rs` 里的函数应该**只有 3 件事**：解析参数 → 调 service → 返回结果。
**不要在 command 里写业务逻辑**，那样无法单元测试。

```rust
// ✅ 薄 command：逻辑全在 service，可测
#[tauri::command]
pub async fn settings_update(
    state: State<'_, AppState>,
    path: String,
    value: serde_json::Value,
) -> Result<()> {
    state.settings.write().update(&path, value)
}
```

### 3.2 channel 命名规范

前端→后端：`ns:action`（如 `ai:chat`）；后端→前端事件常量集中在 `lib.rs::events`：

```rust
pub mod events {
    pub const AI_CHAT_STREAM: &str = "ai:chat-stream";  // ← 改这里
}
```

**改 channel 名必须同步改 `src/shared/ipc-channels.ts`**，否则静默断流。
`lib.rs` 的 `events_constants_use_colon_namespace` 测试会锁住命名空间前缀。

### 3.3 流式响应用 `CancellationToken`

LLM 流、agent 执行必须支持中途取消。用 `tokio_util::sync::CancellationToken`，
**不要**用 `AtomicBool` 轮询（延迟高、浪费 CPU）。

---

## 4. 异步与并发

### 4.1 异步代码里禁止阻塞 IO

```rust
// ❌ 阻塞 executor（std::fs 在 async 里是同步 syscall）
async fn load() -> Result<Data> {
    let raw = std::fs::read_to_string("big.json")?;  // 卡住整个 worker 线程
}

// ✅ 用 spawn_blocking 隔离（本项目数据文件小，用 std::fs 即可，但要标注）
async fn load() -> Result<Data> {
    tokio::task::spawn_blocking(|| {
        let raw = std::fs::read_to_string("big.json")?;
        Ok(serde_json::from_str(&raw)?)
    }).await?
}
```

**本项目约定**：`eaa_core` 的文件 IO（JSON 几 KB~几百 KB）用同步 `std::fs` 可接受
（见 `tools/data_cache.rs` 注释），但网络请求必须 `reqwest` async。

### 4.2 生产者-消费者优于共享状态

agent 工具循环、LLM 流用 channel（`tokio::sync::mpsc`）传递更新，
**不要**让后台任务直接持锁改 UI 状态。

---

## 5. 测试规范

### 5.1 内嵌 `#[cfg(test)] mod tests`

纯逻辑测试**内嵌在源文件末尾**（见 `error.rs` / `utility.rs` / `settings_service.rs`），
不用单独 `tests/` 目录——这样测试和被测代码一起改，不会失联。

### 5.2 IO 测试用 `tempfile` 隔离

涉及文件/数据库的测试必须用临时目录，**不能碰真实的 userData**：

```rust
#[test]
fn save_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let mut svc = SettingsService::load(dir.path()).unwrap();
    svc.update("x", json!(1)).unwrap();
    assert!(dir.path().join("settings.json").exists());
}
```

### 5.3 涉及全局 env 的测试必须串行

`EAA_DATA_DIR` 是进程级环境变量，多线程并行测试会互相覆盖。
用 `parking_lot::Mutex` 做全局守卫（见 `data_cache.rs` 的 `ENV_GUARD`）。

### 5.4 覆盖目标

- 纯函数（parser、计算、校验）：**100%** 分支覆盖
- service（有 IO）：核心路径必须有 happy path + 至少一个 error path
- command 薄包装：不强制单测（逻辑在 service）

---

## 6. Unsafe 红线

**本项目 src-tauri 后端：零 `unsafe`。**

- 需要性能的边界（JSON 解析、正则、加密）全部由依赖库（`serde_json`、`regex`、`sha2`）处理，
  它们内部的 unsafe 已审计。
- 如果你觉得必须写 unsafe，先问：能不能用 `bytemuck` / `std::simd` / 换数据结构解决？
  实在不行，提 RFC，团队评审。

---

## 7. 格式化与 lint

```bash
# 提交前必跑（CI 会卡）
cargo fmt --manifest-path src-tauri/Cargo.toml --all
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

- **`cargo fmt`**：非协商项。PR 没 fmt 直接打回。
- **`clippy`**：本项目允许的少量 warning（见下方"已知豁免"），其余必须清零。
- 不要为了消 clippy warning 引入更差的代码（比如无意义的 `Default` impl），写注释 `#[allow(...)]` + 理由。

### 已知豁免（允许的 clippy 警告）

| 规则 | 位置 | 理由 |
|------|------|------|
| `too many arguments` | `eaa_tools.rs` dispatch | 工具分发入口，参数是契约 |
| `module_inception` | `commands::mod` | 与 TS 端命名对齐 |

---

## 8. 注释规范

### 8.1 模块头 `//!`

每个 `.rs` 顶部用 `//!` 说明：这个模块是什么、对应 TS 哪个文件、为什么这样设计。

```rust
//! 设置服务 — Rust 重写自 `src/main/services/settings-service.ts`。
//!
//! 设计与原版一致:
//!   - 持久化到 `{userData}/settings.json` (原子写: tmp + rename)。
```

### 8.2 "为什么"而非"是什么"

```rust
// ❌ 描述代码（读者会看代码）
let mut guard = self.inner.write().map_err(...)?;

// ✅ 解释决策（读者看不出为什么 double-check）
// 慢路径: 写锁, 重新 load
let mut guard = self.inner.write().map_err(|e| e.to_string())?;
// double-check (可能其他线程已 load)
if let Some(snap) = guard.as_ref() { ... }
```

---

## 9. 提交检查清单

PR 合并前自查：

- [ ] `cargo fmt` 无 diff
- [ ] `cargo clippy` 无新增 warning
- [ ] `cargo test --lib` 全绿
- [ ] 新增 command 已在 `lib.rs::events` 或 commands 模块注册
- [ ] 改了 IPC channel 名 → 同步改了 `src/shared/ipc-channels.ts`
- [ ] 新增依赖在 `Cargo.toml` 注释说明用途（见现有依赖的注释风格）
- [ ] `unsafe` 块：没有（本项目红线）

---

*这份规范是活的。如果你发现某条规则阻碍了写出更好的代码，提 issue 讨论，不要默默违反。*
