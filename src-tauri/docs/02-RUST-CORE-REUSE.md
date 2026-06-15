# 02 — Rust 核心复用 (eaa-cli 加 `[lib]`)

> 本轮最大收益: 把原 `core/eaa-cli` 从"CLI 子进程"升级为"可消费的库",
> Tauri 侧直接 `use eaa_core::storage::*` 调用, 省掉每次 spawn 的 ~50ms 开销
> + JSON stdin/stdout 序列化。**业务逻辑零重写**, 只动构建配置。

## 1. 改动前: 只有 `[[bin]]`

```toml
# core/eaa-cli/Cargo.toml (改动前)
[package]
name = "eaa"
version = "3.1.2"
edition = "2021"

[features]
default = ["filesystem"]
# ...
```

`src/main.rs` 用 `mod commands; mod privacy; ...` 私有声明模块, clap 解析 CLI。
外部 (Electron 主进程) 只能通过 `spawn('./eaa', ['add', 'Alice', ...])` 调用。

**问题**: Rust 核心早已是库级 (所有 `pub fn cmd_*` / `pub struct Entity` 都 pub),
但 `[lib]` 目标缺失, 无法 `use` 进来。

## 2. 改动 (3 处, 共 ~30 行)

### 改动 A: `core/eaa-cli/Cargo.toml` 加 `[lib]`

```diff
 [package]
 name = "eaa"
 version = "3.1.2"
 edition = "2021"
 description = "..."
 license = "MIT"
 repository = "..."

+[lib]
+name = "eaa_core"
+path = "src/lib.rs"
+
 [features]
 default = ["filesystem"]
```

### 改动 B: 新建 `core/eaa-cli/src/lib.rs`

```rust
//! EAA Core — 事件溯源操行分系统 (库入口)
pub mod commands;
pub mod privacy;
pub mod storage;
pub mod types;
pub mod validation;

// 重新导出常用类型, 方便 `use eaa_core::{Entity, Event, AppError};`
pub use storage::{compute_scores, load_events, save_events, FileLock, ...};
pub use privacy::{PrivacyEngine, EntityType, ...};
pub use types::{Entity, Event, EventType, EntityStatus, AppError, ...};
pub use validation::{validate_delta, can_revert};
```

> 各模块的 `pub fn/struct` 在 CLI 时代就已是 pub, 这里只是把它们以 `pub mod` 形式对外暴露。

### 改动 C: `core/eaa-cli/src/main.rs` 改用库

```diff
-use clap::{Parser, Subcommand};
-use commands::*;
-use privacy::PrivacyEngine;
-use types::AppError;
-
-mod commands;
-mod privacy;
-mod storage;
-mod types;
-mod validation;
+use clap::{Parser, Subcommand};
+use eaa_core::commands::*;
+use eaa_core::privacy::PrivacyEngine;
+use eaa_core::types::AppError;
```

外加 2 处 bare-path 修正 (`types::OutputMode` → `eaa_core::types::OutputMode`,
`privacy::EntityType::from_str` → `eaa_core::privacy::EntityType::from_str`)。

## 3. 验证

```bash
$ cd core/eaa-cli
$ cargo check --lib        # 库通过
$ cargo check --bin eaa    # CLI 仍通过 (eaa_cli 命令行工具不受影响)
$ cargo check --all        # 工作区全绿
```

## 4. Tauri 侧如何消费

```toml
# src-tauri/Cargo.toml
[dependencies]
# package 名是 "eaa", lib 名是 "eaa_core"。
# 用 package= 把它以本地名 eaa_core 引入, 源码里 `use eaa_core::...`。
eaa_core = { package = "eaa", path = "../core/eaa-cli", default-features = false, features = ["filesystem"] }
```

源码调用示例 (来自 `src-tauri/src/commands/eaa.rs`):

```rust
// 直接调库, 无 spawn, 无 JSON 序列化
let entities = eaa_core::storage::load_entities()?;
let events = eaa_core::storage::load_events()?;
let scores = eaa_core::storage::compute_scores(&entities.entities, &events);
// 类型直接共享 (Entity/Event 跨 crate 无中转)
let entry: &eaa_core::Entity = entities.entities.get(name).unwrap();
```

## 5. 复用度评估

| 层 | 复用度 | 说明 |
|----|--------|------|
| 数据类型 (Entity/Event/Enums) | 100% | `types.rs` 全量复用 |
| 存储层 (load/save/lock/atomic) | 100% | `storage.rs` 全量复用, 仅加 `[lib]` |
| 隐私引擎 (anonymize/filter/...) | 100% | `privacy/mod.rs` 全量复用 |
| 原因码校验 | 100% | `validation.rs` 全量复用 |
| `cmd_*` 业务函数 | 部分 | `println!` 到 stdout 在 GUI 没用, Tauri 侧改用 `storage::*` 直接构造 JSON |
| 4 个子 crate | 100% | log-redact/data-validation/agent-isolation/callback-signature 已是 lib |
| clap CLI 层 | 不复用 | Tauri 侧不需要 CLI, 保留给 eaa_cli 二进制 |

**总体**: ~85-90% 的 Rust 核心代码零改动直接复用。本次新增的 Rust 工作量集中在
Tauri 侧的 services/commands/tools (~3.5k 行新代码), 而非重写数据引擎。

## 6. 收益对比 (Electron vs Tauri 数据写入)

| 指标 | Electron (spawn eaa) | Tauri (库调用) |
|------|---------------------|----------------|
| 单次 add_event 延迟 | ~50-80 ms (spawn + JSON) | <1 ms (函数调用) |
| 内存 (eaa 进程) | ~15 MB (常驻或反复启动) | 0 (合并进主进程) |
| 错误传递 | JSON 字符串解析 | `Result<T, AppError>` 类型安全 |
| 类型共享 | 无 (TS↔Rust 各自定义) | `eaa_core::Entity` 直接用 |
