//! System commands — 系统/OS IPC (11 个通道, `sys:*`)。
//! 对话框/外链/通知/自动更新走 Tauri 插件; 路径解析 / 数据维护直接实现。

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;

use crate::error::{AppError, Result};
use crate::state::AppState;

#[tauri::command]
pub async fn sys_open_dialog(app: AppHandle, options: Value) -> Result<Value> {
    let mut d = app.dialog().file();
    if let Some(title) = options.get("title").and_then(|v| v.as_str()) {
        d = d.set_title(title);
    }
    if let Some(multi) = options.get("multiple").and_then(|v| v.as_bool()) {
        if multi {
            // multiple 选择的返回值是 Vec; 单选返回 FilePath
            let paths: Vec<String> = d
                .blocking_pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|p| p.to_string())
                .collect();
            return Ok(json!({ "canceled": paths.is_empty(), "paths": paths }));
        }
    }
    match d.blocking_pick_file() {
        Some(p) => Ok(json!({ "canceled": false, "path": p.to_string() })),
        None => Ok(json!({ "canceled": true })),
    }
}

#[tauri::command]
pub async fn sys_save_dialog(app: AppHandle, options: Value) -> Result<Value> {
    let mut d = app.dialog().file();
    if let Some(title) = options.get("title").and_then(|v| v.as_str()) {
        d = d.set_title(title);
    }
    match d.blocking_save_file() {
        Some(p) => Ok(json!({ "canceled": false, "path": p.to_string() })),
        None => Ok(json!({ "canceled": true })),
    }
}

#[tauri::command]
pub async fn sys_open_external(app: AppHandle, url: String) -> Result<Value> {
    // 安全: 仅允许 http/https (与原 Electron 校验一致)
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(AppError::Validation(format!(
            "仅允许 http/https 链接: {url}"
        )));
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(crate::error::other)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn sys_get_path(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
) -> Result<String> {
    let path = match name.as_str() {
        "userData" => app.path().app_data_dir().map_err(crate::error::other)?,
        "resources" => app.path().resource_dir().map_err(crate::error::other)?,
        "logs" => state.paths.logs.clone(),
        "eaaData" => state.paths.eaa_data.clone(),
        "db" => state.paths.db.clone(),
        "temp" => std::env::temp_dir(),
        other => return Err(AppError::NotFound(format!("未知路径名: {other}"))),
    };
    Ok(path.display().to_string())
}

/// sys:check-update — 通过 tauri-plugin-updater 检查 GitHub Releases。
///
/// 实现原理 (与 tauri-apps 官方 updater 一致):
///   1. updater 插件从 tauri.conf.json 的 plugins.updater.endpoints 拉 latest.json
///   2. latest.json 含 version/pub_date/download_url/signature
///   3. 用 tauri.conf.json 的 pubkey 校验签名
///   4. 返回 Update 对象 (含 version/notes/download)
///
/// 前端拿到 hasUpdate=true 后, 调 sys_show_update_dialog (下载+安装+重启)。
#[tauri::command]
pub async fn sys_check_update(app: AppHandle) -> Result<Value> {
    use tauri_plugin_updater::UpdaterExt;

    let current = crate::APP_VERSION;
    match app.updater()?.check().await {
        Ok(Some(update)) => {
            tracing::info!(target: "updater", "有更新: {} → {}", current, update.version);
            Ok(json!({
                "hasUpdate": true,
                "currentVersion": current,
                "latestVersion": update.version,
                "releaseDate": update.date,
                "releaseNotes": update.body,
                "available": true,
            }))
        }
        Ok(None) => {
            tracing::info!(target: "updater", "已是最新版本 {}", current);
            Ok(json!({
                "hasUpdate": false,
                "currentVersion": current,
                "latestVersion": current,
                "available": false,
                "message": "已是最新版本",
            }))
        }
        Err(e) => {
            tracing::warn!(target: "updater", "检查更新失败: {e}");
            // 检查失败不应阻断 UI, 返回 hasUpdate=false + 错误信息
            Ok(json!({
                "hasUpdate": false,
                "currentVersion": current,
                "latestVersion": current,
                "available": false,
                "error": e.to_string(),
                "message": format!("检查更新失败 (可能未配置 pubkey/endpoint): {e}"),
            }))
        }
    }
}

/// sys:show-update-dialog — 下载 + 安装 + 重启。
///
/// 实现原理:
///   1. 再次 check() 拿到 Update 对象
///   2. update.download_and_install() 下载签名校验后安装
///   3. tauri_plugin_process::restart() 重启应用
#[tauri::command]
pub async fn sys_show_update_dialog(app: AppHandle) -> Result<Value> {
    use tauri_plugin_updater::UpdaterExt;

    let update = match app.updater()?.check().await {
        Ok(Some(u)) => u,
        Ok(None) => return Ok(json!({ "success": true, "message": "已是最新版本" })),
        Err(e) => {
            return Ok(json!({ "success": false, "error": e.to_string() }));
        }
    };

    tracing::info!(target: "updater", "开始下载更新 {}...", update.version);

    // 把 on_chunk / on_finish 桥接到 `sys:update-progress` 事件,
    // 让前端 SettingsPage 显示下载进度条 (downloaded/total bytes)。
    // 注: tauri-plugin-updater 回调签名是 `FnMut(usize, Option<u64>)` —
    //   downloaded = usize (累计字节), total = Option<u64> (服务端可能不返回总大小)。
    let app_for_progress = app.clone();
    let version = update.version.clone();
    let mut on_chunk = move |downloaded: usize, total: Option<u64>| {
        use tauri::Emitter;
        let total_u = total.unwrap_or(0);
        let percent = if total_u > 0 {
            (downloaded as f64 / total_u as f64 * 100.0) as u64
        } else {
            0
        };
        let _ = app_for_progress.emit(
            "sys:update-progress",
            json!({
                "version": version,
                "downloaded": downloaded,
                "total": total_u,
                "percent": percent,
                "phase": "downloading",
            }),
        );
    };
    let app_for_finish = app.clone();
    let version_finish = update.version.clone();
    let on_finish = move || {
        use tauri::Emitter;
        let _ = app_for_finish.emit(
            "sys:update-progress",
            json!({
                "version": version_finish,
                "phase": "verifying",
                "message": "校验签名并安装...",
            }),
        );
    };

    match update.download_and_install(&mut on_chunk, on_finish).await {
        Ok(_) => {
            tracing::info!(target: "updater", "更新安装完成, 准备重启");
            // 安装成功后重启应用 (tauri-plugin-process 暴露的 restart 命令内部调用 request_restart)
            use tauri::Emitter;
            let _ = app.emit(
                "sys:update-progress",
                json!({ "phase": "restarting", "message": "安装完成, 正在重启..." }),
            );
            app.request_restart();
            Ok(json!({ "success": true, "message": "更新安装完成, 正在重启" }))
        }
        Err(e) => {
            tracing::error!(target: "updater", "更新安装失败: {e}");
            use tauri::Emitter;
            let _ = app.emit(
                "sys:update-progress",
                json!({ "phase": "error", "error": e.to_string() }),
            );
            Ok(json!({ "success": false, "error": e.to_string() }))
        }
    }
}

#[tauri::command]
pub async fn sys_notification(app: AppHandle, title: String, body: String) -> Result<Value> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(crate::error::other)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn sys_reset_factory(app: AppHandle, state: State<'_, AppState>) -> Result<Value> {
    let user_data = app.path().app_data_dir().map_err(crate::error::other)?;
    let eaa = state.paths.eaa_data.clone();
    if eaa.exists() {
        let _ = std::fs::remove_dir_all(&eaa);
    }
    let db_path = &state.paths.db;
    if db_path.exists() {
        let _ = std::fs::remove_file(db_path);
    }
    state.settings.write().reset()?;
    Ok(
        json!({ "success": true, "message": format!("已清空 {}/eaa-data 与 db, 设置重置", user_data.display()) }),
    )
}

#[tauri::command]
pub async fn sys_delete_by_class(_state: State<'_, AppState>, class_id: String) -> Result<Value> {
    let _lock = eaa_core::storage::FileLock::acquire().map_err(crate::error::other)?;
    let mut entities = eaa_core::storage::load_entities().map_err(crate::error::other)?;
    let before = entities.entities.len();
    entities
        .entities
        .retain(|_, e| e.class_id.as_deref() != Some(&class_id));
    let after = entities.entities.len();
    eaa_core::storage::save_entities(&entities).map_err(crate::error::other)?;
    Ok(json!({ "success": true, "message": format!("删除 {class_id}"), "deleted": before - after }))
}

#[tauri::command]
pub async fn sys_delete_student_by_name(
    _state: State<'_, AppState>,
    name: String,
) -> Result<Value> {
    let _lock = eaa_core::storage::FileLock::acquire().map_err(crate::error::other)?;
    let mut entities = eaa_core::storage::load_entities().map_err(crate::error::other)?;
    let mut index = eaa_core::storage::load_name_index().map_err(crate::error::other)?;
    let existed = index.remove(&name).is_some() && entities.entities.remove(&name).is_some();
    eaa_core::storage::save_entities(&entities).map_err(crate::error::other)?;
    eaa_core::storage::save_name_index(&index).map_err(crate::error::other)?;
    Ok(
        json!({ "success": existed, "message": if existed { format!("已删除 {name}") } else { format!("未找到 {name}") } }),
    )
}

#[tauri::command]
pub async fn sys_reset_events_only(_state: State<'_, AppState>) -> Result<Value> {
    let _lock = eaa_core::storage::FileLock::acquire().map_err(crate::error::other)?;
    eaa_core::storage::save_events(&[]).map_err(crate::error::other)?;
    Ok(json!({ "success": true, "message": "事件日志已清空 (学生保留)" }))
}
