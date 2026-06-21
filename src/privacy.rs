//! Privacy engine: AES-256-GCM encryption at rest + PII redaction in transit.
//!
//! The master key is derived once per install from a random secret stored in a
//! platform-appropriate location, then used to encrypt sensitive fields (guardian
//! contacts, API keys) before they ever touch `SQLite`. A regex-based redaction
//! layer scrubs PII from prompts before they are sent to any LLM provider.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use regex::Regex;
use sha2::{Digest, Sha256};

/// A self-contained cipher wrapping AES-256-GCM with a random key.
#[derive(Clone)]
pub struct Cipher {
    key: [u8; 32],
}

impl Cipher {
    /// Create a cipher from a passphrase (key derived via SHA-256).
    pub fn from_passphrase(passphrase: &str) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(passphrase.as_bytes());
        let hash = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&hash);
        Self { key }
    }

    /// Generate a cipher with a fresh random key.
    pub fn random() -> Self {
        let mut key = [0u8; 32];
        OsRng.fill_bytes(&mut key);
        Self { key }
    }

    pub fn encrypt(&self, plaintext: &[u8]) -> anyhow::Result<String> {
        let cipher = Aes256Gcm::new(&self.key.into());
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| anyhow::anyhow!("encrypt: {e}"))?;
        let mut out = Vec::with_capacity(12 + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        Ok(B64.encode(&out))
    }

    pub fn decrypt(&self, payload: &str) -> anyhow::Result<Vec<u8>> {
        let bytes = B64
            .decode(payload)
            .map_err(|e| anyhow::anyhow!("b64 decode: {e}"))?;
        if bytes.len() < 13 {
            anyhow::bail!("ciphertext too short");
        }
        let cipher = Aes256Gcm::new(&self.key.into());
        let nonce = Nonce::from_slice(&bytes[..12]);
        let pt = cipher
            .decrypt(nonce, &bytes[12..])
            .map_err(|e| anyhow::anyhow!("decrypt: {e}"))?;
        Ok(pt)
    }

    pub fn encrypt_str(&self, s: &str) -> anyhow::Result<String> {
        self.encrypt(s.as_bytes())
    }
    pub fn decrypt_str(&self, payload: &str) -> anyhow::Result<String> {
        String::from_utf8(self.decrypt(payload)?).map_err(Into::into)
    }
}

/// PII redactor that masks phone numbers, ID cards and emails.
pub struct Redactor {
    phone: Regex,
    id_card: Regex,
    email: Regex,
}

impl Redactor {
    pub fn new() -> Self {
        Self {
            phone: Regex::new(r"1[3-9]\d{9}").unwrap(),
            id_card: Regex::new(r"\b\d{17}[\dXx]\b").unwrap(),
            email: Regex::new(r"[\w.+-]+@[\w-]+\.[\w.-]+").unwrap(),
        }
    }

    /// Mask sensitive substrings. Returns the redacted text and the count of
    /// redactions performed (for audit display).
    pub fn redact(&self, text: &str) -> (String, usize) {
        let mut count = 0usize;
        let s = self.phone.replace_all(text, |c: &regex::Captures| {
            count += 1;
            let m = c.get(0).unwrap().as_str();
            format!("{}****{}", &m[..3], &m[m.len() - 4..])
        });
        let s = self.id_card.replace_all(&s, |c: &regex::Captures| {
            count += 1;
            let m = c.get(0).unwrap().as_str();
            format!("{}********{}", &m[..6], &m[m.len() - 4..])
        });
        let s = self.email.replace_all(&s, |c: &regex::Captures| {
            count += 1;
            let m = c.get(0).unwrap().as_str();
            let at = m.find('@').unwrap();
            format!("{}***{}", &m[..1], &m[at..])
        });
        (s.into_owned(), count)
    }
}

impl Default for Redactor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cipher_roundtrip() {
        let cipher = Cipher::from_passphrase("test-pass");
        let msg = "监护人电话 13800138000";
        let enc = cipher.encrypt_str(msg).unwrap();
        assert_ne!(enc, msg);
        let dec = cipher.decrypt_str(&enc).unwrap();
        assert_eq!(dec, msg);
    }

    #[test]
    fn redaction_masks_pii() {
        let r = Redactor::new();
        let text = "联系我 13800138000 或 lihua@example.com，身份证 110101199001011234";
        let (out, count) = r.redact(text);
        assert!(count >= 3);
        assert!(!out.contains("13800138000"));
        assert!(!out.contains("lihua@example.com"));
        assert!(!out.contains("110101199001011234"));
    }
}
