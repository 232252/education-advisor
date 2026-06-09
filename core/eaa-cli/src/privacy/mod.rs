//! EAA 隐私脱敏引擎 (PII Shield) v3.1
//!
//! 合规依据：《个人信息保护法》《未成年人网络保护条例》
//! 假名化处理后的数据不属于「个人信息」，向云端AI传输不构成「向第三方提供」
//!
//! 核心功能：
//! - 确定性化名映射（真名 → S_001 等）
//! - AES-256-GCM 加密映射表存储
//! - 发送前脱敏（AI看不到真名）
//! - 接收后还原（用户看到真名）
//! - 定向发送过滤器（发给家长时隐藏其他学生隐私）
//! - 全链路审计留痕

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
    pub fn prefix(&self) -> String {
        match self {
            EntityType::Student => "S".to_string(),
            EntityType::Parent => "P".to_string(),
            EntityType::Class => "C".to_string(),
            EntityType::School => "SCH".to_string(),
            EntityType::IdCard => "ID".to_string(),
            EntityType::Address => "ADDR".to_string(),
            EntityType::Phone => "PH".to_string(),
            EntityType::Custom(ref s) => s.clone(),
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "student" | "s" => EntityType::Student,
            "parent" | "p" | "guardian" | "g" => EntityType::Parent,
            "class" | "c" => EntityType::Class,
            "school" | "sch" => EntityType::School,
            "phone" | "ph" => EntityType::Phone,
            "idcard" | "id" => EntityType::IdCard,
            "address" | "addr" => EntityType::Address,
            other => EntityType::Custom(other.to_string()),
        }
    }
}

/// 映射表（序列化存储）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappingTable {
    /// 正向映射：类型前缀 → (化名 → 真名)
    pub forward: HashMap<String, HashMap<String, String>>,
    /// 版本号
    pub version: String,
    /// 最后更新时间
    pub last_updated: String,
}

/// 映射条目（用于展示）
#[derive(Debug, Clone)]
pub struct MappingEntry {
    pub entity_type: String,
    pub alias: String,
    pub real_name: String,
}

/// 隐私引擎
pub struct PrivacyEngine {
    pub enabled: bool,
    /// 映射表（内存中，包含正向+反向）
    forward: HashMap<String, HashMap<String, String>>,
    reverse: HashMap<String, HashMap<String, String>>,
    cipher: Option<Aes256Gcm>,
    mapping_path: PathBuf,
    nonce: [u8; 12],
}

impl Default for PrivacyEngine {
    fn default() -> Self {
        Self {
            enabled: false,
            forward: HashMap::new(),
            reverse: HashMap::new(),
            cipher: None,
            mapping_path: PathBuf::new(),
            nonce: [0u8; 12],
        }
    }
}

impl PrivacyEngine {
    /// 初始化新引擎
    pub fn init(&mut self, data_dir: &PathBuf, password: &str) -> Result<(), PrivacyError> {
        let key = derive_key(password);
        self.cipher = Some(
            Aes256Gcm::new_from_slice(&key)
                .map_err(|e| PrivacyError::Crypto(e.to_string()))?,
        );
        self.mapping_path = data_dir.join("privacy").join("mapping.enc");
        std::fs::create_dir_all(self.mapping_path.parent().unwrap())?;
        self.nonce = generate_nonce();
        // 清空映射
        self.forward.clear();
        self.reverse.clear();
        for key in ["S", "P", "C", "SCH", "ID", "ADDR", "PH"] {
            self.forward.insert(key.to_string(), HashMap::new());
            self.reverse.insert(key.to_string(), HashMap::new());
        }
        self.save()?;
        self.enabled = true;
        Ok(())
    }

    /// 从加密文件加载（每次命令启动时调用）
    pub fn load(&mut self, data_dir: &PathBuf, password: &str) -> Result<(), PrivacyError> {
        let path = data_dir.join("privacy").join("mapping.enc");
        if !path.exists() {
            return Err(PrivacyError::MappingNotFound);
        }
        let key = derive_key(password);
        let cipher = Aes256Gcm::new_from_slice(&key)
            .map_err(|e| PrivacyError::Crypto(e.to_string()))?;
        let encrypted = std::fs::read(&path)?;
        if encrypted.len() < 12 {
            return Err(PrivacyError::Crypto("加密文件损坏".to_string()));
        }
        let (nonce_bytes, ciphertext) = encrypted.split_at(12);
        let decrypted = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| PrivacyError::Decrypt("密码错误或文件损坏".to_string()))?;
        let table: MappingTable = serde_json::from_slice(&decrypted)
            .map_err(|e| PrivacyError::Deserialize(e.to_string()))?;

        // 重建双向映射
        let mut forward = HashMap::new();
        let mut reverse = HashMap::new();
        for (prefix, fm) in &table.forward {
            let mut rm = HashMap::new();
            for (alias, plain) in fm {
                rm.insert(plain.clone(), alias.clone());
            }
            forward.insert(prefix.clone(), fm.clone());
            reverse.insert(prefix.clone(), rm);
        }
        // 确保所有类型键都存在
        for key in ["S", "P", "C", "SCH", "ID", "ADDR", "PH"] {
            forward.entry(key.to_string()).or_default();
            reverse.entry(key.to_string()).or_default();
        }

        self.forward = forward;
        self.reverse = reverse;
        self.cipher = Some(cipher);
        self.mapping_path = path;
        self.enabled = true;
        Ok(())
    }

    /// 检查引擎是否已初始化（映射文件存在）
    pub fn is_initialized(data_dir: &PathBuf) -> bool {
        data_dir.join("privacy").join("mapping.enc").exists()
    }

    /// 保存映射表
    fn save(&self) -> Result<(), PrivacyError> {
        let cipher = self.cipher.as_ref().ok_or(PrivacyError::NotInitialized)?;
        let table = MappingTable {
            forward: self.forward.clone(),
            version: "1.0.0".to_string(),
            last_updated: chrono::Utc::now().to_rfc3339(),
        };
        let json = serde_json::to_string(&table)
            .map_err(|e| PrivacyError::Serialize(e.to_string()))?;
        let encrypted = cipher
            .encrypt(Nonce::from_slice(&self.nonce), json.as_bytes())
            .map_err(|e| PrivacyError::Crypto(e.to_string()))?;
        let mut out = Vec::with_capacity(12 + encrypted.len());
        out.extend_from_slice(&self.nonce);
        out.extend_from_slice(&encrypted);
        std::fs::write(&self.mapping_path, &out)?;
        Ok(())
    }

    /// 添加实体映射
    pub fn add_entity(&mut self, entity_type: &EntityType, plain: &str) -> Result<String, PrivacyError> {
        let key = entity_type.prefix().to_string();
        // 已存在 → 返回已有化名
        if let Some(rev) = self.reverse.get(&key) {
            if let Some(alias) = rev.get(plain) {
                return Ok(alias.clone());
            }
        }
        let count = self.forward.get(&key).map(|m| m.len()).unwrap_or(0);
        let alias = format!("{}_{:03}", entity_type.prefix(), count + 1);
        self.forward
            .entry(key.clone())
            .or_default()
            .insert(alias.clone(), plain.to_string());
        self.reverse
            .entry(key.clone())
            .or_default()
            .insert(plain.to_string(), alias.clone());
        self.save()?;
        Ok(alias)
    }

    /// 批量添加学生（自动扫描）
    pub fn auto_scan_students(&mut self, data_dir: &PathBuf) -> Result<usize, PrivacyError> {
        let entities_path = data_dir.join("entities").join("entities.json");
        if !entities_path.exists() {
            return Ok(0);
        }
        let data = std::fs::read_to_string(&entities_path)
            .map_err(|e| PrivacyError::Io(e.to_string()))?;
        let root: serde_json::Value = serde_json::from_str(&data)
            .map_err(|e| PrivacyError::Deserialize(e.to_string()))?;
        let mut count = 0;

        // 支持 HashMap 格式: {"entities": {"id": {"name": "xxx", ...}, ...}}
        if let Some(obj) = root.get("entities").and_then(|e| e.as_object()) {
            for (_, v) in obj {
                if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                    if !name.is_empty() {
                        self.add_entity(&EntityType::Student, name)?;
                        count += 1;
                    }
                }
            }
        }

        if count > 0 {
            self.save()?;
        }
        Ok(count)
    }

    /// 脱敏：明文 → 化名（发给AI前）
    pub fn anonymize(&self, text: &str) -> String {
        let mut patterns = Vec::new();
        let mut replacements = Vec::new();
        for (_k, reverse_map) in &self.reverse {
            for (plain, alias) in reverse_map {
                patterns.push(plain.clone());
                replacements.push(alias.clone());
            }
        }
        if patterns.is_empty() {
            return text.to_string();
        }
        match AhoCorasick::new(&patterns) {
            Ok(ac) => ac.replace_all(text, &replacements),
            Err(_) => text.to_string(),
        }
    }

    /// 还原：化名 → 明文（AI返回后）
    pub fn deanonymize(&self, text: &str) -> String {
        let mut patterns = Vec::new();
        let mut replacements = Vec::new();
        for (_k, forward_map) in &self.forward {
            for (alias, plain) in forward_map {
                patterns.push(alias.clone());
                replacements.push(plain.clone());
            }
        }
        if patterns.is_empty() {
            return text.to_string();
        }
        match AhoCorasick::new(&patterns) {
            Ok(ac) => ac.replace_all(text, &replacements),
            Err(_) => text.to_string(),
        }
    }

    /// 定向过滤器：发给某接收者时，隐藏其他人的真实姓名
    ///
    /// 例如发给"张三妈妈"时，"李四考了80分" → "其他同学考了80分"
    pub fn filter_for_receiver(&self, text: &str, receiver_name: &str) -> String {
        let mut result = text.to_string();
        // 允许出现：接收者本人 + 家属（名字包含接收者名的都放行）
        for (_k, reverse_map) in &self.reverse {
            for (plain, _alias) in reverse_map {
                // 跳过接收者及其关联人（如"张三妈妈"包含"张三"）
                if plain == receiver_name || receiver_name.contains(plain) || plain.contains(receiver_name) {
                    continue;
                }
                if result.contains(plain) {
                    result = result.replace(plain, "其他同学");
                }
            }
        }
        result
    }

    /// 列出所有映射（本地查看，显示真名+化名）
    pub fn list_mappings(&self) -> Vec<MappingEntry> {
        let mut entries = Vec::new();
        for (prefix, forward_map) in &self.forward {
            for (alias, real_name) in forward_map {
                entries.push(MappingEntry {
                    entity_type: prefix.clone(),
                    alias: alias.clone(),
                    real_name: real_name.clone(),
                });
            }
        }
        entries.sort_by(|a, b| a.alias.cmp(&b.alias));
        entries
    }

    /// 映射总数
    pub fn mapping_count(&self) -> usize {
        self.forward.values().map(|m| m.len()).sum()
    }

    /// 备份加密映射表
    pub fn backup(&self, backup_path: &PathBuf) -> Result<(), PrivacyError> {
        if !self.mapping_path.exists() {
            return Err(PrivacyError::MappingNotFound);
        }
        if let Some(parent) = backup_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&self.mapping_path, backup_path)?;
        Ok(())
    }
}

/// 从密码派生256位AES密钥
fn derive_key(password: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    Digest::update(&mut hasher, password.as_bytes());
    let result: [u8; 32] = Digest::finalize(hasher).into();
    result
}

/// 生成12字节nonce（基于时间戳+进程ID）
fn generate_nonce() -> [u8; 12] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    Digest::update(&mut h, chrono::Utc::now().to_rfc3339().as_bytes());
    Digest::update(&mut h, std::process::id().to_le_bytes());
    Digest::update(&mut h, &std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        .to_le_bytes());
    let hash: [u8; 32] = Digest::finalize(h).into();
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&hash[..12]);
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
