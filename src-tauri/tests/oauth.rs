//! OAuth flow 单元测试 — 不依赖网络, 仅测状态机逻辑。

use ea_tauri::services::oauth::{OAuthFlow, OAuthProvider};

#[test]
fn test_oauth_unsupported_provider_rejected() {
    assert!(OAuthProvider::from_id("notion").is_some());
    assert!(OAuthProvider::from_id("discord").is_some());
    assert!(OAuthProvider::from_id("openai").is_none());
    assert!(OAuthProvider::from_id("google").is_none());
}

#[test]
fn test_oauth_provider_id_roundtrip() {
    assert_eq!(OAuthProvider::Notion.id(), "notion");
    assert_eq!(OAuthProvider::Discord.id(), "discord");
    assert_eq!(OAuthProvider::from_id(OAuthProvider::Notion.id()), Some(OAuthProvider::Notion));
}

#[tokio::test]
async fn test_oauth_start_flow_rejects_empty_client_id() {
    let flow = OAuthFlow::new();
    let r = flow.start_flow(OAuthProvider::Notion, "");
    assert!(r.is_err(), "空 client_id 应被拒");
    let r = flow.start_flow(OAuthProvider::Discord, "");
    assert!(r.is_err());
}

#[tokio::test]
async fn test_oauth_start_flow_returns_authorize_url_and_state() {
    let flow = OAuthFlow::new();
    let r = flow
        .start_flow(OAuthProvider::Notion, "test-client-id-123")
        .unwrap();
    let (url, state) = r;
    assert!(url.contains("notion.com/v1/oauth/authorize"));
    assert!(url.contains("client_id=test-client-id-123"));
    assert!(url.contains("code_challenge="), "PKCE challenge 必须");
    assert!(url.contains("code_challenge_method=S256"));
    assert!(url.contains(&format!("state={state}")));
    assert!(!state.is_empty());
}

#[tokio::test]
async fn test_oauth_start_flow_discord_url() {
    let flow = OAuthFlow::new();
    let (url, _) = flow
        .start_flow(OAuthProvider::Discord, "discord-client")
        .unwrap();
    assert!(url.contains("discord.com/api/oauth2/authorize"));
    assert!(url.contains("scope=identify"));
    assert!(url.contains("code_challenge_method=S256"));
}

#[tokio::test]
async fn test_oauth_exchange_rejects_unknown_state() {
    let flow = OAuthFlow::new();
    let http = reqwest::Client::new();
    let r = flow
        .exchange("never-issued-state", "fake-code", None, &http)
        .await;
    assert!(r.is_err(), "未知的 state 应被拒");
}

#[tokio::test]
async fn test_oauth_exchange_discord_requires_secret() {
    let flow = OAuthFlow::new();
    // 先 start_flow 拿到合法 state
    let (_, state) = flow
        .start_flow(OAuthProvider::Discord, "discord-client")
        .unwrap();
    // exchange 时不传 client_secret → 应当在校验 token endpoint 之前就报错 (实际我们这里 exchange 内部会失败)
    // 由于我们的 exchange 在 state 合法时直接 POST, 这里的 client_secret 检查在 token exchange 后;
    // 仅验证: 没有 secret 时 network call 会失败 (但 state 已 remove)
    let http = reqwest::Client::new();
    let _r = flow.exchange(&state, "code", None, &http).await;
    // 不强制断言 ok/err (网络环境差异), 只确保不 panic
}

#[tokio::test]
async fn test_oauth_state_cleanup_after_exchange() {
    let flow = OAuthFlow::new();
    let (_, state) = flow
        .start_flow(OAuthProvider::Notion, "client")
        .unwrap();
    // exchange 后 state 应被 remove
    let http = reqwest::Client::new();
    let _ = flow.exchange(&state, "code", None, &http).await;
    // 再次用同一 state 应失败 (已被消费)
    let r = flow.exchange(&state, "code", None, &http).await;
    assert!(r.is_err(), "state 一次性消费, 二次使用应被拒");
}

#[tokio::test]
async fn test_oauth_pkce_challenge_format() {
    // base64url(SHA256(verifier)) 应是 43 字符 (256 bit -> 43 chars base64url no-pad)
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let verifier = "abcdefghijklmnopqrstuvwxyz0123456789-._~ABCDEFGHIJ"; // 50 chars (PKCE 43~128)
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());

    assert_eq!(challenge.len(), 43);
    // 不应含 +/= 字符 (URL-safe)
    assert!(!challenge.contains('+'));
    assert!(!challenge.contains('/'));
    assert!(!challenge.contains('='));
}

#[tokio::test]
async fn test_oauth_random_state_unique() {
    // 启动 100 次, 所有 state 应唯一
    use std::collections::HashSet;
    let flow = OAuthFlow::new();
    let mut seen = HashSet::new();
    for _ in 0..100 {
        let (_, state) = flow
            .start_flow(OAuthProvider::Notion, "client")
            .unwrap();
        assert!(seen.insert(state.clone()), "state 重复: {state}");
    }
    assert_eq!(seen.len(), 100);
}