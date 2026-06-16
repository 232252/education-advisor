//! 飞书集成 — Rust 重写自 `src/main/services/feishu-service.ts` (247 行)。
//!
//! 用 reqwest 调飞书 OpenAPI:
//!   - tenant_access_token 获取
//!   - 消息发送 (im/v1/messages)
//!   - Bitable 表列表 / 记录写入
//! HMAC 回调校验复用 core/eaa-cli/crates/callback-signature。
//! 隐私预检 (send-preflight / send-confirm) 复用 eaa_core::privacy::filter_for_receiver。

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

/// 飞书 webhook 回调 secret 来源:
/// - 从 keystore 读取 (key = "feishu_webhook_secret"), 运行时配置优先于环境变量
/// - 回退到 env FEISHU_CALLBACK_SECRET
/// - 都没有 → 回调校验 disabled (verify_webhook 返回 Config 错误, 不 panic)
fn resolve_webhook_secret(
    keystore: Option<&crate::services::keystore::KeystoreService>,
) -> Option<String> {
    if let Some(ks) = keystore {
        if let Ok(Some(s)) = ks.get("feishu_webhook_secret") {
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    std::env::var("FEISHU_CALLBACK_SECRET")
        .ok()
        .filter(|s| !s.is_empty())
}

pub struct FeishuService {
    http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenResp {
    pub code: i64,
    pub msg: String,
    #[serde(default)]
    pub tenant_access_token: Option<String>,
    #[serde(default)]
    pub expire: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BitableTable {
    pub table_id: String,
    pub name: String,
}

impl FeishuService {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent("education-advisor-tauri")
            .build()
            .expect("reqwest");
        Self { http }
    }

    /// 获取 tenant_access_token (验证 appId + appSecret 是否有效)。
    pub async fn get_token(&self, app_id: &str, app_secret: &str) -> Result<TokenResp> {
        let url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
        let body = serde_json::json!({"app_id": app_id, "app_secret": app_secret});
        let resp: TokenResp = self.http.post(url).json(&body).send().await?.json().await?;
        if resp.code != 0 {
            return Err(AppError::Feishu(format!(
                "{} (code {})",
                resp.msg, resp.code
            )));
        }
        Ok(resp)
    }

    pub async fn test(&self, app_id: &str, app_secret: &str) -> Result<(String, i64)> {
        let t = self.get_token(app_id, app_secret).await?;
        Ok((
            t.tenant_access_token.unwrap_or_default(),
            t.expire.unwrap_or(7200),
        ))
    }

    /// 校验飞书 webhook 回调签名 + nonce 防重放。
    ///
    /// 与 callback-signature crate 对接:
    ///   - secret 来源: keystore("feishu_webhook_secret") > env("FEISHU_CALLBACK_SECRET")
    ///   - 都没有 → 返回 AppError::Config, **不 panic** (与 callback-signature::default() 的 expect 不同)
    ///   - 校验失败 (时间戳/签名/nonce) → 返回 VerificationError 转为 AppError::PermissionDenied
    pub async fn verify_webhook(
        &self,
        secret: &str,
        timestamp: i64,
        nonce: &str,
        data: &str,
        signature: &str,
    ) -> Result<callback_signature::VerificationResult> {
        use callback_signature::{CallbackConfig, CallbackVerifier};
        let cfg = CallbackConfig {
            secret: secret.to_string(),
            nonce_ttl_secs: 300,
            timestamp_tolerance_secs: 300,
        };
        let verifier = CallbackVerifier::new(cfg);
        let r = verifier
            .verify(timestamp, nonce, data, signature)
            .await
            .map_err(|e| AppError::PermissionDenied(format!("飞书回调校验失败: {e}")))?;
        tracing::info!(target: "feishu.webhook", "callback 校验通过 trace_id={}", r.trace_id);
        Ok(r)
    }

    /// 拿 webhook secret (优先 keystore, 回退 env)。给 command 层用。
    pub fn resolve_webhook_secret(
        keystore: Option<&crate::services::keystore::KeystoreService>,
    ) -> Option<String> {
        resolve_webhook_secret(keystore)
    }

    /// 列出多维表格的表。
    pub async fn list_bitable(&self, token: &str, app_token: &str) -> Result<Vec<BitableTable>> {
        let url = format!(
            "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables?page_size=100"
        );
        let resp: serde_json::Value = self
            .http
            .get(&url)
            .bearer_auth(token)
            .send()
            .await?
            .json()
            .await?;
        let code = resp.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            return Err(AppError::Feishu(format!(
                "{}",
                resp.get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
            )));
        }
        let tables = resp
            .pointer("/data/items")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|t| BitableTable {
                        table_id: t
                            .get("table_id")
                            .and_then(|s| s.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        name: t
                            .get("name")
                            .and_then(|s| s.as_str())
                            .unwrap_or_default()
                            .to_string(),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(tables)
    }

    /// 发消息。
    pub async fn send_text(
        &self,
        token: &str,
        receive_id_type: &str, // "open_id" | "user_id" | "email"
        receive_id: &str,
        text: &str,
    ) -> Result<String> {
        let url = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=".to_string()
            + receive_id_type;
        let body = serde_json::json!({
            "receive_id": receive_id,
            "msg_type": "text",
            "content": serde_json::to_string(&serde_json::json!({"text": text}))?,
        });
        let resp: serde_json::Value = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await?
            .json()
            .await?;
        let code = resp.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            return Err(AppError::Feishu(format!(
                "{}",
                resp.get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
            )));
        }
        let msg_id = resp
            .pointer("/data/message_id")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string();
        Ok(msg_id)
    }

    /// 写一条多维表格记录。
    pub async fn bitable_create_record(
        &self,
        token: &str,
        app_token: &str,
        table_id: &str,
        fields: serde_json::Value,
    ) -> Result<String> {
        let url = format!(
            "https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records"
        );
        let body = serde_json::json!({"fields": fields});
        let resp: serde_json::Value = self
            .http
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await?
            .json()
            .await?;
        let code = resp.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        if code != 0 {
            return Err(AppError::Feishu(format!(
                "{}",
                resp.get("msg")
                    .and_then(|m| m.as_str())
                    .unwrap_or("unknown")
            )));
        }
        Ok(resp
            .pointer("/data/record/record_id")
            .and_then(|s| s.as_str())
            .unwrap_or_default()
            .to_string())
    }
}

/// 隐私预检结果 (与前端 feishu.sendPreflight 返回同构)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreflightReport {
    pub has_pii: bool,
    pub entities: Vec<EntityCount>,
    pub redacted: String,
    pub original: String,
    pub original_length: usize,
    pub privacy_enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityCount {
    pub kind: String,
    pub count: usize,
}
