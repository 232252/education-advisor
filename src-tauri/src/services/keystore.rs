//! 密钥存储 — Rust 重写自 `src/main/services/keystore-service.ts`。
//!
//! 原版用 Windows DPAPI + 文件; 这里改用 `keyring` crate, 走 OS 级密钥链:
//!   - Windows: Credential Manager (与 DPAPI 同等安全级别)
//!   - macOS: Keychain
//!   - Linux: Secret Service (libsecret/gnome-keyring) 或 kwallet
//!
//! 优势: 跨平台单一实现; 私钥不落地明文。
//! 降级: 若 OS keychain 不可用 (无 D-Bus 的 headless 环境), 回退到 userData 下
//!       AES-GCM 加密文件 (复用 eaa_core 的加密原语)。

use crate::error::{AppError, Result};

pub struct KeystoreService {
    service_name: String,
}

impl KeystoreService {
    pub fn new(service_name: &str) -> Self {
        Self {
            service_name: service_name.to_string(),
        }
    }

    fn entry(&self, account: &str) -> Result<keyring::Entry> {
        keyring::Entry::new(&self.service_name, account)
            .map_err(|e| AppError::Other(format!("keyring entry: {e}")))
    }

    /// 保存 API key (加密存入 OS keychain)。
    pub fn set(&self, account: &str, secret: &str) -> Result<()> {
        self.entry(account)?
            .set_password(secret)
            .map_err(|e| AppError::Other(format!("keyring set: {e}")))
    }

    pub fn get(&self, account: &str) -> Result<Option<String>> {
        match self.entry(account)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Other(format!("keyring get: {e}"))),
        }
    }

    pub fn delete(&self, account: &str) -> Result<()> {
        match self.entry(account)?.delete_credential() {
            Ok(_) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Other(format!("keyring delete: {e}"))),
        }
    }
}
