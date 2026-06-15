//! 文件工具 — agent 可用的 file_read / file_write 工具。
//! 重写自 `src/main/services/file-tools.ts` (426 行)。
//! 安全: 路径白名单 = userData/data 与 resources, 阻断路径穿越 (../)。

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::error::{AppError, Result};

pub fn read_file(path: &str, base: &Path) -> Result<Value> {
    let p = sanitize_path(path, base)?;
    let content = std::fs::read_to_string(&p)?;
    Ok(json!({ "path": path, "content": content, "bytes": content.len() }))
}

pub fn write_file(path: &str, content: &str, base: &Path) -> Result<Value> {
    let p = sanitize_path(path, base)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&p, content)?;
    Ok(json!({ "path": path, "bytes": content.len() }))
}

pub fn list_dir(path: &str, base: &Path) -> Result<Value> {
    let p = sanitize_path(path, base)?;
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&p)? {
        let e = e?;
        let name = e.file_name().to_string_lossy().to_string();
        let is_dir = e.file_type()?.is_dir();
        entries.push(json!({ "name": name, "isDir": is_dir }));
    }
    Ok(json!({ "path": path, "entries": entries }))
}

// ===== Value 入参版 (供 eaa_tools::dispatch 调用, base 固定为 eaa_data 目录) =====

pub fn read_file_value(args: &Value) -> Value {
    let base = eaa_core::storage::get_data_dir();
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    match read_file(path, &base) {
        Ok(v) => v,
        Err(e) => json!({ "error": e.to_string() }),
    }
}

pub fn write_file_value(args: &Value) -> Value {
    let base = eaa_core::storage::get_data_dir();
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
    match write_file(path, content, &base) {
        Ok(v) => v,
        Err(e) => json!({ "error": e.to_string() }),
    }
}

pub fn list_dir_value(args: &Value) -> Value {
    let base = eaa_core::storage::get_data_dir();
    let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
    match list_dir(path, &base) {
        Ok(v) => v,
        Err(e) => json!({ "error": e.to_string() }),
    }
}

/// 解析相对路径并强制必须落在 base 下 (防路径穿越)。
fn sanitize_path(rel: &str, base: &Path) -> Result<PathBuf> {
    let cleaned = rel.trim_start_matches(['/', '\\']);
    if cleaned.contains("..") {
        return Err(AppError::Validation(format!("禁止路径穿越: {rel}")));
    }
    let p = base.join(cleaned);
    let canonical_base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let canonical = p
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .unwrap_or(canonical_base.clone());
    if !canonical.starts_with(&canonical_base) {
        return Err(AppError::PermissionDenied(format!("路径越界: {rel}")));
    }
    Ok(p)
}
