//! Chat commands — 对话持久化 IPC (4 个通道, `chat:*`)。

use serde_json::Value;
use tauri::State;

use crate::error::Result;
use crate::services::db::ChatMessageRecord;
use crate::state::AppState;

/// 前端 chat.saveMessage 用 camelCase (sessionId/toolCalls/tokenInput/tokenOutput),
/// 用 serde rename_all 对齐, 避免反序列化失败。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMsgArgs {
    #[serde(default)]
    pub session_id: Option<String>,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<String>,
    pub timestamp: i64,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub token_input: Option<i64>,
    #[serde(default)]
    pub token_output: Option<i64>,
    #[serde(default)]
    pub cost: Option<f64>,
}

#[tauri::command]
pub async fn chat_save_message(state: State<'_, AppState>, msg: SaveMsgArgs) -> Result<Value> {
    let rec = ChatMessageRecord {
        id: None,
        session_id: msg.session_id.unwrap_or_else(|| "default".into()),
        role: msg.role,
        content: msg.content,
        thinking: msg.thinking,
        tool_calls: msg.tool_calls,
        timestamp: msg.timestamp,
        provider: msg.provider,
        model: msg.model,
        token_input: msg.token_input,
        token_output: msg.token_output,
        cost: msg.cost,
    };
    let id = state.db.lock().await.save_message(&rec).await?;
    Ok(serde_json::json!({ "success": true, "id": id }))
}

#[tauri::command]
pub async fn chat_load_messages(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<Value> {
    let messages = state
        .db
        .lock()
        .await
        .load_messages(session_id.as_deref())
        .await?;
    Ok(serde_json::json!({ "success": true, "messages": messages }))
}

#[tauri::command]
pub async fn chat_delete_session(state: State<'_, AppState>, session_id: String) -> Result<Value> {
    state.db.lock().await.delete_session(&session_id).await?;
    Ok(serde_json::json!({ "success": true }))
}

#[tauri::command]
pub async fn chat_list_sessions(state: State<'_, AppState>) -> Result<Value> {
    let sessions = state.db.lock().await.list_sessions().await?;
    let out: Vec<Value> = sessions
        .into_iter()
        .map(|s| {
            serde_json::json!({
                "id": s.id, "title": s.title, "createdAt": s.created_at, "messageCount": s.message_count
            })
        })
        .collect();
    Ok(serde_json::json!({ "success": true, "sessions": out }))
}
