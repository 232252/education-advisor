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

// =============================================================
// 单元测试 — 纯逻辑, 不依赖 Tauri 运行时, headless CI 可跑。
// 覆盖点: thiserror Display 输出 / From 转换链 / Serialize 给前端。
// =============================================================
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_includes_chinese_prefix() {
        // 前端拿到的 message 来自 Display impl (thiserror #[error(...)])。
        // 锁定中文前缀格式, 改动文案会立刻被测试抓到。
        assert_eq!(
            AppError::NotFound("学生张三".into()).to_string(),
            "未找到: 学生张三"
        );
        assert_eq!(
            AppError::Validation("x<0".into()).to_string(),
            "数据校验失败: x<0"
        );
        assert_eq!(AppError::Cancelled.to_string(), "用户取消操作");
    }

    #[test]
    fn from_io_error_maps_to_io_variant() {
        // ? 传播 std::io::Error 时自动转 AppError::Io。
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let app: AppError = io_err.into();
        assert!(matches!(app, AppError::Io(_)));
        assert!(app.to_string().contains("IO 错误"));
    }

    #[test]
    fn from_serde_json_error_maps_to_json_variant() {
        let json_err = serde_json::from_str::<serde_json::Value>("{bad}").unwrap_err();
        let app: AppError = json_err.into();
        assert!(matches!(app, AppError::Json(_)));
    }

    #[test]
    fn from_rusqlite_error_maps_to_db_variant() {
        // rusqlite::Error 种类繁多, 这里用一个真实错误验证转换不丢信息。
        let db_err = rusqlite::Error::InvalidColumnIndex(99);
        let app: AppError = db_err.into();
        assert!(matches!(app, AppError::Db(_)));
    }

    #[test]
    fn serialize_produces_message_field() {
        // Tauri command Err → 前端 invoke().catch(e => e.message)。
        // 锁定序列化结构为 {"message": String}, 改成其他字段会破坏前端契约。
        let err = AppError::PermissionDenied("匿名调用".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["message"], "权限不足: 匿名调用");
        // 不应泄漏 Rust Debug 结构 (如 variant 名)。
        assert!(json.get("PermissionDenied").is_none());
    }

    #[test]
    fn other_helper_wraps_display() {
        let app = other(42); // i32: Display
        assert_eq!(app.to_string(), "42");
        assert!(matches!(app, AppError::Other(_)));
    }

    #[test]
    fn eaa_core_error_maps_back() {
        // eaa_core::types::AppError → 本 crate AppError, 保持语义类别。
        use eaa_core::types::AppError as E;
        let io_e = E::Io(std::io::Error::other("x"));
        assert!(matches!(AppError::from(io_e), AppError::Io(_)));
        let nf = E::StudentNotFound("S001".into());
        assert!(matches!(AppError::from(nf), AppError::NotFound(_)));
        let ve = E::Validation("长度".into());
        assert!(matches!(AppError::from(ve), AppError::Validation(_)));
    }
}
