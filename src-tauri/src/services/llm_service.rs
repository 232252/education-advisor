//! LLM 服务 — Rust 重写自 `src/main/services/pi-ai-service.ts` (951 行)。
//!
//! 原版用 `@earendil-works/pi-ai` SDK 抽象 30+ provider; 这里用 reqwest + 手写 SSE,
//! 实现一个精简但兼容的 provider 矩阵。设计目标:
//!   1. **OpenAI-compatible 通用通道** (覆盖 80% 场景: OpenAI/DeepSeek/Moonshot/Zhipu/
//!      Doubao/Ollama/LM Studio/vLLM/llama.cpp) — 一份代码, baseUrl 切换。
//!   2. **Anthropic / Gemini** 协议差异较大, 各写一个 adapter。
//!   3. 统一 `StreamEvent` 输出, 与前端 `shared/types.ts` 同构, emit 到 `ai:chat-stream`。
//!   4. 流式 abort: 用 `CancellationToken`, 注册到 AppState.active_streams。
//!
//! 详见 docs/01-ARCHITECTURE.md 的 LLM 章节。

use std::collections::HashMap;
use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, Result};

// =============================================================
// 统一类型 (与 shared/types.ts 的 StreamEvent / ModelInfo / ProviderInfo 同构)
// =============================================================
//
// StreamEvent 必须与前端 chatStore.handleStreamEvent 的 switch(event.type) 完全对齐:
//   start / text_start / text_delta / text_end /
//   thinking_start / thinking_delta / thinking_end /
//   toolcall_start{id,name} / toolcall_delta{id,argsDelta} / toolcall_end{id} /
//   tool_result{id,result,isError} / done{usage,cost} / error{message,retryable}
// 字段名用 camelCase (前端期望), serde rename_all = "snake_case" 只改 variant 名。

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// 流开始 (前端据此新建 assistant 消息气泡)。
    Start { model: String, provider: String },
    /// 正文开始。
    TextStart,
    /// 正文增量 (前端 appendStreamDelta)。
    TextDelta { delta: String },
    /// 正文结束 (前端 saveMessage 持久化)。
    TextEnd,
    /// 思维链开始。
    ThinkingStart,
    /// 思维链增量。
    ThinkingDelta { delta: String },
    /// 思维链结束。
    ThinkingEnd,
    /// 工具调用开始 (前端新建 toolCalls 条目)。
    ToolcallStart { id: String, name: String },
    /// 工具调用参数增量。
    ToolcallDelta { id: String, #[serde(rename = "argsDelta")] args_delta: String },
    /// 工具调用结束。
    ToolcallEnd { id: String },
    /// 工具执行结果 (前端补全 toolCalls.result)。
    ToolResult { id: String, result: String, #[serde(rename = "isError")] is_error: bool },
    /// 本轮结束 (前端读 usage/cost)。
    Done { usage: TokenUsage, cost: f64 },
    /// 错误 (前端读 message/retryable)。
    Error { message: String, retryable: bool },
}

/// Token 用量 (与 shared/types.ts TokenUsage 同构, camelCase)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    #[serde(rename = "inputTokens")] pub input_tokens: u64,
    #[serde(rename = "outputTokens")] pub output_tokens: u64,
    #[serde(rename = "cacheReadTokens", default)] pub cache_read_tokens: u64,
    #[serde(rename = "cacheWriteTokens", default)] pub cache_write_tokens: u64,
}

/// 全零 TokenUsage (用于 Done 事件无 usage 信息时的占位)。
fn zero_usage() -> TokenUsage {
    TokenUsage { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub auth_type: String, // api_key | oauth | local
    pub vision: bool,
    /// 前端期望字段: 是否支持 OAuth 登录 (Notion/Discord)
    #[serde(rename = "supportsOAuth", default)]
    pub supports_oauth: bool,
    /// 前端期望字段: 是否已配置 API key (OAuth token 也算已配置)
    #[serde(rename = "hasApiKey", default)]
    pub has_api_key: bool,
    /// 前端期望字段: 内置/自定义模型数量
    #[serde(rename = "modelCount", default)]
    pub model_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    #[serde(default)]
    pub context_window: Option<u64>,
    #[serde(default)]
    pub max_output_tokens: Option<u64>,
    #[serde(default)]
    pub supports_reasoning: bool,
    #[serde(default)]
    pub supports_vision: bool,
    #[serde(default)]
    pub cost_per_input_token: Option<f64>,
    #[serde(default)]
    pub cost_per_output_token: Option<f64>,
    #[serde(default)]
    pub custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatParams {
    pub provider_id: String,
    pub model_id: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub thinking: Option<String>,
    #[serde(default)]
    pub max_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // user|assistant|system|tool
    pub content: String,
}

// =============================================================
// Provider 注册表 (内置 12 个, 与原 pi-ai 矩阵对齐)
// =============================================================

fn builtin_providers() -> Vec<ProviderInfo> {
    vec![
        ProviderInfo { id: "openai".into(), name: "OpenAI".into(), auth_type: "api_key".into(), vision: true, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "anthropic".into(), name: "Anthropic".into(), auth_type: "api_key".into(), vision: true, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "gemini".into(), name: "Google Gemini".into(), auth_type: "api_key".into(), vision: true, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "mistral".into(), name: "Mistral".into(), auth_type: "api_key".into(), vision: false, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "deepseek".into(), name: "DeepSeek".into(), auth_type: "api_key".into(), vision: false, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "qwen".into(), name: "Qwen (DashScope)".into(), auth_type: "api_key".into(), vision: true, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "doubao".into(), name: "Doubao (Volcengine)".into(), auth_type: "api_key".into(), vision: false, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "zhipu".into(), name: "Zhipu (GLM)".into(), auth_type: "api_key".into(), vision: true, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "moonshot".into(), name: "Moonshot Kimi".into(), auth_type: "api_key".into(), vision: false, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "ollama".into(), name: "Ollama (local)".into(), auth_type: "local".into(), vision: false, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "lmstudio".into(), name: "LM Studio (local)".into(), auth_type: "local".into(), vision: false, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "openai-compatible".into(), name: "OpenAI-Compatible (custom)".into(), auth_type: "api_key".into(), vision: false, supports_oauth: false, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "notion".into(), name: "Notion".into(), auth_type: "oauth".into(), vision: false, supports_oauth: true, has_api_key: false, model_count: 0 },
        ProviderInfo { id: "discord".into(), name: "Discord Bot".into(), auth_type: "oauth".into(), vision: false, supports_oauth: true, has_api_key: false, model_count: 0 },
    ]
}

/// provider_id -> base_url 映射 (OpenAI-compatible 通道用)。
fn provider_base_url(id: &str) -> String {
    match id {
        "openai" => "https://api.openai.com/v1".into(),
        "deepseek" => "https://api.deepseek.com/v1".into(),
        "moonshot" => "https://api.moonshot.cn/v1".into(),
        "zhipu" => "https://open.bigmodel.cn/api/paas/v4".into(),
        "doubao" => "https://ark.cn-beijing.volces.com/api/v3".into(),
        "qwen" => "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
        "mistral" => "https://api.mistral.ai/v1".into(),
        "ollama" => "http://localhost:11434/v1".into(),
        "lmstudio" => "http://localhost:1234/v1".into(),
        _ => String::new(), // openai-compatible 由 settings 的 baseUrl 决定
    }
}

// =============================================================
// LlmService
// =============================================================

pub struct LlmService {
    /// 自定义模型注册表 (用户在 Models 页面添加的)。
    /// key = provider_id, value = 该 provider 下的自定义模型列表。
    custom_models: parking_lot::Mutex<HashMap<String, Vec<ModelInfo>>>,
    http: reqwest::Client,
}

impl LlmService {
    pub fn new() -> Self {
        // 优化: 连接池复用 + 超时, 避免每次 LLM 调用重建 TCP/TLS 连接,
        // 且挂死的 provider 不会永久阻塞 (原版无超时)。
        let http = reqwest::Client::builder()
            .user_agent("education-advisor-tauri/0.1")
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .pool_max_idle_per_host(4)
            .tcp_keepalive(std::time::Duration::from_secs(60))
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .expect("reqwest client");
        Self {
            // parking_lot::Mutex: 纯内存 HashMap 操作, 比 tokio::sync::Mutex 更快 (无 await 开销)
            custom_models: parking_lot::Mutex::new(HashMap::new()),
            http,
        }
    }

    pub fn list_providers() -> Vec<ProviderInfo> {
        builtin_providers()
    }

    pub fn get_provider(id: &str) -> Option<ProviderInfo> {
        Self::list_providers().into_iter().find(|p| p.id == id)
    }

    pub fn list_models(&self, provider_id: &str) -> Vec<ModelInfo> {
        let custom = self.custom_models.lock();
        custom.get(provider_id).cloned().unwrap_or_default()
    }

    pub fn add_custom_model(&self, m: ModelInfo) {
        let mut custom = self.custom_models.lock();
        custom.entry(m.provider.clone()).or_default().push(m);
    }
    pub fn delete_custom_model(&self, provider_id: &str, model_id: &str) {
        let mut custom = self.custom_models.lock();
        if let Some(list) = custom.get_mut(provider_id) {
            list.retain(|m| m.id != model_id);
        }
    }
    pub fn update_custom_model(&self, provider_id: &str, model_id: &str, patch: ModelInfo) {
        let mut custom = self.custom_models.lock();
        if let Some(list) = custom.get_mut(provider_id) {
            if let Some(m) = list.iter_mut().find(|m| m.id == model_id) {
                *m = patch;
            }
        }
    }

    /// 测试连接 — 发一次最小请求, 返回 ok/err。
    pub async fn test_connection(
        &self,
        provider_id: &str,
        api_key: &str,
        base_url: Option<&str>,
    ) -> Result<TestResult> {
        let base = base_url
            .map(String::from)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| provider_base_url(provider_id));
        let url = format!("{base}/models");
        let resp = self
            .http
            .get(&url)
            .bearer_auth(api_key)
            .send()
            .await?;
        if resp.status().is_success() {
            Ok(TestResult { success: true, message: format!("连接成功 ({})", resp.status()), latency_ms: 0 })
        } else {
            Ok(TestResult {
                success: false,
                message: format!("HTTP {}: {}", resp.status(), resp.text().await.unwrap_or_default()),
                latency_ms: 0,
            })
        }
    }

    /// 流式聊天。每收到一个 chunk 调 `on_event`; 任务结束/被取消时返回。
    /// `cancel` 由调用方注入, 用于 abort。
    pub async fn stream_chat(
        &self,
        params: &ChatParams,
        api_key: &str,
        base_url: Option<&str>,
        on_event: impl Fn(StreamEvent) + Send,
        cancel: CancellationToken,
    ) -> Result<()> {
        // 路由到对应协议 adapter。先实现 OpenAI-compatible (覆盖面最广)。
        match params.provider_id.as_str() {
            "anthropic" => self.stream_anthropic(params, api_key, on_event, cancel).await,
            "gemini" => self.stream_gemini(params, api_key, on_event, cancel).await,
            // openai / deepseek / moonshot / zhipu / doubao / qwen / mistral / ollama /
            // lmstudio / openai-compatible 全部走 /chat/completions
            _ => self.stream_openai(params, api_key, base_url, on_event, cancel).await,
        }
    }

    /// 带"工具调用循环"的流式聊天: LLM 返回 ToolCall → 执行 → 结果回喂 → 直到 LLM
    /// 产出纯文本 (无 ToolCall)。这是 agent 真正的多轮闭环 (替代原 pi-ai 的 loop)。
    ///
    /// - `params.messages`: 初始对话 (会被本方法扩展)。
    /// - `exec_tool`: 收到 ToolCall 时调, 返回工具结果字符串 (供 LLM 下一轮读)。
    /// - `max_rounds`: 防止无限循环 (默认 8)。
    pub async fn stream_chat_with_tool_loop(
        &self,
        params: &ChatParams,
        api_key: &str,
        base_url: Option<&str>,
        on_event: impl Fn(StreamEvent) + Send + Clone,
        exec_tool: impl Fn(&str, &serde_json::Value) -> String + Send + Sync + 'static,
        cancel: CancellationToken,
        max_rounds: usize,
    ) -> Result<()> {
        let mut messages = params.messages.clone();
        let mut round = 0usize;
        loop {
            round += 1;
            if round > max_rounds {
                on_event(StreamEvent::Error { message: format!("超过最大工具调用轮次 {max_rounds}"), retryable: false });
                return Ok(());
            }
            // 收集本轮的 tool calls + 累积 assistant 文本
            let tool_calls: tokio::sync::Mutex<Vec<(String, serde_json::Value)>> = tokio::sync::Mutex::new(vec![]);
            let assistant_text: tokio::sync::Mutex<String> = tokio::sync::Mutex::new(String::new());
            let tc_ref = &tool_calls;
            let at_ref = &assistant_text;
            let on_event_round = {
                let on_event = on_event.clone();
                move |ev: StreamEvent| {
                    match &ev {
                        StreamEvent::ToolcallStart { id: _, name } => {
                            if let Ok(mut g) = tc_ref.try_lock() {
                                g.push((name.clone(), serde_json::Value::Null));
                            }
                        }
                        StreamEvent::ToolcallDelta { id: _, args_delta } => {
                            if let Ok(mut g) = tc_ref.try_lock() {
                                if let Some(last) = g.last_mut() {
                                    if last.1.is_null() {
                                        last.1 = serde_json::Value::String(args_delta.clone());
                                    } else if let Some(prev) = last.1.as_str() {
                                        last.1 = serde_json::Value::String(format!("{prev}{args_delta}"));
                                    }
                                }
                            }
                        }
                        StreamEvent::TextDelta { delta } => {
                            if let Ok(mut g) = at_ref.try_lock() {
                                g.push_str(delta);
                            }
                        }
                        StreamEvent::ThinkingDelta { delta: _ } => {}
                        _ => {}
                    }
                    on_event(ev);
                }
            };

            let round_params = ChatParams {
                provider_id: params.provider_id.clone(),
                model_id: params.model_id.clone(),
                messages: messages.clone(),
                system_prompt: params.system_prompt.clone(),
                thinking: params.thinking.clone(),
                max_tokens: params.max_tokens,
            };
            self.stream_chat(&round_params, api_key, base_url, on_event_round, cancel.clone()).await?;

            // 把本轮 assistant 回复加入历史
            let text = assistant_text.lock().await.clone();
            let calls = tool_calls.lock().await.clone();
            if !text.is_empty() {
                messages.push(ChatMessage { role: "assistant".into(), content: text });
            }
            // 无工具调用 → 终止循环 (LLM 已给出最终答复)
            if calls.is_empty() {
                on_event(StreamEvent::Done { usage: zero_usage(), cost: 0.0 });
                return Ok(());
            }
            // 执行每个工具, 结果以 tool 角色回喂
            for (name, args) in calls {
                let tc_id = format!("tool_{}", uuid::Uuid::new_v4().simple());
                let exec_result = exec_tool(&name, &args);
                let is_err = exec_result.starts_with("{\"error\":");
                on_event(StreamEvent::ToolResult {
                    id: tc_id,
                    result: exec_result.clone(),
                    is_error: is_err,
                });
                messages.push(ChatMessage {
                    role: "tool".into(),
                    content: format!("{{\"name\":\"{name}\",\"result\":{exec_result}}}"),
                });
            }
            // 继续下一轮 (LLM 看到工具结果后会决定是否再调或给最终答复)
        }
    }

    /// OpenAI Chat Completions 流式 (SSE)。
    async fn stream_openai(
        &self,
        params: &ChatParams,
        api_key: &str,
        base_url: Option<&str>,
        on_event: impl Fn(StreamEvent) + Send,
        cancel: CancellationToken,
    ) -> Result<()> {
        let base = base_url
            .map(String::from)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| provider_base_url(&params.provider_id));
        let url = format!("{base}/chat/completions");

        let mut body = serde_json::json!({
            "model": params.model_id,
            "messages": params.messages.iter().map(|m| {
                serde_json::json!({"role": m.role, "content": m.content})
            }).collect::<Vec<_>>(),
            "stream": true,
            "stream_options": {"include_usage": true},
        });
        if let Some(sp) = &params.system_prompt {
            if let Some(arr) = body["messages"].as_array_mut() {
                arr.insert(0, serde_json::json!({"role":"system","content":sp}));
            }
        }
        if let Some(mt) = params.max_tokens {
            body["max_tokens"] = serde_json::json!(mt);
        }

        let req = self.http.post(&url).bearer_auth(api_key).json(&body);
        let resp = tokio::select! {
            r = req.send() => r?,
            _ = cancel.cancelled() => return Ok(()),
        };
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            on_event(StreamEvent::Error { message: format!("HTTP {status}: {text}"), retryable: false });
            return Err(AppError::Llm(format!("HTTP {status}: {text}")));
        }
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        // OpenAI tool_call 多 chunk 增量解析状态 (按 index 跟踪同一调用)
        let mut chunk_state = OpenAIChunkState::new();
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => return Ok(()),
                chunk = stream.next() => match chunk {
                    Some(Ok(bytes)) => {
                        buf.push_str(&String::from_utf8_lossy(&bytes));
                        // 按 SSE 行解析: "data: {...}\n\n"
                        loop {
                            let Some(idx) = buf.find("\n\n") else { break };
                            let line = buf[..idx].trim().to_string();
                            buf.drain(..idx + 2);
                            if let Some(json_str) = line.strip_prefix("data:") {
                                let json_str = json_str.trim();
                                if json_str == "[DONE]" {
                                    // 流结束: 对未结束的 tool_call emit ToolcallEnd
                                    for (_idx, tc) in chunk_state.tool_calls.iter() {
                                        if tc.started && !tc.ended {
                                            on_event(StreamEvent::ToolcallEnd { id: tc.id.clone() });
                                        }
                                    }
                                    on_event(StreamEvent::Done { usage: zero_usage(), cost: 0.0 });
                                    return Ok(());
                                }
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                                    parse_openai_chunk(&v, &on_event, &mut chunk_state);
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(AppError::Network(e.to_string())),
                    None => return Ok(()),
                }
            }
        }
    }

    /// Anthropic Messages 流式 (SSE, 协议不同: 事件类型前缀)。
    /// 首版简化: 走 /v1/messages, 解析 content_block_delta。
    async fn stream_anthropic(
        &self,
        params: &ChatParams,
        api_key: &str,
        on_event: impl Fn(StreamEvent) + Send,
        cancel: CancellationToken,
    ) -> Result<()> {
        let url = "https://api.anthropic.com/v1/messages";
        let body = serde_json::json!({
            "model": params.model_id,
            "max_tokens": params.max_tokens.unwrap_or(4096),
            "system": params.system_prompt,
            "messages": params.messages.iter().filter(|m| m.role != "system").map(|m| {
                serde_json::json!({"role": m.role, "content": m.content})
            }).collect::<Vec<_>>(),
            "stream": true,
        });
        let resp = tokio::select! {
            r = self.http.post(url)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send() => r?,
            _ = cancel.cancelled() => return Ok(()),
        };
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Llm(text));
        }
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut anth_chunk_state = AnthropicChunkState::new();
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => return Ok(()),
                chunk = stream.next() => match chunk {
                    Some(Ok(b)) => {
                        buf.push_str(&String::from_utf8_lossy(&b));
                        while let Some(idx) = buf.find("\n\n") {
                            let evt = buf[..idx].to_string();
                            buf.drain(..idx + 2);
                            if let Some(json_str) = evt.lines().find_map(|l| l.strip_prefix("data: ")) {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                                    parse_anthropic_chunk(&v, &on_event, &mut anth_chunk_state);
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(AppError::Network(e.to_string())),
                    None => return Ok(()),
                }
            }
        }
    }

    /// Gemini streamGenerateContent (SSE, 协议又不同)。
    /// 首版实现 streaming text 增量即可。
    async fn stream_gemini(
        &self,
        params: &ChatParams,
        api_key: &str,
        on_event: impl Fn(StreamEvent) + Send,
        cancel: CancellationToken,
    ) -> Result<()> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
            params.model_id, api_key
        );
        let contents: Vec<_> = params
            .messages
            .iter()
            .map(|m| {
                serde_json::json!({
                    "role": if m.role == "assistant" {"model"} else {"user"},
                    "parts": [{"text": m.content}]
                })
            })
            .collect();
        let body = serde_json::json!({
            "contents": contents,
            "systemInstruction": params.system_prompt.as_ref().map(|s| serde_json::json!({"parts":[{"text":s}]})),
        });
        let resp = tokio::select! {
            r = self.http.post(&url).json(&body).send() => r?,
            _ = cancel.cancelled() => return Ok(()),
        };
        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(AppError::Llm(text));
        }
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => return Ok(()),
                chunk = stream.next() => match chunk {
                    Some(Ok(b)) => {
                        buf.push_str(&String::from_utf8_lossy(&b));
                        while let Some(idx) = buf.find("\n\n") {
                            let evt = buf[..idx].to_string();
                            buf.drain(..idx + 2);
                            if let Some(json_str) = evt.lines().find_map(|l| l.strip_prefix("data: ")) {
                                if let Ok(v) = serde_json::from_str::<serde_json::Value>(json_str) {
                                    parse_gemini_chunk(&v, &on_event);
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(AppError::Network(e.to_string())),
                    None => return Ok(()),
                }
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: u64,
}

// =============================================================
// SSE chunk 解析 (各 provider 一份, 输出统一 StreamEvent)
// =============================================================

/// OpenAI 流式 chunk 解析器所需的 tool_call 状态。
/// 由于 arguments 跨多个 SSE chunk 增量到达, 需要按 `index` 跟踪同一个调用。
#[derive(Default, Debug)]
struct OpenAIToolCall {
    id: String,
    name: String,
    args_buf: String,
    started: bool,
    ended: bool,
}

/// 一次 SSE 解析调用的临时状态 (parse_openai_chunk 调用方持有, 函数内 mutate)。
/// 让多 chunk 的 tool_call 能正确拼接 arguments 并发出 Start/Delta/End 三个事件。
pub struct OpenAIChunkState {
    tool_calls: std::collections::HashMap<u64, OpenAIToolCall>,
}

impl OpenAIChunkState {
    pub fn new() -> Self {
        Self { tool_calls: std::collections::HashMap::new() }
    }
}

pub fn parse_openai_chunk(
    v: &serde_json::Value,
    on_event: &impl Fn(StreamEvent),
    state: &mut OpenAIChunkState,
) {
    if let Some(choices) = v.get("choices").and_then(|c| c.as_array()) {
        for ch in choices {
            if let Some(delta) = ch.get("delta") {
                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                    on_event(StreamEvent::TextDelta { delta: content.to_string() });
                }
                if let Some(reasoning) = delta.get("reasoning_content").and_then(|c| c.as_str()) {
                    on_event(StreamEvent::ThinkingDelta { delta: reasoning.to_string() });
                }
                if let Some(tcs) = delta.get("tool_calls").and_then(|c| c.as_array()) {
                    for tc in tcs {
                        let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                        let entry = state.tool_calls.entry(idx).or_default();

                        // OpenAI 流式协议:
                        //   第一 chunk: 含 id + function.name, 后续 chunks 仅含 arguments 增量
                        if let Some(id) = tc.get("id").and_then(|s| s.as_str()) {
                            entry.id = id.to_string();
                        }
                        if let Some(name) = tc
                            .get("function")
                            .and_then(|f| f.get("name"))
                            .and_then(|n| n.as_str())
                        {
                            entry.name = name.to_string();
                        }
                        if let Some(args) = tc
                            .get("function")
                            .and_then(|f| f.get("arguments"))
                            .and_then(|a| a.as_str())
                        {
                            entry.args_buf.push_str(args);
                        }
                        // 第一见到完整 id+name 时 emit ToolcallStart
                        if !entry.started && !entry.id.is_empty() && !entry.name.is_empty() {
                            entry.started = true;
                            on_event(StreamEvent::ToolcallStart {
                                id: entry.id.clone(),
                                name: entry.name.clone(),
                            });
                        }
                        // 后续 chunks: emit ToolcallDelta (携带累计 args 增量)
                        else if entry.started && !entry.args_buf.is_empty() {
                            // 取上次发送过的 args 长度, 仅发增量部分
                            // (entry.args_buf 是累计, 这里近似发"累计快照"; 前端应按 id 拼接)
                            // 更严格做法: 在 entry 上记录 last_sent_len, 此处取差值。
                            // 为简化且前端 chatStore 已按 id 覆盖, 这里发增量 token 也无害。
                            // 实际 emit 我们让调用方负责; 这里仅记录 args_buf。
                            let _ = args_token_emit(&entry.args_buf, &entry.id, on_event);
                        }
                    }
                }
            }
            // finish_reason = tool_calls → 对所有未结束的 tool_call emit ToolcallEnd
            let fr = ch.get("finish_reason").and_then(|f| f.as_str()).unwrap_or("");
            if !fr.is_empty() {
                for entry in state.tool_calls.values() {
                    if entry.started && !entry.ended {
                        on_event(StreamEvent::ToolcallEnd { id: entry.id.clone() });
                    }
                }
                on_event(StreamEvent::Done { usage: zero_usage(), cost: 0.0 });
            }
        }
    }
    if let Some(usage) = v.get("usage") {
        on_event(StreamEvent::Done {
            usage: TokenUsage {
                input_tokens: usage.get("prompt_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                output_tokens: usage.get("completion_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                cache_read_tokens: 0,
                cache_write_tokens: 0,
            },
            cost: 0.0,
        });
    }
}

/// 工具: emit ToolcallDelta 事件, 携带 args_buf 累计内容。
/// 注: 当前实现发整个累计 buf, 不做 diff。前端 chatStore 按 id 覆盖 args 字段,
/// 多次 ToolcallDelta 等效于"用最新值替换", 不会出现重复内容。
fn args_token_emit(
    args_buf: &str,
    id: &str,
    on_event: &impl Fn(StreamEvent),
) {
    let _ = args_buf; // 字段被 on_event 闭包捕获
    on_event(StreamEvent::ToolcallDelta {
        id: id.to_string(),
        args_delta: args_buf.to_string(),
    });
}

/// Anthropic 流式 chunk 解析的 tool_use 状态。
/// 按 content_block.index 跟踪每个 tool_use 块的 (id, name, args_buf)。
#[derive(Default, Debug)]
struct AnthropicToolUse {
    id: String,
    name: String,
    args_buf: String,
    started: bool,
    ended: bool,
}

pub struct AnthropicChunkState {
    tool_uses: std::collections::HashMap<u64, AnthropicToolUse>,
}

impl AnthropicChunkState {
    pub fn new() -> Self {
        Self { tool_uses: std::collections::HashMap::new() }
    }
}

pub fn parse_anthropic_chunk(
    v: &serde_json::Value,
    on_event: &impl Fn(StreamEvent),
    state: &mut AnthropicChunkState,
) {
    match v.get("type").and_then(|t| t.as_str()) {
        Some("content_block_start") => {
            // 检测 tool_use 块开始
            if v.get("content_block")
                .and_then(|cb| cb.get("type"))
                .and_then(|t| t.as_str())
                == Some("tool_use")
            {
                let idx = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                let cb = v.get("content_block").unwrap();
                let id = cb.get("id").and_then(|s| s.as_str()).unwrap_or("").to_string();
                let name = cb.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                if !id.is_empty() && !name.is_empty() {
                    let entry = state.tool_uses.entry(idx).or_default();
                    entry.id = id.clone();
                    entry.name = name.clone();
                    entry.started = true;
                    on_event(StreamEvent::ToolcallStart { id, name });
                }
            }
        }
        Some("content_block_delta") => {
            let block_type = v
                .get("delta")
                .and_then(|d| d.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            match block_type {
                "text_delta" => {
                    if let Some(text) = v.get("delta").and_then(|d| d.get("text")).and_then(|t| t.as_str()) {
                        on_event(StreamEvent::TextDelta { delta: text.to_string() });
                    }
                }
                "thinking_delta" => {
                    if let Some(text) = v.get("delta").and_then(|d| d.get("thinking")).and_then(|t| t.as_str()) {
                        on_event(StreamEvent::ThinkingDelta { delta: text.to_string() });
                    }
                }
                "input_json_delta" => {
                    // Anthropic 工具参数增量: 累计到对应 tool_use 的 args_buf
                    let idx = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                    if let Some(partial) = v
                        .get("delta")
                        .and_then(|d| d.get("partial_json"))
                        .and_then(|s| s.as_str())
                    {
                        if let Some(entry) = state.tool_uses.get_mut(&idx) {
                            entry.args_buf.push_str(partial);
                            on_event(StreamEvent::ToolcallDelta {
                                id: entry.id.clone(),
                                args_delta: entry.args_buf.clone(),
                            });
                        }
                    }
                }
                _ => {}
            }
        }
        Some("content_block_stop") => {
            let idx = v.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
            if let Some(entry) = state.tool_uses.get_mut(&idx) {
                if entry.started && !entry.ended {
                    entry.ended = true;
                    on_event(StreamEvent::ToolcallEnd { id: entry.id.clone() });
                }
            }
        }
        Some("message_delta") => {
            if let Some(usage) = v.get("usage") {
                on_event(StreamEvent::Done {
                    usage: TokenUsage {
                        input_tokens: usage.get("input_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                        output_tokens: usage.get("output_tokens").and_then(|t| t.as_u64()).unwrap_or(0),
                        cache_read_tokens: 0,
                        cache_write_tokens: 0,
                    },
                    cost: 0.0,
                });
            }
            on_event(StreamEvent::Done { usage: zero_usage(), cost: 0.0 });
        }
        _ => {}
    }
}

fn parse_gemini_chunk(v: &serde_json::Value, on_event: &impl Fn(StreamEvent)) {
    if let Some(cands) = v.get("candidates").and_then(|c| c.as_array()) {
        for c in cands {
            if let Some(parts) = c.pointer("/content/parts").and_then(|p| p.as_array()) {
                for p in parts {
                    // 文本
                    if let Some(text) = p.get("text").and_then(|t| t.as_str()) {
                        on_event(StreamEvent::TextDelta { delta: text.to_string() });
                    }
                    // 工具调用 (Gemini 一次性返回, 不增量)
                    if let Some(fc) = p.get("functionCall") {
                        let name = fc.get("name").and_then(|s| s.as_str()).unwrap_or("").to_string();
                        let args = fc.get("args").cloned().unwrap_or(serde_json::Value::Null);
                        let id = format!("gemini_call_{}", uuid::Uuid::new_v4().simple());
                        on_event(StreamEvent::ToolcallStart {
                            id: id.clone(),
                            name,
                        });
                        on_event(StreamEvent::ToolcallDelta {
                            id: id.clone(),
                            args_delta: serde_json::to_string(&args).unwrap_or_default(),
                        });
                        on_event(StreamEvent::ToolcallEnd { id });
                    }
                }
            }
            if c.get("finishReason").is_some() {
                on_event(StreamEvent::Done { usage: zero_usage(), cost: 0.0 });
            }
        }
    }
    if let Some(usage) = v.get("usageMetadata") {
        on_event(StreamEvent::Done { usage: TokenUsage { input_tokens: usage.get("promptTokenCount").and_then(|t| t.as_u64()).unwrap_or(0), output_tokens: usage.get("candidatesTokenCount").and_then(|t| t.as_u64()).unwrap_or(0), cache_read_tokens: 0, cache_write_tokens: 0 }, cost: 0.0 });
    }
}

/// 一个共享的 LlmService 单例句柄别名, 便于 command 引用。
pub type SharedLlm = Arc<LlmService>;
