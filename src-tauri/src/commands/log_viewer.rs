//! Log commands — 日志查看 IPC (9 个通道, `log:*`)。
//! 日志文件存在 `{userData}/logs/`, 前端 LogViewer 页面消费。

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::error::Result;
use crate::state::AppState;

fn log_dir(state: &State<'_, AppState>) -> PathBuf {
    state.paths.logs.clone()
}

#[tauri::command]
pub async fn log_list(state: State<'_, AppState>) -> Result<Vec<Value>> {
    let dir = log_dir(&state);
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for e in std::fs::read_dir(&dir)? {
        let e = e?;
        let meta = e.metadata()?;
        out.push(json!({
            "stream": e.path().file_stem().and_then(|s| s.to_str()).unwrap_or(""),
            "date": "",
            "name": e.file_name().to_string_lossy(),
            "sizeBytes": meta.len(),
        }));
    }
    Ok(out)
}

#[tauri::command]
pub async fn log_read(
    state: State<'_, AppState>,
    name: String,
    lines: Option<usize>,
) -> Result<String> {
    let path = log_dir(&state).join(&name);
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    if let Some(n) = lines {
        let collected: Vec<&str> = content.lines().collect();
        let start = collected.len().saturating_sub(n);
        Ok(collected[start..].join("\n"))
    } else {
        Ok(content)
    }
}

#[tauri::command]
pub async fn log_clear(state: State<'_, AppState>) -> Result<u64> {
    let dir = log_dir(&state);
    let mut n = 0u64;
    if dir.exists() {
        for e in std::fs::read_dir(&dir)? {
            let e = e?;
            if std::fs::remove_file(e.path()).is_ok() {
                n += 1;
            }
        }
    }
    Ok(n)
}

#[tauri::command]
pub async fn log_filter(
    state: State<'_, AppState>,
    name: String,
    levels: Vec<String>,
    lines: Option<usize>,
) -> Result<String> {
    let path = log_dir(&state).join(&name);
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let filtered: Vec<&str> = content
        .lines()
        .filter(|l| levels.iter().any(|lv| l.contains(lv)))
        .collect();
    let res = if let Some(n) = lines {
        let start = filtered.len().saturating_sub(n);
        filtered[start..].join("\n")
    } else {
        filtered.join("\n")
    };
    Ok(res)
}

#[tauri::command]
pub async fn log_search(
    state: State<'_, AppState>,
    name: String,
    query: String,
    lines: Option<usize>,
) -> Result<String> {
    let path = log_dir(&state).join(&name);
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let hits: Vec<&str> = content.lines().filter(|l| l.contains(&query)).collect();
    let res = if let Some(n) = lines {
        let start = hits.len().saturating_sub(n);
        hits[start..].join("\n")
    } else {
        hits.join("\n")
    };
    Ok(res)
}

#[tauri::command]
pub async fn log_export(
    state: State<'_, AppState>,
    name: String,
    target_path: String,
) -> Result<u64> {
    let src = log_dir(&state).join(&name);
    std::fs::copy(&src, &target_path).map_err(crate::error::other)
}

#[tauri::command]
pub async fn log_export_dialog(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<Value> {
    use tauri_plugin_dialog::DialogExt;
    let src = log_dir(&state).join(&name);
    let path = app
        .dialog()
        .file()
        .add_filter("Log", &["log", "txt"])
        .blocking_save_file();
    match path {
        Some(p) => {
            let p = p.to_string();
            let n = std::fs::copy(&src, &p).map_err(crate::error::other)?;
            Ok(json!({ "canceled": false, "bytes": n, "path": p }))
        }
        None => Ok(json!({ "canceled": true, "bytes": 0 })),
    }
}

#[tauri::command]
pub async fn log_write_renderer(
    _state: State<'_, AppState>,
    level: String,
    msg: String,
) -> Result<()> {
    // tracing::event! 宏要求 level 是编译期常量, 这里按级别分发。
    match level.as_str() {
        "error" => tracing::error!(target: "renderer", "{msg}"),
        "warn" => tracing::warn!(target: "renderer", "{msg}"),
        "debug" => tracing::debug!(target: "renderer", "{msg}"),
        _ => tracing::info!(target: "renderer", "{msg}"),
    }
    Ok(())
}
