//! Services 层 — 业务逻辑 (从 TS service 重写)。
//!
//! 每个 service 是无状态或有明确状态的 struct, 通过 `AppState` 注入。
//! command 层只做参数解析 + 调用 service, 不含业务逻辑。
//! 与原 Electron `src/main/services/*.ts` 一一对应 (见文件头注释)。

pub mod agent_runner; // agent 执行器 (run_manual + scheduler 共用)
pub mod agent_service; // ← src/main/services/agent-service.ts (1278 行)
pub mod broadcaster; // ← src/main/services/broadcaster.ts
pub mod db; // ← src/main/services/db-service.ts (556 行)
pub mod feishu_service; // ← src/main/services/feishu-service.ts
pub mod keystore; // ← src/main/services/keystore-service.ts (DPAPI -> keyring)
pub mod llm_service; // ← src/main/services/pi-ai-service.ts (951 行)
pub mod oauth; // Notion + Discord OAuth flow (PKCE + token exchange)
pub mod privacy_audit; // ← src/main/services/privacy-audit.ts + compliance-report.ts
pub mod profile_service; // ← src/main/services/profile-service.ts
pub mod scheduler; // ← src/main/services/cron-service.ts (node-cron -> tokio-cron-scheduler)
pub mod settings_service; // ← src/main/services/settings-service.ts
pub mod skill_service; // ← src/main/services/skill-service.ts
pub mod tray;
