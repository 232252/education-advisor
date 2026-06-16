//! AI commands — LLM / Provider / Chat IPC (11 个通道, `ai:*`)。
//! chat 触发流式, 通过 `ai:chat-stream` 事件增量推送 StreamEvent;
//! abort 通过 CancellationToken。

use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::events;
use crate::services::broadcaster;
use crate::services::llm_service::{ChatParams, StreamEvent};
use crate::state::AppState;

#[tauri::command]
pub async fn ai_list_providers(_state: State<'_, AppState>) -> Result<Vec<Value>> {
    // to_value 对 derive(Serialize) 的纯数据结构理论不会失败, 但用 ? 传播比 unwrap
    // 更稳 (一旦类型加了 custom serializer 出错, 也不会 panic 到主线程)。
    crate::services::llm_service::LlmService::list_providers()
        .into_iter()
        .map(|p| serde_json::to_value(p).map_err(AppError::from))
        .collect()
}

#[tauri::command]
pub async fn ai_list_models(state: State<'_, AppState>, provider_id: String) -> Result<Vec<Value>> {
    let models = state.llm.list_models(&provider_id);
    models
        .into_iter()
        .map(|m| serde_json::to_value(m).map_err(AppError::from))
        .collect()
}

#[tauri::command]
pub async fn ai_test_connection(
    state: State<'_, AppState>,
    provider_id: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<Value> {
    let r = state
        .llm
        .test_connection(&provider_id, &api_key, base_url.as_deref())
        .await?;
    serde_json::to_value(r).map_err(AppError::from)
}

#[tauri::command]
pub async fn ai_set_api_key(
    state: State<'_, AppState>,
    provider_id: String,
    api_key: String,
) -> Result<Value> {
    state.keystore.set(&provider_id, &api_key)?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn ai_delete_api_key(state: State<'_, AppState>, provider_id: String) -> Result<Value> {
    state.keystore.delete(&provider_id)?;
    Ok(json!({ "success": true }))
}

/// ai:oauth-login — 启动 OAuth 授权流程 (deep-link + PKCE 模式)。
///
/// 完整流程 (与 tauri-apps 官方 deep-link 示例一致):
///   1. 后端 OAuthFlow::start_flow 生成 state + PKCE code_verifier, 存进 Map
///   2. 构造 authorize URL (含 code_challenge=S256)
///   3. tauri-plugin-opener 打开系统浏览器
///   4. 用户授权 → provider 重定向到 educationadvisor://oauth/callback?code=xxx&state=yyy
///   5. deep-link 插件捕获 → main.rs handle_oauth_callback 解析 + emit("oauth-callback")
///   6. 前端 listen("oauth-callback") 拿 code + state → 调 ai_oauth_exchange 换 token
///   7. 后端 exchange 校验 state, POST token endpoint, 拿到 access_token 写 keystore
#[tauri::command]
pub async fn ai_oauth_login(
    app: AppHandle,
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<Value> {
    use crate::services::oauth::OAuthProvider;
    let provider = match OAuthProvider::from_id(&provider_id) {
        Some(p) => p,
        None => {
            return Ok(json!({
                "success": false,
                "error": format!("{provider_id} 不支持 deep-link OAuth"),
                "hint": "仅 Notion/Discord 支持; 其他 provider 请用 API Key"
            }));
        }
    };

    // client_id 来自 settings.models.oauth.{provider}.clientId
    let client_id: String = state
        .settings
        .read()
        .get_path(&format!("models.oauth.{provider_id}.clientId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if client_id.is_empty() {
        return Ok(json!({
            "success": false,
            "error": format!("OAuth client_id 未配置 (settings.models.oauth.{provider_id}.clientId)"),
            "hint": "请先在设置页填入 client_id (Notion: https://www.notion.so/my-integrations)"
        }));
    }

    let (authorize_url, state_token) = state.oauth.start_flow(provider, &client_id)?;

    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&authorize_url, None::<&str>)
        .map_err(|e| crate::error::AppError::Other(format!("打开浏览器失败: {e}")))?;

    tracing::info!(target: "oauth", "started {} flow state={}", provider_id, state_token);

    Ok(json!({
        "success": true,
        "message": "已打开浏览器, 请在浏览器中完成授权",
        "callbackEvent": "oauth-callback",
        "state": state_token,
        "providerId": provider_id,
    }))
}

/// ai:oauth-exchange — 用 deep-link 回调拿到的 code + state 换 access_token。
///
/// 成功后:
///   - access_token 写入 keystore (provider_id 作为 key), 后续 ai_chat 用此 token
///   - 返回 {success, providerId, expiresIn, scope}
#[tauri::command]
pub async fn ai_oauth_exchange(
    state: State<'_, AppState>,
    code: String,
    oauth_state: String,
    provider_id: String,
) -> Result<Value> {
    use crate::services::oauth::OAuthProvider;
    // 校验 provider 合法性 (绑定值本身不需要, 仅用于 ok_or_else 短路报错)
    let _provider = OAuthProvider::from_id(&provider_id)
        .ok_or_else(|| AppError::Validation(format!("不支持的 provider: {provider_id}")))?;

    // client_secret 可选 (Notion 不需要)
    let client_secret = state
        .keystore
        .get(&format!("{provider_id}_client_secret"))
        .ok()
        .flatten();

    let http = reqwest::Client::builder()
        .user_agent("education-advisor-tauri/0.1")
        .build()
        .map_err(|e| AppError::Other(format!("http client init: {e}")))?;

    let token = state
        .oauth
        .exchange(&oauth_state, &code, client_secret.as_deref(), &http)
        .await?;

    // 写 keystore (provider_id 作为 key, 后续 ai_chat 用此 token 作 API key)
    state.keystore.set(&provider_id, &token.access_token)?;
    tracing::info!(target: "oauth", "{} token exchange success, expires_in={:?}", provider_id, token.expires_in);

    Ok(json!({
        "success": true,
        "providerId": provider_id,
        "expiresIn": token.expires_in,
        "scope": token.scope,
        "tokenType": token.token_type,
        // Notion 附加信息
        "workspaceName": token.workspace_name,
        "workspaceId": token.workspace_id,
        "botId": token.bot_id,
    }))
}

/// ai:oauth-list-supported — 返回支持 OAuth 的 provider 列表 (前端据此渲染按钮)。
#[tauri::command]
pub async fn ai_oauth_list_supported() -> Result<Value> {
    use crate::services::oauth::OAuthProvider;
    let list = [OAuthProvider::Notion, OAuthProvider::Discord]
        .iter()
        .map(|p| {
            json!({
                "providerId": p.id(),
                "supportsOAuth": true,
                "requiresClientSecret": matches!(p, OAuthProvider::Discord),
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({ "providers": list }))
}

#[tauri::command]
pub async fn ai_add_custom_model(state: State<'_, AppState>, params: Value) -> Result<Value> {
    let m: crate::services::llm_service::ModelInfo = serde_json::from_value(params)?;
    state.llm.add_custom_model(m.clone());
    serde_json::to_value(m).map_err(AppError::from)
}

#[tauri::command]
pub async fn ai_del_custom_model(
    state: State<'_, AppState>,
    provider_id: String,
    model_id: String,
) -> Result<Value> {
    state.llm.delete_custom_model(&provider_id, &model_id);
    Ok(json!({ "success": true }))
}

#[tauri::command]
pub async fn ai_update_custom_model(state: State<'_, AppState>, params: Value) -> Result<Value> {
    let m: crate::services::llm_service::ModelInfo = serde_json::from_value(params)?;
    let provider = m.provider.clone();
    let id = m.id.clone();
    state.llm.update_custom_model(&provider, &id, m);
    Ok(json!({ "success": true }))
}

/// ai:chat — 启动一次流式对话。立即返回, 实际 token 通过 `ai:chat-stream` 事件推送。
/// abort 用 ai_chat_abort (按 session id)。
#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    params: ChatParams,
) -> Result<Value> {
    let session_id = Uuid::new_v4().to_string();
    let cancel = CancellationToken::new();
    state
        .active_streams
        .lock()
        .await
        .insert(session_id.clone(), cancel.clone());

    let api_key = state
        .keystore
        .get(&params.provider_id)?
        .ok_or_else(|| AppError::Llm(format!("未设置 {} 的 API Key", params.provider_id)))?;
    let base_url = state
        .settings
        .read()
        .get_path(&format!("models.baseUrl.{}", params.provider_id))
        .and_then(|v| v.as_str())
        .map(String::from);
    let enabled = *state.privacy_enabled.read();
    let privacy = state.privacy.clone();
    let app2 = app.clone();
    let sid = session_id.clone();
    let llm = state.llm.clone();

    // 把消息在发往 LLM 前过隐私脱敏 (若启用)。
    let messages = if enabled {
        let eng = privacy.read();
        params
            .messages
            .iter()
            .map(|m| crate::services::llm_service::ChatMessage {
                role: m.role.clone(),
                content: eng.anonymize(&m.content),
            })
            .collect::<Vec<_>>()
    } else {
        params.messages.clone()
    };
    let params2 = ChatParams {
        provider_id: params.provider_id,
        model_id: params.model_id,
        messages,
        system_prompt: params.system_prompt,
        thinking: params.thinking,
        max_tokens: params.max_tokens,
    };

    tokio::spawn(async move {
        let app3 = app2.clone();
        // 流开始: 前端 chatStore 据此新建 assistant 消息气泡
        let _ = broadcaster::emit_all(
            &app3,
            events::AI_CHAT_STREAM,
            StreamEvent::Start {
                model: params2.model_id.clone(),
                provider: params2.provider_id.clone(),
            },
        );
        let _ = broadcaster::emit_all(
            &app3.clone(),
            events::AI_CHAT_STREAM,
            StreamEvent::TextStart,
        );
        let on_event = move |ev: StreamEvent| {
            let _ = broadcaster::emit_all(&app3, events::AI_CHAT_STREAM, &ev);
        };
        let result = llm
            .stream_chat(&params2, &api_key, base_url.as_deref(), on_event, cancel)
            .await;
        // 正文结束: 前端据此 saveMessage 持久化
        let _ = broadcaster::emit_all(&app2, events::AI_CHAT_STREAM, StreamEvent::TextEnd);
        if let Err(e) = result {
            let _ = broadcaster::emit_all(
                &app2,
                events::AI_CHAT_STREAM,
                StreamEvent::Error {
                    message: e.to_string(),
                    retryable: false,
                },
            );
        }
    });

    Ok(json!({ "success": true, "message": "streaming started", "sessionId": sid }))
}

#[tauri::command]
pub async fn ai_chat_abort(state: State<'_, AppState>) -> Result<Value> {
    // 取消所有进行中的流 (前端单连接, 简化处理)
    let mut streams = state.active_streams.lock().await;
    let n = streams.len();
    for (_, token) in streams.drain() {
        token.cancel();
    }
    Ok(json!({ "success": true, "aborted": n }))
}
