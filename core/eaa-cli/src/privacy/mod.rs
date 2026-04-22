//! EAA 隐私脱敏引擎 (PII Shield)
//!
//! 功能：
//! - 确定性化名映射（真名 → S001 等）
//! - 发送前脱敏（AI看不到真名）
//! - 接收后还原（用户看到真名）
//! - 发给家长的通知过滤器（防止隐私泄露）

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use aho_corasick::AhoCorasick;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use thiserror::Error;

/// 实体类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum EntityType {
    Student,
    Parent,
    Class,
    School,
    IdCard,
    Address,
    Phone,
    Custom(String),
}

impl EntityType {
    pub fn prefix(&self) -> &'static str {
        match self {
            EntityType::Student => "S",
            EntityType::Parent => "P",
            EntityType::Class => "C",
            EntityType::School => "SCH",
            EntityType::IdCard => "ID",
            EntityType::Address => "ADDR",
            EntityType::Phone => "PH",
            EntityType::Custom(_) => "X",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "student" => EntityType::Student,
            "parent" => EntityType::Parent,
            "class" => EntityType::Class,
            "school" => EntityType::School,
            "phone" => EntityType::Phone,
            "idcard" => EntityType::IdCard,
            "address" => EntityType::Address,
            other => EntityType::Custom(other.to_string()),
        }
    }
}

/// 映射表
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappingTable {
    /// 正向映射：类型前缀 → (化名 → 真名)
    pub forward: HashMap<String, HashMap<String, String>>,
    /// 反向映射：类型前缀 → (真名 → 化名)
    #[serde(skip)]
    pub reverse: HashMap<String, HashMap<String, String>>,
    pub version: String,
    pub last_updated: String,
}

impl MappingTable {
    pub fn new() -> Self {
        let mut mt = Self {
            forward: HashMap::new(),
            reverse: HashMap::new(),
            version: "1.0.0".to_string(),
            last_updated: chrono::Utc::now().to_rfc3339(),
        };
        // 预初始化所有类型
        for key in ["S", "P", "C", "SCH", "ID", "ADDR", "PH"] {
            mt.forward.insert(key.to_string(), HashMap::new());
            mt.reverse.insert(key.to_string(), HashMap::new());
        }
        mt
    }

    /// 添加实体，返回化名
    pub fn add(&mut self, entity_type: &EntityType, plain: &str) -> String {
        let key = entity_type.prefix().to_string();
        // 反向查找
        if let Some(rev) = self.reverse.get(&key) {
            if let Some(alias) = rev.get(plain) {
                return alias.clone();
            }
        }
        let count = self.forward.get(&key).map(|m| m.len()).unwrap_or(0);
        let alias = format!("{}_{:03}", entity_type.prefix(), count + 1);
        self.forward.entry(key.clone()).or_default().insert(alias.clone(), plain.to_string());
        self.reverse.entry(key.clone()).or_default().insert(plain.to_string(), alias.clone());
        self.last_updated = chrono::Utc::now().to_rfc3339();
        alias
    }
}

/// 隐私引擎
pub struct PrivacyEngine {
    pub enabled: bool,
    mapping: Option<MappingTable>,
    cipher: Option<Aes256Gcm>,
    mapping_path: PathBuf,
    nonce: [u8; 12],
}

impl Default for PrivacyEngine {
    fn default() -> Self {
        Self {
            enabled: false,
            mapping: None,
            cipher: None,
            mapping_path: PathBuf::new(),
            nonce: [0u8; 12],
        }
    }
}

impl PrivacyEngine {
    /// 初始化新引擎（加密存储）
    pub fn init(&mut self, data_dir: PathBuf, password: &str) -> Result<(), PrivacyError> {
        let key = derive_key(password);
        self.cipher = Some(Aes256Gcm::new_from_slice(&key)
            .map_err(|e| PrivacyError::Crypto(e.to_string()))?);
        self.mapping_path = data_dir.join("privacy/mapping.enc");
        std::fs::create_dir_all(self.mapping_path.parent().unwrap())?;
        // 生成随机nonce
        self.nonce = generate_nonce();
        let mapping = MappingTable::new();
        self.mapping = Some(mapping);
        self.save()?;
        self.enabled = true;
        Ok(())
    }

    /// 从加密文件加载
    pub fn load(&mut self, data_dir: PathBuf, password: &str) -> Result<(), PrivacyError> {
        self.mapping_path = data_dir.join("privacy/mapping.enc");
        if !self.mapping_path.exists() {
            return Err(PrivacyError::MappingNotFound);
        }
        let key = derive_key(password);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| PrivacyError::Crypto(e.to_string()))?;
        let encrypted = std::fs::read(&self.mapping_path)?;
        if encrypted.len() < 12 {
            return Err(PrivacyError::Crypto("文件太短".to_string()));
        }
        let (nonce_bytes, ciphertext) = encrypted.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);
        let decrypted = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| PrivacyError::Decrypt(e.to_string()))?;
        let mut mapping: MappingTable = serde_json::from_slice(&decrypted)
            .map_err(|e| PrivacyError::Deserialize(e.to_string()))?;
        // 重建反向映射
        let mut reverse = HashMap::new();
        for (k, fm) in &mapping.forward {
            let mut rm = HashMap::new();
            for (alias, plain) in fm {
                rm.insert(plain.clone(), alias.clone());
            }
            reverse.insert(k.clone(), rm);
        }
        mapping.reverse = reverse;
        self.mapping = Some(mapping);
        self.cipher = Some(cipher);
        self.enabled = true;
        Ok(())
    }

    /// 保存映射表（加密）
    fn save(&self) -> Result<(), PrivacyError> {
        let cipher = self.cipher.as_ref().ok_or(PrivacyError::NotInitialized)?;
        let mapping = self.mapping.as_ref().ok_or(PrivacyError::NotInitialized)?;
        let json = serde_json::to_string(mapping)
            .map_err(|e| PrivacyError::Serialize(e.to_string()))?;
        let nonce = Nonce::from_slice(&self.nonce);
        let encrypted = cipher.encrypt(nonce, json.as_bytes())
            .map_err(|e| PrivacyError::Crypto(e.to_string()))?;
        let mut out = Vec::with_capacity(12 + encrypted.len());
        out.extend_from_slice(&self.nonce);
        out.extend_from_slice(&encrypted);
        std::fs::write(&self.mapping_path, out)?;
        Ok(())
    }

    /// 添加实体
    pub fn add_entity(&mut self, entity_type: EntityType, plain: &str) -> Result<String, PrivacyError> {
        let mapping = self.mapping.as_mut().ok_or(PrivacyError::NotInitialized)?;
        let alias = mapping.add(&entity_type, plain);
        self.save()?;
        Ok(alias)
    }

    /// 脱敏：明文 → 化名
    pub fn anonymize(&self, text: &str) -> String {
        let mapping = match &self.mapping {
            Some(m) => m,
            None => return text.to_string(),
        };
        let mut patterns = Vec::new();
        let mut replacements = Vec::new();
        for (_k, reverse_map) in &mapping.reverse {
            for (plain, alias) in reverse_map {
                patterns.push(plain.clone());
                replacements.push(alias.clone());
            }
        }
        if patterns.is_empty() {
            return text.to_string();
        }
        let ac = match AhoCorasick::new(&patterns) {
            Ok(ac) => ac,
            Err(_) => return text.to_string(),
        };
        ac.replace_all(text, &replacements)
    }

    /// 还原：化名 → 明文
    pub fn deanonymize(&self, text: &str) -> String {
        let mapping = match &self.mapping {
            Some(m) => m,
            None => return text.to_string(),
        };
        let mut patterns = Vec::new();
        let mut replacements = Vec::new();
        for (_k, forward_map) in &mapping.forward {
            for (alias, plain) in forward_map {
                patterns.push(alias.clone());
                replacements.push(plain.clone());
            }
        }
        if patterns.is_empty() {
            return text.to_string();
        }
        let ac = match AhoCorasick::new(&patterns) {
            Ok(ac) => ac,
            Err(_) => return text.to_string(),
        };
        ac.replace_all(text, &replacements)
    }

    /// 列出所有化名
    pub fn list_aliases(&self) -> Vec<(String, String)> {
        let mapping = match &self.mapping {
            Some(m) => m,
            None => return Vec::new(),
        };
        let mut result = Vec::new();
        for (k, forward_map) in &mapping.forward {
            for (alias, _plain) in forward_map {
                result.push((k.clone(), alias.clone()));
            }
        }
        result.sort_by_key(|x| x.1.clone());
        result
    }

    /// 自动扫描entities.json，批量添加学生
    pub fn auto_scan_students(&mut self, entities_path: &PathBuf) -> Result<usize, PrivacyError> {
        let mapping = self.mapping.as_mut().ok_or(PrivacyError::NotInitialized)?;
        let data = std::fs::read_to_string(entities_path)
            .map_err(|e| PrivacyError::Io(e.to_string()))?;
        let entities: serde_json::Value = serde_json::from_str(&data)
            .map_err(|e| PrivacyError::Deserialize(e.to_string()))?;
        let mut count = 0;
        if let Some(obj) = entities.get("entities").and_then(|e| e.as_object()) {
            for (_, v) in obj {
                if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                    mapping.add(&EntityType::Student, name);
                    count += 1;
                }
            }
        } else if let Some(arr) = entities.get("entities").and_then(|e| e.as_array()) {
            for v in arr {
                if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                    mapping.add(&EntityType::Student, name);
                    count += 1;
                }
            }
        }
        if count > 0 {
            self.save()?;
        }
        Ok(count)
    }
}

/// 从密码生成256位密钥
fn derive_key(password: &str) -> [u8; 32] {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    Digest::update(&mut hasher, password.as_bytes());
    let result: [u8; 32] = Digest::finalize(hasher).into();
    result
}

/// 生成12字节随机nonce
fn generate_nonce() -> [u8; 12] {
    use sha2::{Sha256, Digest};
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
    let mut h = Sha256::new();
    Digest::update(&mut h, &now.as_nanos().to_le_bytes());
    let r: [u8; 32] = Digest::finalize(h).into();
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&r[..12]);
    nonce
}

/// 错误类型
#[derive(Error, Debug)]
pub enum PrivacyError {
    #[error("加密失败: {0}")]
    Crypto(String),
    #[error("解密失败: {0}")]
    Decrypt(String),
    #[error("序列化失败: {0}")]
    Serialize(String),
    #[error("反序列化失败: {0}")]
    Deserialize(String),
    #[error("映射表不存在，请先运行 eaa privacy init")]
    MappingNotFound,
    #[error("引擎未初始化")]
    NotInitialized,
    #[error("IO错误: {0}")]
    Io(String),
}

impl From<std::io::Error> for PrivacyError {
    fn from(e: std::io::Error) -> Self {
        PrivacyError::Io(e.to_string())
    }
}
