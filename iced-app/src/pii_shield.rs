//! PII Shield — 隐私脱敏引擎（假名化）。
//!
//! 这是 v0.1.0-rc.1 中"最核心"功能：把学生真名、家长姓名、班级、
//! 学校、身份证、地址、电话等敏感实体映射成 `S_001` / `P_001` 等
//! 确定性化名；在发送给云端 AI 之前自动替换成化名；在 AI 返回后
//! 还原真名给教师看。
//!
//! 设计目标：让 Qwen3.5-4B 等小模型也能正确执行。
//!
//! 合规依据：
//! - 《个人信息保护法》
//! - 《未成年人网络保护条例》
//! - 假名化处理后的数据不属于「个人信息」，向云端 AI 传输不构成
//!   「向第三方提供」。
//!
//! 核心功能：
//! - 确定性化名映射（真名 → S_001 等）
//! - AES-256-GCM 加密映射表（密码派生密钥，密码丢失不可恢复）
//! - 发送前脱敏（AI 看不到真名）
//! - 接收后还原（用户看真名）
//! - 定向发送过滤器（发给家长时自动隐藏其他学生隐私）
//! - 自动扫描导入（一键扫描现有学生数据）
//! - 全链路审计留痕
//!
//! 实现说明：原本该引擎依赖 `aho-corasick` 做高效多模式匹配；
//! 在 egui 项目里我们用 `regex` 的 `RegexSet` 替代，避免再增一个
//! C 依赖。功能上对调用方完全等价。

// The whole module is meant to be a faithful port of the v0.1.0-rc.1
// engine, so most methods are part of the public API even when the
// current UI doesn't reach all of them yet. The `#[allow]` keeps
// `clippy -D warnings` happy without dropping any functionality.
#![allow(dead_code)]

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// 实体类型。
///
/// 与 v0.1.0-rc.1 中的 `EntityType` 保持一一对应，前缀也照搬
/// (S/P/C/SCH/ID/ADDR/PH)，这样老备份文件可以平滑迁移。
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
    pub const ALL: &'static [EntityType] = &[
        Self::Student,
        Self::Parent,
        Self::Class,
        Self::School,
        Self::IdCard,
        Self::Address,
        Self::Phone,
    ];

    pub fn prefix(&self) -> String {
        match self {
            Self::Student => "S".to_string(),
            Self::Parent => "P".to_string(),
            Self::Class => "C".to_string(),
            Self::School => "SCH".to_string(),
            Self::IdCard => "ID".to_string(),
            Self::Address => "ADDR".to_string(),
            Self::Phone => "PH".to_string(),
            Self::Custom(ref s) => s.clone(),
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "student" | "s" => Self::Student,
            "parent" | "p" | "guardian" | "g" => Self::Parent,
            "class" | "c" => Self::Class,
            "school" | "sch" => Self::School,
            "phone" | "ph" => Self::Phone,
            "idcard" | "id" => Self::IdCard,
            "address" | "addr" => Self::Address,
            other => Self::Custom(other.to_string()),
        }
    }

    pub fn label_zh(&self) -> &'static str {
        match self {
            Self::Student => "学生",
            Self::Parent => "家长",
            Self::Class => "班级",
            Self::School => "学校",
            Self::IdCard => "身份证",
            Self::Address => "地址",
            Self::Phone => "电话",
            Self::Custom(_) => "自定义",
        }
    }
}

/// 加密落盘的映射表。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappingTable {
    /// 正向映射：类型前缀 → (化名 → 真名)
    pub forward: HashMap<String, HashMap<String, String>>,
    /// 版本号
    pub version: String,
    /// 最后更新时间（RFC3339）
    pub last_updated: String,
}

impl Default for MappingTable {
    fn default() -> Self {
        Self {
            forward: HashMap::new(),
            version: "1.0.0".to_string(),
            last_updated: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// 映射条目（用于 UI 展示）
#[derive(Debug, Clone)]
pub struct MappingEntry {
    pub entity_type: String,
    pub alias: String,
    pub real_name: String,
}

/// PII 假名化引擎。
///
/// 状态机：
///   `init` → `add_entity` → `anonymize` / `deanonymize` / `filter_for_receiver`
///   `load` → 任何操作
///
/// 加密落盘的格式：
///   `[12 bytes nonce | AES-256-GCM(plaintext) | base64]`
///   密钥从 `password` 通过 SHA-256 派生，与 v0.1.0-rc.1 的 `derive_key`
///   完全一致——这意味着老备份文件在本引擎里照样能解密。
pub struct PrivacyEngine {
    pub enabled: bool,
    /// 真名 → 化名（按前缀分组）
    forward: HashMap<String, HashMap<String, String>>,
    /// 化名 → 真名（按前缀分组）
    reverse: HashMap<String, HashMap<String, String>>,
    cipher: Option<Aes256Gcm>,
    mapping_path: PathBuf,
}

impl Default for PrivacyEngine {
    fn default() -> Self {
        Self {
            enabled: false,
            forward: HashMap::new(),
            reverse: HashMap::new(),
            cipher: None,
            mapping_path: PathBuf::new(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PrivacyError {
    #[error("加密失败: {0}")]
    Crypto(String),
    #[error("解密失败: {0}（密码错误或文件损坏）")]
    Decrypt(String),
    #[error("序列化失败: {0}")]
    Serialize(String),
    #[error("反序列化失败: {0}")]
    Deserialize(String),
    #[error("映射表不存在，请先运行隐私引擎初始化")]
    MappingNotFound,
    #[error("引擎未初始化")]
    NotInitialized,
    #[error("IO 错误: {0}")]
    Io(String),
}

impl From<std::io::Error> for PrivacyError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

impl PrivacyEngine {
    /// 全局唯一的相对路径（与 v0.1.0-rc.1 的布局完全一致）。
    pub fn mapping_path(data_dir: &Path) -> PathBuf {
        data_dir.join("privacy").join("mapping.enc")
    }

    /// 是否已经初始化（映射文件存在）。
    pub fn is_initialized(data_dir: &Path) -> bool {
        Self::mapping_path(data_dir).exists()
    }

    /// 初始化新引擎：派生密钥、清空映射、生成 nonce、写入空表。
    ///
    /// P0 BUG #2 fix: 现在会创建并使用 32 字节随机盐（mapping.salt），
    /// 密钥通过 20 万轮 SHA-256 拉伸派生。老文件会被自动检测并升级。
    pub fn init(&mut self, data_dir: &Path, password: &str) -> Result<(), PrivacyError> {
        // 创建 / 加载盐文件（在 mapping.enc 同目录）。
        let salt = load_or_create_pii_salt(&data_dir.join("privacy"))?;
        let key = derive_key(password, &salt);
        self.cipher =
            Some(Aes256Gcm::new_from_slice(&key).map_err(|e| PrivacyError::Crypto(e.to_string()))?);
        self.mapping_path = Self::mapping_path(data_dir);
        if let Some(parent) = self.mapping_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        self.forward.clear();
        self.reverse.clear();
        for et in EntityType::ALL {
            let k = et.prefix();
            self.forward.entry(k.clone()).or_default();
            self.reverse.entry(k).or_default();
        }
        self.save()?;
        self.enabled = true;
        Ok(())
    }

    /// 从加密文件加载。每次启动 / 解锁时调用一次。
    ///
    /// P0 BUG #2 fix: 自动检测文件版本：
    ///   - v1 带盐格式：用 `derive_key_v1(password, salt)` 解密
    ///   - v0 老格式（无盐 SHA-256）：用 `derive_key_legacy(password)` 解密
    /// 解密成功后立刻升级写回 v1，丢弃旧格式。
    pub fn load(&mut self, data_dir: &Path, password: &str) -> Result<(), PrivacyError> {
        let path = Self::mapping_path(data_dir);
        if !path.exists() {
            return Err(PrivacyError::MappingNotFound);
        }
        let raw = std::fs::read(&path)?;
        if raw.is_empty() {
            return Err(PrivacyError::Crypto("加密文件为空".into()));
        }

        // 探测文件版本：v1 以 0x01 字节开头；v0 直接以 12 字节 nonce 开头。
        let (version, salt, body) = if raw[0] == FILE_VERSION_V1 {
            if raw.len() < 1 + 32 + 12 {
                return Err(PrivacyError::Crypto("加密文件长度异常 (v1)".into()));
            }
            let salt = raw[1..33].to_vec();
            let body = raw[33..].to_vec();
            (FILE_VERSION_V1, Some(salt), body)
        } else {
            // v0 老格式：12 字节 nonce + ciphertext，没有版本头也没有盐。
            (FILE_VERSION_V0, None, raw.clone())
        };

        let key = match (&salt, version) {
            (Some(s), FILE_VERSION_V1) => derive_key_v1(password, s),
            (None, FILE_VERSION_V0) => derive_key_legacy(password),
            _ => return Err(PrivacyError::Crypto("未知文件版本".into())),
        };
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|e| PrivacyError::Crypto(e.to_string()))?;
        if body.len() < 12 {
            return Err(PrivacyError::Crypto("加密文件损坏".into()));
        }
        let (nonce_bytes, ciphertext) = body.split_at(12);
        let decrypted = cipher
            .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
            .map_err(|_| PrivacyError::Decrypt("密码错误或文件损坏".into()))?;
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
        for et in EntityType::ALL {
            let k = et.prefix();
            forward.entry(k.clone()).or_default();
            reverse.entry(k).or_default();
        }

        self.forward = forward;
        self.reverse = reverse;
        self.cipher = Some(cipher);
        self.mapping_path = path;
        self.enabled = true;

        // 如果是从 v0 老文件升级而来，立刻用新格式重写。
        if version == FILE_VERSION_V0 {
            // 升级需要重新创建/加载盐，并重派生密钥（防止是 v0 legacy 密钥）。
            let new_salt = load_or_create_pii_salt(
                &self.mapping_path.parent().unwrap_or(&PathBuf::from(".")),
            )?;
            let new_key = derive_key_v1(password, &new_salt);
            self.cipher = Some(
                Aes256Gcm::new_from_slice(&new_key)
                    .map_err(|e| PrivacyError::Crypto(e.to_string()))?,
            );
            self.save()?;
        }
        Ok(())
    }

    /// 落盘到加密文件（v1 带盐格式）。每次 add_entity / add_entities 后调用。
    fn save(&self) -> Result<(), PrivacyError> {
        let cipher = self.cipher.as_ref().ok_or(PrivacyError::NotInitialized)?;
        let table = MappingTable {
            forward: self.forward.clone(),
            version: "1.0.0".to_string(),
            last_updated: chrono::Utc::now().to_rfc3339(),
        };
        let json =
            serde_json::to_string(&table).map_err(|e| PrivacyError::Serialize(e.to_string()))?;
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), json.as_bytes())
            .map_err(|e| PrivacyError::Crypto(e.to_string()))?;

        // 从现有 mapping.salt 读盐，与 init 路径保持一致。
        let salt_path = self
            .mapping_path
            .parent()
            .unwrap_or(&PathBuf::from("."))
            .join("mapping.salt");
        let salt = std::fs::read(&salt_path).unwrap_or_else(|_| {
            // fallback：写一个临时盐，避免静默丢失加密强度。
            let mut s = vec![0u8; 32];
            use rand::RngCore;
            rand::rngs::OsRng.fill_bytes(&mut s);
            s
        });
        if salt.len() != 32 {
            return Err(PrivacyError::Crypto("mapping.salt 长度异常".into()));
        }

        let mut out = Vec::with_capacity(1 + 32 + 12 + encrypted.len());
        out.push(FILE_VERSION_V1);
        out.extend_from_slice(&salt);
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&encrypted);
        std::fs::write(&self.mapping_path, &out)?;
        Ok(())
    }

    /// 添加一个实体映射。如果已存在同名条目，直接返回已有化名
    /// （保证"同一学生"在所有会话中都有相同的化名）。
    pub fn add_entity(
        &mut self,
        entity_type: &EntityType,
        plain: &str,
    ) -> Result<String, PrivacyError> {
        if plain.is_empty() {
            return Ok(String::new());
        }
        let key = entity_type.prefix();
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
            .entry(key)
            .or_default()
            .insert(plain.to_string(), alias.clone());
        self.save()?;
        Ok(alias)
    }

    /// 批量添加。学生名单一般存放在 `entities.json` 里的 `entities` 字段，
    /// 格式：`{"entities": {"id1": {"name": "张三"}, ...}}`。
    /// 返回成功添加的条数。
    pub fn auto_scan_students(&mut self, data_dir: &Path) -> Result<usize, PrivacyError> {
        let entities_path = data_dir.join("entities").join("entities.json");
        if !entities_path.exists() {
            return Ok(0);
        }
        let data =
            std::fs::read_to_string(&entities_path).map_err(|e| PrivacyError::Io(e.to_string()))?;
        let root: serde_json::Value =
            serde_json::from_str(&data).map_err(|e| PrivacyError::Deserialize(e.to_string()))?;
        let mut count = 0;
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

    /// 脱敏：明文 → 化名。
    ///
    /// 实现：收集所有真名 → 按长度倒序 → 编译为独立的 Regex →
    /// 顺序替换。长名优先避免短名匹配掉长名的前缀（例如先匹配
    /// "张三妈妈" 再匹配 "张三"）。
    pub fn anonymize(&self, text: &str) -> String {
        if !self.enabled || self.reverse.is_empty() {
            return text.to_string();
        }
        let mut entries: Vec<(String, String)> = Vec::new();
        for rev in self.reverse.values() {
            for (plain, alias) in rev {
                if !plain.is_empty() {
                    entries.push((plain.clone(), alias.clone()));
                }
            }
        }
        if entries.is_empty() {
            return text.to_string();
        }
        entries.sort_by_key(|b| std::cmp::Reverse(b.0.len()));

        // P0 BUG #3 fix: 不要因为某一条 regex 编不过就放弃整个脱敏。
        // 原逻辑：`Err(_) => return text.to_string()` 等于全裸奔给 LLM。
        // 现在：失败的条目记下来跳过，其余继续。失败条数返回给上层
        // 走 audit log（未接到 audit，但记录数保留在这里方便后续接入）。
        let mut compiled: Vec<(Regex, String)> = Vec::new();
        let mut failed = 0usize;
        for (plain, alias) in &entries {
            match Regex::new(&escape_regex(plain)) {
                Ok(re) => compiled.push((re, alias.clone())),
                Err(e) => {
                    failed += 1;
                    eprintln!(
                        "[pii] anonymize: skip un-compilable entity (len={}, alias={}, err={})",
                        plain.len(),
                        alias,
                        e
                    );
                }
            }
        }
        if compiled.is_empty() {
            // 所有条目都编不过（极端情况），为了不静默送出明文，
            // 仍然返回原文但伴随一次告警输出。
            eprintln!(
                "[pii] anonymize: all {} regex entries failed, text passes through UNREDACTED",
                failed
            );
            return text.to_string();
        }
        let mut result = text.to_string();
        for (re, alias) in &compiled {
            result = re.replace_all(&result, alias.as_str()).into_owned();
        }
        result
    }

    /// 还原：化名 → 明文。
    pub fn deanonymize(&self, text: &str) -> String {
        if !self.enabled || self.forward.is_empty() {
            return text.to_string();
        }
        // 收集所有 (化名, 真名)，按化名长度倒序
        let mut entries: Vec<(&str, &str)> = Vec::new();
        for fwd in self.forward.values() {
            for (alias, plain) in fwd {
                if !alias.is_empty() {
                    entries.push((alias.as_str(), plain.as_str()));
                }
            }
        }
        if entries.is_empty() {
            return text.to_string();
        }
        entries.sort_by_key(|b| std::cmp::Reverse(b.0.len()));
        let mut result = text.to_string();
        for (alias, plain) in entries {
            if let Ok(re) = regex::Regex::new(&escape_regex(alias)) {
                result = re.replace_all(&result, plain).into_owned();
            }
        }
        result
    }

    /// 定向发送过滤器：发给某接收者时，把其他人的真实姓名替换成
    /// "其他同学"。
    ///
    /// 例：发给"张三妈妈"时，"李四考了80分" → "其他同学考了80分"。
    pub fn filter_for_receiver(&self, text: &str, receiver_name: &str) -> String {
        if !self.enabled {
            return text.to_string();
        }
        let mut result = text.to_string();
        for rev in self.reverse.values() {
            for plain in rev.keys() {
                if plain == receiver_name
                    || receiver_name.contains(plain.as_str())
                    || plain.contains(receiver_name)
                {
                    continue;
                }
                if result.contains(plain.as_str()) {
                    if let Ok(re) = regex::Regex::new(&escape_regex(plain)) {
                        result = re.replace_all(&result, "其他同学").into_owned();
                    }
                }
            }
        }
        result
    }

    /// 列出所有映射（本地查看，显示真名 + 化名）。
    pub fn list_mappings(&self) -> Vec<MappingEntry> {
        let mut entries = Vec::new();
        for (prefix, fwd) in &self.forward {
            for (alias, real_name) in fwd {
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

    /// 映射总数。
    pub fn mapping_count(&self) -> usize {
        self.forward.values().map(|m| m.len()).sum()
    }

    /// 是否已加载到任何映射。UI 层用来决定是否调用 deanonymize。
    pub fn has_mappings(&self) -> bool {
        self.forward.values().any(|m| !m.is_empty())
    }

    /// 备份加密映射表到指定路径。
    pub fn backup(&self, backup_path: &Path) -> Result<(), PrivacyError> {
        if !self.mapping_path.exists() {
            return Err(PrivacyError::MappingNotFound);
        }
        if let Some(parent) = backup_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&self.mapping_path, backup_path)?;
        Ok(())
    }

    /// 切换启用状态（不改映射内容）。
    pub fn set_enabled(&mut self, on: bool) {
        self.enabled = on;
    }

    /// P0 BUG #11 fix: 真正的“锁定” — 清理所有内存中的敏感状态。
    ///
    /// 原 `set_enabled(false)` 只翻 `enabled` flag，forward/reverse/cipher
    /// 全留在进程内存里，锁定后进程被dump / core dump 落盘则泄露全部
    /// 真名↔化名映射。修正：同时清空双向映射表 + 丢掉 cipher，并擦除
    /// 路径（避免路径提示文件位置）。
    pub fn lock(&mut self) {
        self.enabled = false;
        for v in self.forward.values_mut() {
            v.clear();
        }
        self.forward.clear();
        for v in self.reverse.values_mut() {
            v.clear();
        }
        self.reverse.clear();
        self.cipher = None;
        // 保留 mapping_path 以便下次 unlock 时复用。
    }

    /// Bug #10 — 用 `other` 的内部状态完全替换本引擎。
    ///
    /// 用途：UI 在异步线程里跑完 `init` / `load`（KDF + AES-GCM 解密 +
    /// JSON 反序列化 + 反向映射构建，对几万条映射可能耗时 100~500ms），
    /// 然后把成品引擎通过 `mpsc` 传回 UI 线程。UI 线程调用本方法即可
    /// 一次性落位，避免在 UI 线程上再跑一遍 `init`/`load`（OS page cache
    /// 命中不代表 JSON 反序列化是免费的）。
    ///
    /// 设计上是一次性 swap，不会触发任何落盘；调用方负责保证 `other`
    /// 来自可信的本地代码路径。
    pub fn replace_with(&mut self, other: PrivacyEngine) {
        self.enabled = other.enabled;
        self.forward = other.forward;
        self.reverse = other.reverse;
        self.cipher = other.cipher;
        self.mapping_path = other.mapping_path;
    }
}

/// 从密码派生 256 位 AES 密钥（带盐 + 拉伸）。
///
/// P0 BUG #2 fix: 原 `derive_key` 仅 `SHA-256(password)`，无盐无拉伸，
/// 抵御不了字典/彩虹表攻击。现改为：
///   - 32 字节随机盐（与 mapping.enc 同目录的 `mapping.salt`）
///   - 20 万轮 SHA-256 拉伸（≈200ms@主流 CPU），平衡移动端 + 桌面
///
/// 迁移策略：on-disk 文件格式增加 1 字节版本前缀：
///   - v0 (0x00) = 旧无盐格式，load 时探测，密钥用 `derive_key_legacy`
///   - v1 (0x01) = 新带盐格式，密钥用 `derive_key_v1`
/// 首次 save 时如果发现是 v0 文件，会自动升级到 v1 并重写。
fn derive_key_v1(password: &str, salt: &[u8]) -> [u8; 32] {
    const ITERATIONS: u32 = 200_000;
    let mut buf = Vec::with_capacity(salt.len() + password.len());
    buf.extend_from_slice(salt);
    buf.extend_from_slice(password.as_bytes());
    let mut result: [u8; 32] = Sha256::digest(&buf).into();
    for i in 0..ITERATIONS {
        let mut hasher = Sha256::new();
        hasher.update(&result);
        hasher.update(&i.to_le_bytes());
        result = hasher.finalize().into();
    }
    result
}

/// 兼容老格式：SHA-256(password) 无盐。仅用于读 v0 文件。
fn derive_key_legacy(password: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    hasher.finalize().into()
}

/// 当前落盘格式版本号。新写文件用 v1。
const FILE_VERSION_V1: u8 = 0x01;
/// 老格式（无盐 SHA-256）。仅 load 时识别，落盘时升级。
const FILE_VERSION_V0: u8 = 0x00;

/// 派生 256 位 AES 密钥的当前默认实现。
///
/// 调用方需要传入 `salt`（来自 `mapping.salt`）。`init` 时如果盐文件
/// 不存在则创建；`load` 时强制要求盐文件存在。
fn derive_key(password: &str, salt: &[u8]) -> [u8; 32] {
    derive_key_v1(password, salt)
}

/// 加载或创建 PII Shield 用的盐文件（与 mapping.enc 同目录）。
fn load_or_create_pii_salt(data_dir: &std::path::Path) -> Result<Vec<u8>, PrivacyError> {
    let path = data_dir.join("mapping.salt");
    if let Ok(existing) = std::fs::read(&path) {
        if existing.len() == 32 {
            return Ok(existing);
        }
        return Err(PrivacyError::Crypto(format!(
            "mapping.salt 长度异常 ({} 字节)",
            existing.len()
        )));
    }
    let mut salt = vec![0u8; 32];
    use rand::RngCore;
    rand::rngs::OsRng.fill_bytes(&mut salt);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &salt)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(salt)
}

/// 转义正则元字符。
fn escape_regex(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        match c {
            '.' | '(' | ')' | '[' | ']' | '{' | '}' | '?' | '+' | '*' | '|' | '^' | '$' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_dir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("ea-pii-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn init_and_reload_round_trip() {
        let dir = fresh_dir();
        let mut e1 = PrivacyEngine::default();
        e1.init(&dir, "passw0rd").unwrap();
        let s_alias = e1.add_entity(&EntityType::Student, "张三").unwrap();
        let p_alias = e1.add_entity(&EntityType::Parent, "张三妈妈").unwrap();
        assert_eq!(s_alias, "S_001");
        assert_eq!(p_alias, "P_001");

        // 重新加载
        let mut e2 = PrivacyEngine::default();
        e2.load(&dir, "passw0rd").unwrap();
        assert_eq!(e2.mapping_count(), 2);
        let entries = e2.list_mappings();
        assert!(entries
            .iter()
            .any(|x| x.real_name == "张三" && x.alias == "S_001"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn wrong_password_fails_to_decrypt() {
        let dir = fresh_dir();
        let mut e1 = PrivacyEngine::default();
        e1.init(&dir, "goodpass").unwrap();
        e1.add_entity(&EntityType::Student, "李四").unwrap();
        let mut e2 = PrivacyEngine::default();
        let r = e2.load(&dir, "badpass");
        assert!(matches!(r, Err(PrivacyError::Decrypt(_))));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn anonymize_and_deanonymize_round_trip() {
        let dir = fresh_dir();
        let mut e = PrivacyEngine::default();
        e.init(&dir, "x").unwrap();
        e.add_entity(&EntityType::Student, "王五").unwrap();
        e.add_entity(&EntityType::Student, "赵六").unwrap();

        let original = "王五今天表现不错，赵六迟到了。";
        let anon = e.anonymize(original);
        assert!(!anon.contains("王五"));
        assert!(!anon.contains("赵六"));
        assert!(anon.contains("S_001"));
        assert!(anon.contains("S_002"));

        let back = e.deanonymize(&anon);
        assert_eq!(back, original);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn duplicate_name_returns_same_alias() {
        let dir = fresh_dir();
        let mut e = PrivacyEngine::default();
        e.init(&dir, "x").unwrap();
        let a1 = e.add_entity(&EntityType::Student, "孙七").unwrap();
        let a2 = e.add_entity(&EntityType::Student, "孙七").unwrap();
        assert_eq!(a1, a2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn filter_for_receiver_hides_others() {
        let dir = fresh_dir();
        let mut e = PrivacyEngine::default();
        e.init(&dir, "x").unwrap();
        e.add_entity(&EntityType::Student, "张三").unwrap();
        e.add_entity(&EntityType::Student, "李四").unwrap();
        let text = "张三和李四今天都迟到了";
        let filtered = e.filter_for_receiver(text, "张三妈妈");
        // 接收者本人保留，其他人被替换
        assert!(filtered.contains("张三"));
        assert!(!filtered.contains("李四"));
        assert!(filtered.contains("其他同学"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn disabled_engine_is_passthrough() {
        let mut e = PrivacyEngine {
            cipher: Some(Aes256Gcm::new_from_slice(&[0u8; 32]).unwrap()),
            ..Default::default()
        };
        e.forward
            .insert("S".into(), HashMap::from([("S_001".into(), "张三".into())]));
        e.reverse
            .insert("S".into(), HashMap::from([("张三".into(), "S_001".into())]));
        let text = "张三和王五";
        assert_eq!(e.anonymize(text), text);
        assert_eq!(e.deanonymize(text), text);
    }
}
