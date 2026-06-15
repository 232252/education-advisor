//! EAA Core — 事件溯源操行分系统 (库入口)
//!
//! 本文件是 Tauri 重构新增 (见 `src-tauri/docs/02-RUST-CORE-REUSE.md`)。
//! 让原本只能作为 CLI 二进制运行的核心逻辑, 可被 Tauri crate 以 path 依赖直接调用:
//!
//! ```ignore
//! use eaa_core::{storage, privacy, validation, types, commands};
//! ```
//!
//! 各模块本身的 `pub fn/struct` 可见性早已就绪 (CLI 时代就是 pub),
//! 这里只是把它们重新以 `pub mod` 形式对外暴露。CLI 二进制 (`main.rs`)
//! 不再自己 `mod xxx;`, 改为 `use eaa_core::*`。
//!
//! 这样做的好处:
//!   1. Tauri 侧调用数据引擎无需 spawn 子进程 (省 ~50ms/次 + 进程管理开销)。
//!   2. 类型 (Entity/Event/...) 直接跨 crate 共享, 无需 serde_json 中转。
//!   3. CLI 与 Tauri 共享同一份业务逻辑实现, 单一事实源。

pub mod commands;
pub mod privacy;
pub mod storage;
pub mod types;
pub mod validation;

// 重新导出常用类型, 方便 `use eaa_core::{Entity, Event, AppError};`
pub use commands as cmd;
pub use privacy::{EntityType, MappingEntry, MappingTable, PrivacyEngine, PrivacyError};
pub use storage::{
    append_operation_log, atomic_write_json, compute_cumulative_history, compute_scores,
    generate_event_id, get_data_dir, get_operator, get_schema_dir, load_entities, load_events,
    load_name_index, load_reason_codes, resolve_entity_id, risk_level, save_entities,
    save_events, save_name_index, FileLock,
};
pub use types::{
    AppError, EntitiesFile, Entity, EntityStatus, Event, EventType, OutputMode, ReasonCodeDef,
    ReasonCodesFile, BASE_SCORE, MAX_DELTA, MIN_DELTA,
};
pub use validation::{can_revert, validate_delta};

/// 库版本号 (与 [package] version 同步)。
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
