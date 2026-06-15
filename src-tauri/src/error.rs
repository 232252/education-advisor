//! 统一错误类型 — 所有 command 返回 `Result<T, AppError>`。
//!
//! Tauri 把 Err 序列化为前端 `invoke().catch(e => e)` 收到的对象。
//! `serde::Serialize` impl 让前端拿到的就是 `{ message: "..." }` 可读字符串,
//! 而不是 Rust 的 Debug 转储。

use std::fmt;

/// 全局错误类型。各 service 的局部错误通过 `?` + `From` 转换进来。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("序列化错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("数据库错误: {0}")]
    Db(String),

    #[error("隐私引擎错误: {0}")]
    Privacy(String),

    #[error("数据校验失败: {0}")]
    Validation(String),

    #[error("LLM 调用失败: {0}")]
    Llm(String),

    #[error("Agent 错误: {0}")]
    Agent(String),

    #[error("网络错误: {0}")]
    Network(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("飞书集成错误: {0}")]
    Feishu(String),

    #[error("调度器错误: {0}")]
    Scheduler(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("未初始化: {0}")]
    NotInitialized(String),

    #[error("权限不足: {0}")]
    PermissionDenied(String),

    #[error("用户取消操作")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Other(format!("Tauri IPC: {e}"))
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}

/// 从 eaa_core 的 AppError 转换 (storage/privacy/validation 的返回值)。
impl From<eaa_core::types::AppError> for AppError {
    fn from(e: eaa_core::types::AppError) -> Self {
        use eaa_core::types::AppError as E;
        match e {
            E::Io(e) => AppError::Io(e),
            E::Json(e) => AppError::Json(e),
            E::StudentNotFound(s) => AppError::NotFound(s),
            E::EventNotFound(s) => AppError::NotFound(s),
            E::Validation(s) => AppError::Validation(s),
        }
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl From<Box<dyn std::error::Error + Send + Sync>> for AppError {
    fn from(e: Box<dyn std::error::Error + Send + Sync>) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<tauri_plugin_updater::Error> for AppError {
    fn from(e: tauri_plugin_updater::Error) -> Self {
        AppError::Other(format!("updater: {e}"))
    }
}

/// Tauri 要求 command 的 Err 类型实现 Serialize。
/// 这里把错误转成 `{ message: String }`, 前端 `invoke().catch(e => e.message)` 即可读。
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut st = serializer.serialize_struct("AppError", 1)?;
        // Display impl 来自 thiserror 的 #[error(...)]
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

/// 运行期 Result 别名, 简化签名。
pub type Result<T> = std::result::Result<T, AppError>;

/// 把任意 Display-able 转成 Other 错误, 便于 `?` 传播。
pub fn other<E: fmt::Display>(e: E) -> AppError {
    AppError::Other(e.to_string())
}
