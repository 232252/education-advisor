//! 强类型事件溯源核心类型定义
//! 
//! 设计原则："让非法状态不可表达"
//! - 用 Rust Enum 穷尽所有事件类型
//! - 用 Newtype 包装防止张冠李戴
//! - 用 #[serde(deny_unknown_fields)] 杜绝 AI 幻觉字段

pub mod event;
pub mod entity;
pub mod newtypes;
pub mod enums;
pub mod error;
pub mod envelope;

pub use event::*;
pub use entity::*;
pub use newtypes::*;
pub use enums::*;
pub use error::*;
pub use envelope::*;
