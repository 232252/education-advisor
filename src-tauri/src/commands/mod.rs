//! Commands 层 — Tauri `#[command]` 薄包装。
//!
//! 每个 command 干两件事:
//!   1. 从 `State<AppState>` 取需要的 service。
//!   2. 调对应 service 方法, 返回 `Result<T, AppError>`。
//!
//! 业务逻辑全部在 `crate::services` 里, command 不写循环/不直接访问文件系统
//! (与原 Electron ipc-handler ↔ service 分层一致)。
//!
//! 通道名映射规则 (与 preload 一一对应):
//!   原 Electron:  `ipcRenderer.invoke('ai:list-models', providerId)`
//!   Tauri:        `invoke('ai_list_models', { providerId })`
//!   (前端 ipc-client.ts 统一做 `.replace(':', '_')`, 见 docs/04-FRONTEND-SHIM.md)

pub mod agent;
pub mod ai;
pub mod chat;
pub mod compliance;
pub mod cron;
pub mod eaa;
pub mod feishu;
pub mod log_viewer;
pub mod privacy;
pub mod profile;
pub mod settings;
pub mod skill;
pub mod sys;

/// Tauri 2 invoke handler 类型别名, 让 `register()` 签名一眼可读。
type InvokeHandler =
    Box<dyn Fn(&mut tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync>;

/// 把所有 command 注册进 Tauri Builder。
/// 在 main.rs 里 `tauri::Builder::default().invoke_handler(crate::commands::register())`。
pub fn register() -> InvokeHandler {
    // Tauri 2.x 用 generate_handler! 宏在 main.rs 直接展开; 这里提供一份统一入口便于
    // 单文件维护。详见 main.rs。
    unimplemented!("use generate_handler! in main.rs; this is a placeholder for documentation")
}

/// generate_handler 引用的全部 command 函数, 按命名空间分组列出。
/// 当 main.rs 写 `tauri::generate_handler![crate::commands::all_commands!()]` 时展开。
#[macro_export]
#[allow(clippy::crate_in_macro_def)] // 宏仅在同 crate 的 main.rs 内展开, `crate` 解析正确
macro_rules! all_commands {
    () => {
        // ===== AI / LLM =====
        $crate::commands::ai::ai_list_providers,
        $crate::commands::ai::ai_list_models,
        $crate::commands::ai::ai_test_connection,
        crate::commands::ai::ai_set_api_key,
        crate::commands::ai::ai_delete_api_key,
        crate::commands::ai::ai_oauth_login,
        crate::commands::ai::ai_chat,
        crate::commands::ai::ai_chat_abort,
        crate::commands::ai::ai_add_custom_model,
        crate::commands::ai::ai_del_custom_model,
        crate::commands::ai::ai_update_custom_model,
        // ===== Agent =====
        crate::commands::agent::agent_list,
        crate::commands::agent::agent_get,
        crate::commands::agent::agent_toggle,
        crate::commands::agent::agent_update,
        crate::commands::agent::agent_get_soul,
        crate::commands::agent::agent_set_soul,
        crate::commands::agent::agent_get_rules,
        crate::commands::agent::agent_set_rules,
        crate::commands::agent::agent_run_manual,
        crate::commands::agent::agent_get_history,
        crate::commands::agent::agent_get_all_executions,
        crate::commands::agent::agent_abort,
        crate::commands::agent::agent_approval_resolve,
        crate::commands::agent::agent_approval_pending_count,
        crate::commands::agent::agent_memory_list,
        crate::commands::agent::agent_memory_create,
        crate::commands::agent::agent_memory_delete,
        // ===== EAA 核心 =====
        crate::commands::eaa::eaa_info,
        crate::commands::eaa::eaa_score,
        crate::commands::eaa::eaa_ranking,
        crate::commands::eaa::eaa_replay,
        crate::commands::eaa::eaa_add_event,
        crate::commands::eaa::eaa_revert_event,
        crate::commands::eaa::eaa_history,
        crate::commands::eaa::eaa_search,
        crate::commands::eaa::eaa_range,
        crate::commands::eaa::eaa_tag,
        crate::commands::eaa::eaa_stats,
        crate::commands::eaa::eaa_validate,
        crate::commands::eaa::eaa_export,
        crate::commands::eaa::eaa_list_students,
        crate::commands::eaa::eaa_add_student,
        crate::commands::eaa::eaa_delete_student,
        crate::commands::eaa::eaa_set_student_meta,
        crate::commands::eaa::eaa_import,
        crate::commands::eaa::eaa_codes,
        crate::commands::eaa::eaa_doctor,
        crate::commands::eaa::eaa_summary,
        crate::commands::eaa::eaa_dashboard,
        // ===== 隐私 =====
        crate::commands::privacy::privacy_init,
        crate::commands::privacy::privacy_load,
        crate::commands::privacy::privacy_enable,
        crate::commands::privacy::privacy_disable,
        crate::commands::privacy::privacy_list,
        crate::commands::privacy::privacy_add,
        crate::commands::privacy::privacy_anonymize,
        crate::commands::privacy::privacy_deanonymize,
        crate::commands::privacy::privacy_filter,
        crate::commands::privacy::privacy_dryrun,
        crate::commands::privacy::privacy_backup,
        // ===== 合规 =====
        crate::commands::compliance::compliance_generate,
        crate::commands::compliance::compliance_list,
        crate::commands::compliance::compliance_save,
        crate::commands::compliance::compliance_read_audit,
        // ===== Cron =====
        crate::commands::cron::cron_list,
        crate::commands::cron::cron_add,
        crate::commands::cron::cron_update,
        crate::commands::cron::cron_remove,
        crate::commands::cron::cron_toggle,
        crate::commands::cron::cron_run_now,
        crate::commands::cron::cron_get_logs,
        // ===== Skill =====
        crate::commands::skill::skill_list,
        crate::commands::skill::skill_get,
        crate::commands::skill::skill_save,
        crate::commands::skill::skill_delete,
        crate::commands::skill::skill_set_enabled,
        // ===== Settings =====
        crate::commands::settings::settings_get,
        crate::commands::settings::settings_set,
        crate::commands::settings::settings_reset,
        // ===== Profile =====
        crate::commands::profile::profile_get,
        crate::commands::profile::profile_set,
        crate::commands::profile::profile_validate_academic,
        // ===== Chat 持久化 =====
        crate::commands::chat::chat_save_message,
        crate::commands::chat::chat_load_messages,
        crate::commands::chat::chat_delete_session,
        crate::commands::chat::chat_list_sessions,
        // ===== 日志 =====
        crate::commands::log_viewer::log_list,
        crate::commands::log_viewer::log_read,
        crate::commands::log_viewer::log_clear,
        crate::commands::log_viewer::log_filter,
        crate::commands::log_viewer::log_search,
        crate::commands::log_viewer::log_export,
        crate::commands::log_viewer::log_export_dialog,
        crate::commands::log_viewer::log_write_renderer,
        // ===== 飞书 =====
        crate::commands::feishu::feishu_test,
        crate::commands::feishu::feishu_bitable,
        crate::commands::feishu::feishu_send,
        crate::commands::feishu::feishu_send_preflight,
        crate::commands::feishu::feishu_send_confirm,
        crate::commands::feishu::feishu_status,
        crate::commands::feishu::feishu_sync_now,
        // ===== 系统 =====
        crate::commands::sys::sys_open_dialog,
        crate::commands::sys::sys_save_dialog,
        crate::commands::sys::sys_open_external,
        crate::commands::sys::sys_get_path,
        crate::commands::sys::sys_check_update,
        crate::commands::sys::sys_show_update_dialog,
        crate::commands::sys::sys_notification,
        crate::commands::sys::sys_reset_factory,
        crate::commands::sys::sys_delete_by_class,
        crate::commands::sys::sys_delete_student_by_name,
        crate::commands::sys::sys_reset_events_only
    };
}
