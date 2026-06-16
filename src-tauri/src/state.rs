//! 全局应用状态 — 持有所有 service 单例。
//!
//! 对应原 Electron 主进程里在 `app.whenReady` 时 new 出来的各种 service 实例。
//! 通过 `tauri::Builder::manage(AppState::new(...))` 注入, command 用 `State<AppState>` 取。
//!
//! 线程安全策略:
//!   - 每个服务用 `Arc<RwLock<T>>` 包裹, 写少读多 → RwLock 比 Mutex 更并发友好。
//!   - 跨 command 共享, 但每个写操作内部持锁时间尽量短。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::RwLock;
use tokio::sync::Mutex;

use crate::error::Result;
use crate::harness::guardrails::ApprovalChannel;
use crate::services;

/// 用户数据根目录 (对应 Electron 的 `app.getPath('userData')`)。
/// 在 setup 钩子里由 `tauri::Manager::path()` 解析并注入。
#[derive(Debug, Clone)]
pub struct Paths {
    /// userData 根 (settings.json, eaa-data/ 在此)。
    pub user_data: PathBuf,
    /// EAA 数据目录 (事件日志/实体/隐私映射), 默认 `{user_data}/eaa-data`。
    pub eaa_data: PathBuf,
    /// SQLite 数据库路径 `{user_data}/ea.db`。
    pub db: PathBuf,
    /// 应用资源目录 (打包后的 config/ 与 agents/)。
    pub resources: PathBuf,
    /// 日志目录 `{user_data}/logs`。
    pub logs: PathBuf,
}

/// 全局状态容器。所有 service 在 setup 时 lazy 初始化, 之后只读引用。
pub struct AppState {
    pub paths: Paths,
    pub db: Arc<Mutex<services::db::DbService>>,
    pub privacy: Arc<RwLock<eaa_core::privacy::PrivacyEngine>>,
    pub privacy_enabled: Arc<RwLock<bool>>,
    pub agents: Arc<RwLock<services::agent_service::AgentService>>,
    pub llm: Arc<services::llm_service::LlmService>,
    pub scheduler: Arc<Mutex<services::scheduler::SchedulerService>>,
    pub skills: Arc<RwLock<services::skill_service::SkillService>>,
    pub settings: Arc<RwLock<services::settings_service::SettingsService>>,
    pub keystore: Arc<services::keystore::KeystoreService>,
    pub privacy_audit: Arc<RwLock<services::privacy_audit::PrivacyAuditService>>,
    pub feishu: Arc<services::feishu_service::FeishuService>,
    pub profile: Arc<RwLock<services::profile_service::ProfileService>>,
    pub oauth: Arc<services::oauth::OAuthFlow>,
    /// 当前进行中的 LLM/Agent 流, 用于 abort。key = 流式会话 id。
    pub active_streams:
        Arc<Mutex<std::collections::HashMap<String, tokio_util::sync::CancellationToken>>>,
    /// 审批通道 (HITL)— oneshot 一次性决议，前端发 `agent_approval_resolve` 命令回写
    pub approval_channel: Arc<ApprovalChannel>,
}

impl AppState {
    /// 初始化所有 service。在 Tauri setup 钩子里调用。
    /// 失败会让 app 启动失败 (设置/DB 是硬依赖)。
    /// `app` 必传 — 阶段三用于 ApprovalChannel 持有 AppHandle (emit approval-required 事件)
    pub async fn init(paths: Paths, app: tauri::AppHandle) -> Result<Self> {
        // 首次运行: 确保 EAA 数据引擎的文件结构存在 (空 entities/events/index),
        // 否则 add_student/score 等会因为 load_* 找不到文件而失败。
        // 对应原 Electron 版 eaa-bridge 在首次调用前的 init 步骤。
        ensure_eaa_data_initialized(&paths.eaa_data);

        // DB (硬依赖: agent 历史 / 对话 / cron 日志)
        // DbService::open 返回裸 DbService, 这里包成 Arc<Mutex<>> 供跨 command 共享。
        let db = services::db::DbService::open(&paths.db)?;
        let db = Arc::new(Mutex::new(db));

        // 设置 (硬依赖: 几乎所有服务都要读 settings.dataDir/modelTier)
        let settings = services::settings_service::SettingsService::load(&paths.user_data)?;
        let settings = Arc::new(RwLock::new(settings));

        // 隐私引擎 (懒加载: init/load 前是空 mapping)
        let privacy = Arc::new(RwLock::new(eaa_core::privacy::PrivacyEngine::default()));
        let privacy_enabled = Arc::new(RwLock::new(false));

        // 业务服务 (软依赖: 失败时降级为空, 不阻断启动)
        let agents = services::agent_service::AgentService::load(&paths.resources)?;
        let agents = Arc::new(RwLock::new(agents));

        let skills = services::skill_service::SkillService::load(&paths.resources)?;
        let skills = Arc::new(RwLock::new(skills));

        let profile =
            services::profile_service::ProfileService::new(paths.eaa_data.join("profiles"));
        let profile = Arc::new(RwLock::new(profile));

        let privacy_audit = services::privacy_audit::PrivacyAuditService::open(
            paths.eaa_data.join("privacy").join("audit.log"),
        )?;
        let privacy_audit = Arc::new(RwLock::new(privacy_audit));

        Ok(Self {
            paths,
            db,
            privacy,
            privacy_enabled,
            agents,
            llm: Arc::new(services::llm_service::LlmService::new()),
            scheduler: Arc::new(Mutex::new(services::scheduler::SchedulerService::new())),
            skills,
            settings,
            keystore: Arc::new(services::keystore::KeystoreService::new(
                "education-advisor",
            )),
            privacy_audit,
            feishu: Arc::new(services::feishu_service::FeishuService::new()),
            oauth: Arc::new(services::oauth::OAuthFlow::new()),
            profile,
            active_streams: Arc::new(Mutex::new(std::collections::HashMap::new())),
            approval_channel: Arc::new(ApprovalChannel::new(app)),
        })
    }
}

/// 首次运行初始化 EAA 数据目录: 建子目录 + 写空 JSON (entities/events/index)。
/// 已存在则跳过 (不覆盖用户数据)。对应原 eaa-bridge 首次调用的 init。
/// 失败仅记日志, 不阻断启动 (用户可在 Settings→数据管理手动 reset)。
fn ensure_eaa_data_initialized(eaa_data: &Path) {
    for sub in ["entities", "events", "profiles", "logs", "privacy"] {
        let _ = std::fs::create_dir_all(eaa_data.join(sub));
    }
    let entities = eaa_data.join("entities/entities.json");
    if !entities.exists() {
        let _ = std::fs::write(&entities, r#"{"entities":{}}"#);
    }
    let index = eaa_data.join("entities/name_index.json");
    if !index.exists() {
        let _ = std::fs::write(&index, "{}");
    }
    let events = eaa_data.join("events/events.json");
    if !events.exists() {
        let _ = std::fs::write(&events, "[]");
    }
    tracing::debug!(target: "state", "eaa data dir ensured: {}", eaa_data.display());
}

/// 在 Tauri setup 里解析 userData 与资源路径。
/// 对应原 Electron `app.getPath('userData')` 与 `process.resourcesPath`。
pub fn resolve_paths(
    user_data: PathBuf,
    resources: PathBuf,
    eaa_data_override: Option<PathBuf>,
) -> Paths {
    let eaa_data = eaa_data_override.unwrap_or_else(|| user_data.join("eaa-data"));
    Paths {
        user_data: user_data.clone(),
        eaa_data: eaa_data.clone(),
        db: user_data.join("ea.db"),
        resources,
        logs: user_data.join("logs"),
    }
}
