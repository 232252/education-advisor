//! OAuth 流程编排 — Notion + Discord。
//!
//! 设计:
//!   - `OAuthFlow` 持有 state → (provider, code_verifier, created_at) 的映射 (5min TTL)
//!   - `start_flow(provider, client_id)` 生成 PKCE code_verifier + state, 返回 authorize URL
//!   - `exchange(provider, code, state, client_id, client_secret)` POST token endpoint,
//!     校验 state 在 Map 中, 然后拿到 access_token
//!   - 5min 内的 stale 请求 → 失败 (CSRF + 重放防护)
//!
//! Notion 特殊: 不需要 client_secret (公开 OAuth client), 用 PKCE 替代;
//! Discord 必需 client_secret, 不强制 PKCE (本实现仍生成以备未来需要)。
//!
//! 失败的兼容: keystore 没有 access_token → 写入 keystore, 后续 ai_chat 用此 token 作为 API key。

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::error::{AppError, Result};

/// 支持的 OAuth provider
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OAuthProvider {
    Notion,
    Discord,
}

impl OAuthProvider {
    pub fn from_id(s: &str) -> Option<Self> {
        match s {
            "notion" => Some(Self::Notion),
            "discord" => Some(Self::Discord),
            _ => None,
        }
    }
    pub fn id(&self) -> &'static str {
        match self {
            Self::Notion => "notion",
            Self::Discord => "discord",
        }
    }
}

/// 内部维护的 flow 状态
struct FlowState {
    provider: OAuthProvider,
    code_verifier: String,
    /// client_id 用于 token endpoint 验证 (不存 client_secret, secret 每次 exchange 现取)
    client_id: String,
    created_at: Instant,
}

/// OAuth 流程编排器 (单例, 由 AppState 持有)
pub struct OAuthFlow {
    states: Mutex<HashMap<String, FlowState>>,
}

impl OAuthFlow {
    pub fn new() -> Self {
        Self { states: Mutex::new(HashMap::new()) }
    }

    /// 启动 flow: 生成 state + PKCE verifier, 存进 Map, 返回 (authorize_url, state)。
    pub fn start_flow(
        &self,
        provider: OAuthProvider,
        client_id: &str,
    ) -> Result<(String, String)> {
        if client_id.is_empty() {
            return Err(AppError::Config(format!("OAuth client_id 未配置 ({})", provider.id())));
        }
        let state = random_token(32);
        let code_verifier = random_token(64); // 43~128 chars
        let code_challenge = pkce_challenge(&code_verifier);

        let redirect = "educationadvisor%3A%2F%2Foauth%2Fcallback";
        let authorize_url = match provider {
            OAuthProvider::Notion => format!(
                "https://api.notion.com/v1/oauth/authorize\
                ?client_id={client_id}\
                &response_type=code\
                &owner=user\
                &redirect_uri={redirect}\
                &code_challenge={code_challenge}\
                &code_challenge_method=S256\
                &state={state}"
            ),
            OAuthProvider::Discord => format!(
                "https://discord.com/api/oauth2/authorize\
                ?client_id={client_id}\
                &response_type=code\
                &scope=identify%20email\
                &redirect_uri={redirect}\
                &code_challenge={code_challenge}\
                &code_challenge_method=S256\
                &state={state}"
            ),
        };

        // 清理过期 (5min) 的 stale state
        self.cleanup_stale();

        self.states.lock().insert(
            state.clone(),
            FlowState {
                provider,
                code_verifier,
                client_id: client_id.to_string(),
                created_at: Instant::now(),
            },
        );
        Ok((authorize_url, state))
    }

    /// 用 code + state 换 access_token。验证 state 存在且未过期。
    ///
    /// `client_secret` 对 Discord 必需, Notion 可为 None (公开 client 不校验)。
    pub async fn exchange(
        &self,
        state: &str,
        code: &str,
        client_secret: Option<&str>,
        http: &reqwest::Client,
    ) -> Result<TokenResponse> {
        let flow = {
            let mut map = self.states.lock();
            map.remove(state)
        };
        let flow = flow.ok_or_else(|| AppError::Validation(format!("OAuth state 无效或已过期: {state}")))?;
        if flow.created_at.elapsed() > Duration::from_secs(300) {
            return Err(AppError::Validation("OAuth state 已过期 (>5min)".into()));
        }
        let token = match flow.provider {
            OAuthProvider::Notion => {
                exchange_notion(http, &flow.client_id, code, &flow.code_verifier).await?
            }
            OAuthProvider::Discord => {
                let secret = client_secret
                    .ok_or_else(|| AppError::Config("Discord OAuth 需要 client_secret".into()))?;
                exchange_discord(http, &flow.client_id, secret, code, &flow.code_verifier).await?
            }
        };
        Ok(token)
    }

    /// 清理 >5min 的 state (防 Map 无限增长)
    fn cleanup_stale(&self) {
        let mut map = self.states.lock();
        map.retain(|_, s| s.created_at.elapsed() < Duration::from_secs(300));
    }
}

/// token endpoint 通用响应 (Notion/Discord 字段名略不同, 这里宽松匹配)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub expires_in: Option<i64>,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    /// Notion 特殊: bot_id / workspace_name / owner
    #[serde(default)]
    pub bot_id: Option<String>,
    #[serde(default)]
    pub workspace_name: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
}

async fn exchange_notion(
    http: &reqwest::Client,
    client_id: &str,
    code: &str,
    code_verifier: &str,
) -> Result<TokenResponse> {
    let url = "https://api.notion.com/v1/oauth/token";
    let body = serde_json::json!({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": "educationadvisor://oauth/callback",
        "client_id": client_id,
        "code_verifier": code_verifier,
    });
    let resp = http.post(url).json(&body).send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Llm(format!("Notion token 交换失败 ({}): {}", status, text)));
    }
    let token: TokenResponse = resp.json().await?;
    Ok(token)
}

async fn exchange_discord(
    http: &reqwest::Client,
    client_id: &str,
    client_secret: &str,
    code: &str,
    code_verifier: &str,
) -> Result<TokenResponse> {
    let url = "https://discord.com/api/oauth2/token";
    let body = serde_json::json!({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": "educationadvisor://oauth/callback",
        "client_id": client_id,
        "client_secret": client_secret,
        "code_verifier": code_verifier,
    });
    let resp = http.post(url).form(&body).send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Llm(format!("Discord token 交换失败 ({}): {}", status, text)));
    }
    let token: TokenResponse = resp.json().await?;
    Ok(token)
}

/// 生成随机 token (base64url, n 字节熵)
fn random_token(n: usize) -> String {
    let mut bytes = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(&bytes)
}

/// PKCE S256: code_challenge = base64url(sha256(code_verifier))
fn pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}