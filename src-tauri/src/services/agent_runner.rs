//! Agent 执行器入口 (阶段二瘦身后)
//!
//! # 阶段二变更
//! - 旧版本 (~290 行): 把编排 + 隐私脱敏 + 事件 emit + tool 闭包 + DB 写全混
//! - 新版本 (~50 行): 仅保留参数适配 + 调 AgentHarness::run
//! - 编排逻辑移到 `crate::harness::agent::AgentHarness`

use tauri::AppHandle;

use crate::error::{AppError, Result};
use crate::harness::agent::{AgentHarness, AgentRunConfig};
use crate::services::llm_service::ChatMessage;
use crate::state::AppState;

/// 执行一次 agent 运行 (手动或定时共用入口)
pub async fn run(
    app: &AppHandle,
    state: &AppState,
    agent_id: &str,
    prompt: &str,
    history: Option<Vec<ChatMessage>>,
) -> Result<String> {
    let cfg = AgentRunConfig {
        agent_id: agent_id.to_string(),
        prompt: prompt.to_string(),
        history,
        cancel: None,
        budget: None,
        app_context: None,
        trace_collector: None,
    };
    run_with_config(app, state, cfg).await
}

/// 执行一次 agent 运行 (传入完整配置)
pub async fn run_with_config(
    app: &AppHandle,
    state: &AppState,
    cfg: AgentRunConfig,
) -> Result<String> {
    let registry = crate::harness::tools::build_default_registry();
    let harness = AgentHarness::new(state, registry, app.clone());
    match harness.run(cfg).await {
        Ok(summary) => Ok(summary.run_id),
        Err(e) => Err(AppError::Agent(e.to_string())),
    }
}

/// 定时任务调用的入口 (scheduler 注入)
/// 阶段二 stub: scheduler 实际场景与 run() 等价, 这里保留签名兼容。
pub async fn run_scheduled(state: &AppState, _agent_id: &str, _prompt: &str) -> Result<()> {
    let _ = state;
    Ok(())
}