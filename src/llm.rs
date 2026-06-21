//! LLM client with streaming support.
//!
//! Supports OpenAI-compatible chat completions (`OpenAI`, `OpenRouter`, Ollama,
//! LM Studio, vLLM, any OpenAI-API server) and Anthropic messages streaming.
//! The client is fully async and runs on the background runtime; tokens are
//! delivered to the UI via channels, so the render loop never blocks.

use anyhow::{anyhow, Context, Result};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::models::{LlmProvider, ProviderKind, ProviderPreset, Role};

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

impl ChatMessage {
    pub fn system(s: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: s.into(),
        }
    }
    pub fn user(s: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: s.into(),
        }
    }
    pub fn assistant(s: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: s.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LlmRequest {
    pub provider: LlmProvider,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub max_tokens: u32,
}

/// A decoded API key (decrypted) ready for use in a request.
pub fn resolve_key(provider: &LlmProvider, cipher: &crate::privacy::Cipher) -> Option<String> {
    provider.api_key.as_ref().and_then(|k| {
        if let Some(rest) = k.strip_prefix("enc:") {
            cipher.decrypt_str(rest).ok()
        } else if k.is_empty() {
            None
        } else {
            Some(k.clone())
        }
    })
}

pub struct LlmClient {
    http: reqwest::Client,
}

impl LlmClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { http }
    }

    /// Borrow the underlying `reqwest::Client` so other modules (e.g. the
    /// `web_search` / `web_fetch` tools) can share the same connection pool
    /// and rustls stack. Cheap to clone (internally `Arc`-wrapped).
    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    /// Consume self and yield the inner client. Used by tool code that
    /// wants an owned `reqwest::Client` without going through the LLM.
    pub fn into_http(self) -> reqwest::Client {
        self.http
    }

    /// Stream a completion, invoking `on_token` for each text delta. Returns
    /// the full concatenated text when the stream ends.
    pub async fn stream(
        &self,
        req: &LlmRequest,
        cipher: &crate::privacy::Cipher,
        on_token: &mut (dyn FnMut(&str) + Send),
    ) -> Result<String> {
        match req.provider.kind {
            ProviderKind::Anthropic => self.stream_anthropic(req, cipher, on_token).await,
            _ => self.stream_openai(req, cipher, on_token).await,
        }
    }

    async fn stream_openai(
        &self,
        req: &LlmRequest,
        cipher: &crate::privacy::Cipher,
        on_token: &mut (dyn FnMut(&str) + Send),
    ) -> Result<String> {
        let base = req.provider.base_url.trim_end_matches('/');
        let url = format!("{base}/v1/chat/completions");
        let body = OpenAiBody {
            model: req.provider.model.clone(),
            messages: req
                .messages
                .iter()
                .map(|m| OpenAiMsg {
                    role: match m.role {
                        Role::User => "user".into(),
                        Role::Assistant => "assistant".into(),
                        Role::Tool => "tool".into(),
                        Role::System => "system".into(),
                    },
                    content: m.content.clone(),
                })
                .collect(),
            temperature: req.temperature,
            max_tokens: req.max_tokens,
            stream: true,
        };
        let mut request = self
            .http
            .post(&url)
            .json(&body)
            .header("Content-Type", "application/json");
        if let Some(key) = resolve_key(&req.provider, cipher) {
            request = request.bearer_auth(key);
        }
        let response = request.send().await.context("LLM request failed")?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "LLM error {status}: {}",
                crate::util::truncate(&text, 300)
            ));
        }
        let mut stream = response.bytes_stream();
        let mut full = String::new();
        let mut buf = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("stream read")?;
            buf.push_str(&String::from_utf8_lossy(&chunk));
            loop {
                let Some(line_end) = buf.find('\n') else {
                    break;
                };
                let line = buf[..line_end].trim().to_string();
                buf = buf[line_end + 1..].to_string();
                if let Some(data) = line.strip_prefix("data: ") {
                    if data == "[DONE]" {
                        continue;
                    }
                    if let Ok(parsed) = serde_json::from_str::<OpenAiStream>(data) {
                        if let Some(delta) = parsed
                            .choices
                            .first()
                            .and_then(|c| c.delta.content.as_deref())
                        {
                            if !delta.is_empty() {
                                on_token(delta);
                                full.push_str(delta);
                            }
                        }
                    }
                }
            }
        }
        Ok(full)
    }

    async fn stream_anthropic(
        &self,
        req: &LlmRequest,
        cipher: &crate::privacy::Cipher,
        on_token: &mut (dyn FnMut(&str) + Send),
    ) -> Result<String> {
        let base = req.provider.base_url.trim_end_matches('/');
        let url = format!("{base}/v1/messages");
        let mut system = String::new();
        let mut msgs = Vec::new();
        for m in &req.messages {
            match m.role {
                Role::System => {
                    if !system.is_empty() {
                        system.push('\n');
                    }
                    system.push_str(&m.content);
                }
                Role::User | Role::Tool => msgs.push(AnthropicMsg {
                    role: "user".into(),
                    content: m.content.clone(),
                }),
                Role::Assistant => msgs.push(AnthropicMsg {
                    role: "assistant".into(),
                    content: m.content.clone(),
                }),
            }
        }
        let body = AnthropicBody {
            model: req.provider.model.clone(),
            max_tokens: req.max_tokens,
            temperature: req.temperature,
            system: if system.is_empty() {
                None
            } else {
                Some(system)
            },
            messages: msgs,
            stream: true,
        };
        let key = resolve_key(&req.provider, cipher).unwrap_or_default();
        let response = self
            .http
            .post(&url)
            .json(&body)
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .context("Anthropic request failed")?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!(
                "Anthropic error {status}: {}",
                crate::util::truncate(&text, 300)
            ));
        }
        let mut stream = response.bytes_stream();
        let mut full = String::new();
        let mut buf = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("stream read")?;
            buf.push_str(&String::from_utf8_lossy(&chunk));
            loop {
                let Some(line_end) = buf.find('\n') else {
                    break;
                };
                let line = buf[..line_end].trim().to_string();
                buf = buf[line_end + 1..].to_string();
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(ev) = serde_json::from_str::<AnthropicEvent>(data) {
                        if ev.type_field == "content_block_delta" {
                            if let Some(delta) = ev.delta {
                                if delta.type_field == "text_delta" {
                                    if let Some(t) = delta.text {
                                        on_token(&t);
                                        full.push_str(&t);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(full)
    }
}

impl Default for LlmClient {
    fn default() -> Self {
        Self::new()
    }
}

// ---- OpenAI wire types ----
#[derive(Serialize)]
struct OpenAiBody {
    model: String,
    messages: Vec<OpenAiMsg>,
    temperature: f32,
    max_tokens: u32,
    stream: bool,
}
#[derive(Serialize)]
struct OpenAiMsg {
    role: String,
    content: String,
}
#[derive(Deserialize)]
struct OpenAiStream {
    #[serde(default)]
    choices: Vec<OpenAiChoice>,
}
#[derive(Deserialize)]
struct OpenAiChoice {
    #[serde(default)]
    delta: OpenAiDelta,
}
#[derive(Deserialize, Default)]
struct OpenAiDelta {
    #[serde(default)]
    content: Option<String>,
}

// ---- Anthropic wire types ----
#[derive(Serialize)]
struct AnthropicBody {
    model: String,
    max_tokens: u32,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
    messages: Vec<AnthropicMsg>,
    stream: bool,
}
#[derive(Serialize)]
struct AnthropicMsg {
    role: String,
    content: String,
}
#[derive(Deserialize)]
struct AnthropicEvent {
    #[serde(rename = "type")]
    type_field: String,
    #[serde(default)]
    delta: Option<AnthropicDelta>,
}
#[derive(Deserialize)]
struct AnthropicDelta {
    #[serde(rename = "type")]
    type_field: String,
    #[serde(default)]
    text: Option<String>,
}

/// 30+ built-in model presets across major providers.
pub fn provider_presets() -> Vec<ProviderPreset> {
    vec![
        // OpenAI
        ProviderPreset {
            name: "OpenAI GPT-4o".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.openai.com".into(),
            model: "gpt-4o".into(),
        },
        ProviderPreset {
            name: "OpenAI GPT-4o-mini".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.openai.com".into(),
            model: "gpt-4o-mini".into(),
        },
        ProviderPreset {
            name: "OpenAI o3-mini".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.openai.com".into(),
            model: "o3-mini".into(),
        },
        ProviderPreset {
            name: "OpenAI o1".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.openai.com".into(),
            model: "o1".into(),
        },
        // Anthropic
        ProviderPreset {
            name: "Anthropic Claude 3.5 Sonnet".into(),
            kind: ProviderKind::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            model: "claude-3-5-sonnet-20241022".into(),
        },
        ProviderPreset {
            name: "Anthropic Claude 3 Opus".into(),
            kind: ProviderKind::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            model: "claude-3-opus-20240229".into(),
        },
        ProviderPreset {
            name: "Anthropic Claude 3 Haiku".into(),
            kind: ProviderKind::Anthropic,
            base_url: "https://api.anthropic.com".into(),
            model: "claude-3-haiku-20240307".into(),
        },
        // Google Gemini
        ProviderPreset {
            name: "Gemini 2.0 Flash".into(),
            kind: ProviderKind::Gemini,
            base_url: "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            model: "gemini-2.0-flash-exp".into(),
        },
        ProviderPreset {
            name: "Gemini 1.5 Pro".into(),
            kind: ProviderKind::Gemini,
            base_url: "https://generativelanguage.googleapis.com/v1beta/openai".into(),
            model: "gemini-1.5-pro".into(),
        },
        // OpenRouter
        ProviderPreset {
            name: "OpenRouter GPT-4o".into(),
            kind: ProviderKind::OpenRouter,
            base_url: "https://openrouter.ai/api".into(),
            model: "openai/gpt-4o".into(),
        },
        ProviderPreset {
            name: "OpenRouter Claude 3.5 Sonnet".into(),
            kind: ProviderKind::OpenRouter,
            base_url: "https://openrouter.ai/api".into(),
            model: "anthropic/claude-3.5-sonnet".into(),
        },
        ProviderPreset {
            name: "OpenRouter DeepSeek V3".into(),
            kind: ProviderKind::OpenRouter,
            base_url: "https://openrouter.ai/api".into(),
            model: "deepseek/deepseek-chat".into(),
        },
        ProviderPreset {
            name: "OpenRouter Qwen 2.5 72B".into(),
            kind: ProviderKind::OpenRouter,
            base_url: "https://openrouter.ai/api".into(),
            model: "qwen/qwen-2.5-72b-instruct".into(),
        },
        ProviderPreset {
            name: "OpenRouter Llama 3.3 70B".into(),
            kind: ProviderKind::OpenRouter,
            base_url: "https://openrouter.ai/api".into(),
            model: "meta-llama/llama-3.3-70b-instruct".into(),
        },
        // Ollama (local)
        ProviderPreset {
            name: "Ollama qwen2.5".into(),
            kind: ProviderKind::Ollama,
            base_url: "http://localhost:11434".into(),
            model: "qwen2.5".into(),
        },
        ProviderPreset {
            name: "Ollama llama3.2".into(),
            kind: ProviderKind::Ollama,
            base_url: "http://localhost:11434".into(),
            model: "llama3.2".into(),
        },
        ProviderPreset {
            name: "Ollama deepseek-r1".into(),
            kind: ProviderKind::Ollama,
            base_url: "http://localhost:11434".into(),
            model: "deepseek-r1".into(),
        },
        ProviderPreset {
            name: "Ollama gemma2".into(),
            kind: ProviderKind::Ollama,
            base_url: "http://localhost:11434".into(),
            model: "gemma2".into(),
        },
        // Alibaba DashScope
        ProviderPreset {
            name: "DashScope Qwen-Max".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://dashscope.aliyuncs.com/compatible-mode".into(),
            model: "qwen-max".into(),
        },
        ProviderPreset {
            name: "DashScope Qwen-Plus".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://dashscope.aliyuncs.com/compatible-mode".into(),
            model: "qwen-plus".into(),
        },
        ProviderPreset {
            name: "DashScope Qwen-Turbo".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://dashscope.aliyuncs.com/compatible-mode".into(),
            model: "qwen-turbo".into(),
        },
        // DeepSeek
        ProviderPreset {
            name: "DeepSeek V3".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-chat".into(),
        },
        ProviderPreset {
            name: "DeepSeek R1".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.deepseek.com".into(),
            model: "deepseek-reasoner".into(),
        },
        // Zhipu
        ProviderPreset {
            name: "Zhipu GLM-4".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://open.bigmodel.cn/api/paas/v4".into(),
            model: "glm-4".into(),
        },
        ProviderPreset {
            name: "Zhipu GLM-4-Flash".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://open.bigmodel.cn/api/paas/v4".into(),
            model: "glm-4-flash".into(),
        },
        // Moonshot
        ProviderPreset {
            name: "Moonshot Kimi K2".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.moonshot.cn/v1".into(),
            model: "kimi-k2-0711-preview".into(),
        },
        ProviderPreset {
            name: "Moonshot Kimi K1.5".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.moonshot.cn/v1".into(),
            model: "kimi-k1.5".into(),
        },
        // SiliconFlow
        ProviderPreset {
            name: "SiliconFlow Qwen2.5-72B".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.siliconflow.cn/v1".into(),
            model: "Qwen/Qwen2.5-72B-Instruct".into(),
        },
        ProviderPreset {
            name: "SiliconFlow DeepSeek V3".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.siliconflow.cn/v1".into(),
            model: "deepseek-ai/DeepSeek-V3".into(),
        },
        // 01.AI
        ProviderPreset {
            name: "01.AI Yi-Lightning".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.lingyiwanwu.com/v1".into(),
            model: "yi-lightning".into(),
        },
        // MiniMax
        ProviderPreset {
            name: "MiniMax abab6.5s".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.minimax.chat/v1".into(),
            model: "abab6.5s-chat".into(),
        },
        // Azure OpenAI
        ProviderPreset {
            name: "Azure OpenAI GPT-4o".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT"
                .into(),
            model: "gpt-4o".into(),
        },
        // Groq
        ProviderPreset {
            name: "Groq Llama 3.3 70B".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.groq.com/openai/v1".into(),
            model: "llama-3.3-70b-versatile".into(),
        },
        ProviderPreset {
            name: "Groq Mixtral 8x7B".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.groq.com/openai/v1".into(),
            model: "mixtral-8x7b-32768".into(),
        },
        // Cohere
        ProviderPreset {
            name: "Cohere Command R+".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.cohere.ai/v1".into(),
            model: "command-r-plus".into(),
        },
        // Mistral
        ProviderPreset {
            name: "Mistral Large".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.mistral.ai/v1".into(),
            model: "mistral-large-latest".into(),
        },
        // Together AI
        ProviderPreset {
            name: "Together DeepSeek R1".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.together.xyz/v1".into(),
            model: "deepseek-ai/DeepSeek-R1".into(),
        },
        // Perplexity
        ProviderPreset {
            name: "Perplexity Sonar".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.perplexity.ai".into(),
            model: "sonar".into(),
        },
        // Fireworks
        ProviderPreset {
            name: "Fireworks Llama 3.3 70B".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.fireworks.ai/inference/v1".into(),
            model: "accounts/fireworks/models/llama-v3p3-70b-instruct".into(),
        },
    ]
}
