//! Privacy engine: AES-256-GCM encryption at rest + PII redaction in transit.
//!
//! The master key is derived from a passphrase mixed with a 32-byte random
//! salt stored alongside the database. The salt is generated once per
//! install; losing it means losing access to encrypted fields, which is the
//! correct failure mode for a local-first privacy engine. A regex-based
//! redaction layer scrubs PII from prompts before they are sent to any LLM.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use regex::Regex;
use sha2::{Digest, Sha256};

/// File name for the per-install random salt, sitting next to the database.
pub const SALT_FILE: &str = "ea.salt";

/// A self-contained cipher wrapping AES-256-GCM with a random key.
#[derive(Clone)]
pub struct Cipher {
    key: [u8; 32],
}

impl Cipher {
    /// Create a cipher from a passphrase + salt (key derived via SHA-256).
    /// The salt must be a stable, per-install random value; the call sites
    /// load it from disk on startup.
    pub fn from_passphrase(passphrase: &str, salt: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(salt);
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

/// Load or create the per-install salt sitting next to the database file.
/// The salt is 32 random bytes; once created, it never changes.
pub fn load_or_create_salt(data_dir: &std::path::Path) -> anyhow::Result<Vec<u8>> {
    std::fs::create_dir_all(data_dir)?;
    let path = data_dir.join(SALT_FILE);
    if let Ok(existing) = std::fs::read(&path) {
        if existing.len() == 32 {
            return Ok(existing);
        }
        // Salt file is corrupt (wrong length). Refuse to silently overwrite
        // it: doing so would invalidate every existing encrypted value.
        anyhow::bail!(
            "salt 文件长度异常 ({} 字节)，拒绝覆盖以保护已加密数据",
            existing.len()
        );
    }
    let mut salt = vec![0u8; 32];
    OsRng.fill_bytes(&mut salt);
    std::fs::write(&path, &salt)?;
    // Best-effort permission tightening on Unix; harmless on Windows.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(salt)
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
        let salt = b"0123456789abcdef0123456789abcdef";
        let cipher = Cipher::from_passphrase("test-pass", salt);
        let msg = "监护人电话 13800138000";
        let enc = cipher.encrypt_str(msg).unwrap();
        assert_ne!(enc, msg);
        let dec = cipher.decrypt_str(&enc).unwrap();
        assert_eq!(dec, msg);
    }

    #[test]
    fn cipher_depends_on_salt() {
        // Two ciphers derived from the same passphrase but different salts
        // must NOT be able to decrypt each other's ciphertext.
        let salt_a = b"aaaa....aaaa";
        let salt_b = b"bbbb....bbbb";
        let c1 = Cipher::from_passphrase("p", salt_a);
        let c2 = Cipher::from_passphrase("p", salt_b);
        let enc = c1.encrypt_str("hello").unwrap();
        assert!(c2.decrypt_str(&enc).is_err());
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
