//! Education Advisor — Tauri 桌面端入口。
//!
//! 职责 (与原 Electron `src/main/index.ts` 对应):
//!   1. 初始化 tracing 日志。
//!   2. 解析 userData / resources 路径。
//!   3. 构造 AppState (DB / 设置 / agent / scheduler ...)。
//!   4. 启动 scheduler。
//!   5. 安装系统托盘。
//!   6. 注册全部 90+ #[tauri::command]。
//!
//! 详见 docs/01-ARCHITECTURE.md。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use ea_tauri::commands;
use ea_tauri::services::tray;
use ea_tauri::state::{resolve_paths, AppState};
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
use ea_tauri::platform::windows_focus;

/// 处理 OAuth deep-link 回调 URL。
///
/// URL 格式: `educationadvisor://oauth/callback?code=xxx&state=yyy`
/// 当浏览器完成 OAuth 授权后, provider 重定向到此 scheme,
/// OS 把它交给本应用 → deep-link 插件触发 on_open_url → 此函数。
///
/// 提取 code + state 后, 通过 Tauri 事件 `oauth-callback` 发给前端,
/// 前端拿 code 调后端 command 换 token。
fn handle_oauth_callback(app: &tauri::AppHandle, url: url::Url) {
    if url.scheme() != "educationadvisor" || url.host_str() != Some("oauth") {
        return;
    }
    let mut code: Option<String> = None;
    let mut state: Option<String> = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => state = Some(v.into_owned()),
            _ => {}
        }
    }
    if let Some(code) = code {
        tracing::info!(target: "oauth", "收到 OAuth 回调, state={:?}", state);
        let _ = app.emit(
            "oauth-callback",
            serde_json::json!({ "code": code, "state": state }),
        );
    }
}

fn main() {
    // 日志: tracing-subscriber, level 由 RUST_LOG 控制 (默认 info)。
    // 启用 "log" feature 后, 该 subscriber 会同时接管 `log` facade 全局 logger,
    // 让依赖库的 log:: 调用也走 tracing 输出 (无需额外 LogTracer)。
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,ea_tauri=debug".into()),
        )
        .with_target(true)
        .init();

    tracing::info!(target: "main", "starting Education Advisor Tauri v{}", ea_tauri::APP_VERSION);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        // single-instance: 确保 deep-link 回调发给已有窗口而非新实例
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // 第二个实例启动时, deep-link 插件会把 URL 转发给主实例
        }))
        // 注: tauri-plugin-log 会安装全局 log logger, 与下面的 tracing-subscriber 冲突。
        // 统一用 tracing-subscriber 管理日志。
        .setup(|app| {
            // --- Deep-link: OAuth 回调处理 ---
            use tauri_plugin_deep_link::DeepLinkExt;
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            {
                let _ = app.deep_link().register_all();
            }
            // 冷启动时处理 URL
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    handle_oauth_callback(app.handle(), url);
                }
            }
            // 运行时 URL 监听
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_oauth_callback(&app_handle, url.clone());
                }
            });
            // 解析路径
            let user_data = app.path().app_data_dir().expect("无法解析 app_data_dir");
            std::fs::create_dir_all(&user_data).ok();
            // 资源目录: 开发模式下指向仓库根 (src-tauri/ 的上级), 打包后用 resource_dir()。
            let dev_resources = std::env::current_dir()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf())) // src-tauri/.. = 仓库根
                .filter(|p| p.join("config").join("agents.yaml").exists());
            let resources = dev_resources.unwrap_or_else(|| {
                app.path()
                    .resource_dir()
                    .unwrap_or_else(|_| user_data.join("resources"))
            });

            // AppState 在 tokio runtime 内异步初始化 (Tauri setup 是同步的 → block_on)
            let paths = resolve_paths(user_data.clone(), resources.clone(), None);
            let app_handle_for_state = app.handle().clone();
            let state = tauri::async_runtime::block_on(async move {
                AppState::init(paths, app_handle_for_state)
                    .await
                    .expect("AppState init failed")
            });
            app.manage(state);

            // 启动 scheduler (后台) + 注入 runner (定时任务真正执行 agent)
            {
                let app_handle = app.handle().clone();
                let st: tauri::State<'_, AppState> = app.state();
                tauri::async_runtime::block_on(async move {
                    // 先启动 scheduler
                    if let Err(e) = st.scheduler.lock().await.start().await {
                        tracing::warn!(target: "main", "scheduler 启动失败: {e}");
                    }
                    // 注入 runner: cron tick / run_now 时触发 agent 执行。
                    // runner 拿 AppHandle 取 AppState, spawn 异步任务调 agent_runner::run。
                    let runner: ea_tauri::services::scheduler::TaskRunner = std::sync::Arc::new(
                        move |task_id: String, agent_id: String, payload: serde_json::Value| {
                            let app_handle = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                let st: tauri::State<'_, AppState> = app_handle.state();
                                let prompt = payload
                                    .get("prompt")
                                    .and_then(|p| p.as_str())
                                    .unwrap_or("定时触发,请执行例行任务")
                                    .to_string();
                                tracing::info!(
                                    target: "scheduler",
                                    "runner 触发 agent={agent_id} task={task_id} prompt={prompt}"
                                );
                                // 复用 agent_runner::run (手动触发/定时共用同一执行路径)
                                if let Err(e) = ea_tauri::services::agent_runner::run(
                                    &app_handle,
                                    &st,
                                    &agent_id,
                                    &prompt,
                                    None,
                                )
                                .await
                                {
                                    tracing::warn!(target: "scheduler", "agent 执行失败: {e}");
                                }
                            });
                        },
                    );
                    st.scheduler.lock().await.set_runner(runner);
                });
            }

            // 托盘
            if let Err(e) = tray::setup(app.handle()) {
                tracing::warn!(target: "main", "托盘安装失败: {e}");
            }

            // Windows 焦点修复: 启动后显式聚焦 + 守护循环
            // 解决 "Windows 下键盘事件无响应" 的常见 DWM 焦点链问题。
            // 其他平台编译为空 stub,完全 no-op。
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                windows_focus::initial_focus(&window);
                windows_focus::install_refocus_guard(&window);
                tracing::info!(target: "main", "Windows focus guard 已启用");
            }

            tracing::info!(target: "main", "ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // AI / LLM
            commands::ai::ai_list_providers,
            commands::ai::ai_list_models,
            commands::ai::ai_test_connection,
            commands::ai::ai_set_api_key,
            commands::ai::ai_delete_api_key,
            commands::ai::ai_oauth_login,
            commands::ai::ai_oauth_exchange,
            commands::ai::ai_oauth_list_supported,
            commands::ai::ai_chat,
            commands::ai::ai_chat_abort,
            commands::ai::ai_add_custom_model,
            commands::ai::ai_del_custom_model,
            commands::ai::ai_update_custom_model,
            // Agent
            commands::agent::agent_list,
            commands::agent::agent_get,
            commands::agent::agent_toggle,
            commands::agent::agent_update,
            commands::agent::agent_get_soul,
            commands::agent::agent_set_soul,
            commands::agent::agent_get_rules,
            commands::agent::agent_set_rules,
            commands::agent::agent_run_manual,
            commands::agent::agent_get_history,
            commands::agent::agent_get_all_executions,
            commands::agent::agent_abort,
            commands::agent::agent_memory_list,
            commands::agent::agent_memory_create,
            commands::agent::agent_memory_delete,
            // EAA
            commands::eaa::eaa_info,
            commands::eaa::eaa_score,
            commands::eaa::eaa_ranking,
            commands::eaa::eaa_replay,
            commands::eaa::eaa_add_event,
            commands::eaa::eaa_revert_event,
            commands::eaa::eaa_history,
            commands::eaa::eaa_search,
            commands::eaa::eaa_range,
            commands::eaa::eaa_tag,
            commands::eaa::eaa_stats,
            commands::eaa::eaa_validate,
            commands::eaa::eaa_export,
            commands::eaa::eaa_list_students,
            commands::eaa::eaa_add_student,
            commands::eaa::eaa_delete_student,
            commands::eaa::eaa_set_student_meta,
            commands::eaa::eaa_import,
            commands::eaa::eaa_codes,
            commands::eaa::eaa_doctor,
            commands::eaa::eaa_summary,
            commands::eaa::eaa_dashboard,
            // Privacy
            commands::privacy::privacy_init,
            commands::privacy::privacy_load,
            commands::privacy::privacy_enable,
            commands::privacy::privacy_disable,
            commands::privacy::privacy_list,
            commands::privacy::privacy_add,
            commands::privacy::privacy_anonymize,
            commands::privacy::privacy_deanonymize,
            commands::privacy::privacy_filter,
            commands::privacy::privacy_dryrun,
            commands::privacy::privacy_backup,
            // Compliance
            commands::compliance::compliance_generate,
            commands::compliance::compliance_list,
            commands::compliance::compliance_save,
            commands::compliance::compliance_read_audit,
            // Cron
            commands::cron::cron_list,
            commands::cron::cron_add,
            commands::cron::cron_update,
            commands::cron::cron_remove,
            commands::cron::cron_toggle,
            commands::cron::cron_run_now,
            commands::cron::cron_get_logs,
            // Skill
            commands::skill::skill_list,
            commands::skill::skill_get,
            commands::skill::skill_save,
            commands::skill::skill_delete,
            commands::skill::skill_set_enabled,
            // Settings
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_reset,
            // Profile
            commands::profile::profile_get,
            commands::profile::profile_set,
            commands::profile::profile_validate_academic,
            // Chat
            commands::chat::chat_save_message,
            commands::chat::chat_load_messages,
            commands::chat::chat_delete_session,
            commands::chat::chat_list_sessions,
            // Log
            commands::log_viewer::log_list,
            commands::log_viewer::log_read,
            commands::log_viewer::log_clear,
            commands::log_viewer::log_filter,
            commands::log_viewer::log_search,
            commands::log_viewer::log_export,
            commands::log_viewer::log_export_dialog,
            commands::log_viewer::log_write_renderer,
            // Feishu
            commands::feishu::feishu_test,
            commands::feishu::feishu_bitable,
            commands::feishu::feishu_send,
            commands::feishu::feishu_send_preflight,
            commands::feishu::feishu_send_confirm,
            commands::feishu::feishu_status,
            commands::feishu::feishu_sync_now,
            // Sys
            commands::sys::sys_open_dialog,
            commands::sys::sys_save_dialog,
            commands::sys::sys_open_external,
            commands::sys::sys_get_path,
            commands::sys::sys_check_update,
            commands::sys::sys_show_update_dialog,
            commands::sys::sys_notification,
            commands::sys::sys_reset_factory,
            commands::sys::sys_delete_by_class,
            commands::sys::sys_delete_student_by_name,
            commands::sys::sys_reset_events_only,
            // Windows 焦点修复: 给前端 mousedown 监听用的兜底 command。
            // 其他平台编译时不注册,前端调用会报 "command not found"。
            #[cfg(target_os = "windows")]
            ea_tauri::platform::windows_focus::force_refocus
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
