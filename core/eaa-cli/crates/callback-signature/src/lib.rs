// PR-F01: Feishu Callback Signature Verification
// Signature verification with nonce replay detection
// Verification standard: 100% pass rate, 100% nonce replay detection

use hmac::{Hmac, Mac};
use sha2::Sha256;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use ttl_cache::TtlCache;

type HmacSha256 = Hmac<Sha256>;

/// Callback verification configuration
#[derive(Debug, Clone)]
pub struct CallbackConfig {
    /// Signature secret
    pub secret: String,
    /// Nonce cache TTL in seconds
    pub nonce_ttl_secs: u64,
    /// Timestamp tolerance in seconds
    pub timestamp_tolerance_secs: i64,
}

impl Default for CallbackConfig {
    fn default() -> Self {
        Self {
            secret: std::env::var("FEISHU_CALLBACK_SECRET")
                .expect("FEISHU_CALLBACK_SECRET must be set"),
            nonce_ttl_secs: 300, // 5 minutes
            timestamp_tolerance_secs: 300, // 5 minutes
        }
    }
}

/// Callback signature verifier
pub struct CallbackVerifier {
    config: CallbackConfig,
    /// Nonce cache for replay detection
    nonce_cache: Arc<RwLock<TtlCache<String, Instant>>>,
}

impl CallbackVerifier {
    /// Create new verifier
    pub fn new(config: CallbackConfig) -> Self {
        let cache = TtlCache::new(10000); // Max 10000 nonces
        Self {
            config,
            nonce_cache: Arc::new(RwLock::new(cache)),
        }
    }
    
    /// Verify callback signature
    /// 
    /// Parameters:
    /// - timestamp: Unix timestamp
    /// - nonce: Random string
    /// - data: Callback data (JSON string)
    /// - signature: HMAC-SHA256 signature
    pub async fn verify(
        &self,
        timestamp: i64,
        nonce: &str,
        data: &str,
        signature: &str,
    ) -> Result<VerificationResult, VerificationError> {
        // 1. Verify timestamp freshness
        self.verify_timestamp(timestamp)?;
        
        // 2. Check nonce for replay attack
        self.check_nonce(nonce).await?;
        
        // 3. Verify signature
        self.verify_signature(timestamp, nonce, data, signature).await?;
        
        // 4. Mark nonce as used
        self.mark_nonce_used(nonce).await;
        
        Ok(VerificationResult {
            passed: true,
            trace_id: format!("cb-{}-{}", timestamp, nonce),
        })
    }
    
    /// Verify timestamp
    fn verify_timestamp(&self, timestamp: i64) -> Result<(), VerificationError> {
        let now = chrono::Utc::now().timestamp();
        let drift = now - timestamp;
        
        if drift > self.config.timestamp_tolerance_secs || drift < -self.config.timestamp_tolerance_secs {
            return Err(VerificationError::TimestampExpired {
                expected: format!("within {} seconds", self.config.timestamp_tolerance_secs),
                actual: format!("{} seconds ago", drift),
            });
        }
        
        Ok(())
    }
    
    /// Check if nonce has been used
    async fn check_nonce(&self, nonce: &str) -> Result<(), VerificationError> {
        let cache = self.nonce_cache.read().await;
        if cache.get(nonce).is_some() {
            return Err(VerificationError::NonceReused(nonce.to_string()));
        }
        Ok(())
    }
    
    /// Mark nonce as used
    async fn mark_nonce_used(&self, nonce: &str) {
        let mut cache = self.nonce_cache.write().await;
        cache.insert(
            nonce.to_string(), 
            Instant::now(), 
            Duration::from_secs(self.config.nonce_ttl_secs)
        );
    }
    
    /// Verify signature
    async fn verify_signature(
        &self,
        timestamp: i64,
        nonce: &str,
        data: &str,
        signature: &str,
    ) -> Result<(), VerificationError> {
        // Build message: timestamp + "\n" + nonce + "\n" + data
        let message = format!("{}\n{}\n{}", timestamp, nonce, data);
        
        // Compute expected signature
        let expected = self.compute_signature(&message)?;
        
        // Constant-time comparison
        if !constant_time_compare(&expected, signature) {
            return Err(VerificationError::SignatureMismatch {
                expected,
                actual: signature.to_string(),
            });
        }
        
        Ok(())
    }
    
    /// Compute HMAC-SHA256 signature
    fn compute_signature(&self, message: &str) -> Result<String, VerificationError> {
        let mut mac = HmacSha256::new_from_slice(self.config.secret.as_bytes())
            .map_err(|e| VerificationError::MacError(e.to_string()))?;
        mac.update(message.as_bytes());
        
        let result = mac.finalize();
        Ok(hex::encode(result.into_bytes()))
    }
}

/// Verification result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub passed: bool,
    pub trace_id: String,
}

/// Verification error
#[derive(Debug, thiserror::Error)]
pub enum VerificationError {
    #[error("Timestamp expired: expected {expected}, actual {actual}")]
    TimestampExpired { expected: String, actual: String },
    
    #[error("Nonce already used: {0}")]
    NonceReused(String),
    
    #[error("Signature mismatch")]
    SignatureMismatch { expected: String, actual: String },
    
    #[error("MAC error: {0}")]
    MacError(String),
}

/// Constant-time string comparison (prevents timing attacks)
fn constant_time_compare(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    
    let mut result = 0u8;
    for i in 0..a_bytes.len() {
        result |= a_bytes[i] ^ b_bytes[i];
    }
    
    result == 0
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_verifier() -> CallbackVerifier {
        let config = CallbackConfig {
            secret: "test-secret-key".to_string(),
            nonce_ttl_secs: 300,
            timestamp_tolerance_secs: 300,
        };
        CallbackVerifier::new(config)
    }

    #[tokio::test]
    async fn test_valid_signature() {
        let verifier = create_test_verifier();
        let timestamp = chrono::Utc::now().timestamp();
        let nonce = "test-nonce-123";
        let data = r#"{"event_type": "test"}"#;
        
        // Compute correct signature
        let message = format!("{}\n{}\n{}", timestamp, nonce, data);
        let mut mac = HmacSha256::new_from_slice(b"test-secret-key").unwrap();
        mac.update(message.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());
        
        let result = verifier.verify(timestamp, nonce, data, &signature).await;
        assert!(result.is_ok());
        assert!(result.unwrap().passed);
    }

    #[tokio::test]
    async fn test_invalid_signature() {
        let verifier = create_test_verifier();
        let timestamp = chrono::Utc::now().timestamp();
        let nonce = "test-nonce-456";
        let data = r#"{"event_type": "test"}"#;
        let wrong_signature = "invalid-signature";
        
        let result = verifier.verify(timestamp, nonce, data, wrong_signature).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), VerificationError::SignatureMismatch { .. }));
    }

    #[tokio::test]
    async fn test_nonce_reuse() {
        let verifier = create_test_verifier();
        let timestamp = chrono::Utc::now().timestamp();
        let nonce = "unique-nonce-789";
        let data = r#"{"event_type": "test"}"#;
        
        // Compute correct signature
        let message = format!("{}\n{}\n{}", timestamp, nonce, data);
        let mut mac = HmacSha256::new_from_slice(b"test-secret-key").unwrap();
        mac.update(message.as_bytes());
        let signature = hex::encode(mac.finalize().into_bytes());
        
        // First verification should succeed
        let result1 = verifier.verify(timestamp, nonce, data, &signature).await;
        assert!(result1.is_ok());
        
        // Second use of same nonce should fail
        let result2 = verifier.verify(timestamp, nonce, data, &signature).await;
        assert!(result2.is_err());
        assert!(matches!(result2.unwrap_err(), VerificationError::NonceReused(_)));
    }

    #[tokio::test]
    async fn test_expired_timestamp() {
        let verifier = create_test_verifier();
        let old_timestamp = chrono::Utc::now().timestamp() - 600; // 10 minutes ago
        let nonce = "test-nonce";
        let data = r#"{"event_type": "test"}"#;
        let signature = "dummy";
        
        let result = verifier.verify(old_timestamp, nonce, data, signature).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), VerificationError::TimestampExpired { .. }));
    }
}
