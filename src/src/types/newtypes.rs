//! Newtype 包装——防止裸类型混用

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// 学生ID（防止和其他 String 混用）
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StudentId(pub String);

impl StudentId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for StudentId {
    fn from(s: String) -> Self {
        StudentId(s)
    }
}

impl std::fmt::Display for StudentId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// 事件ID（UUID v4，避免并发冲突）
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EventId(pub String);

impl EventId {
    pub fn generate() -> Self {
        EventId(format!("evt_{}", uuid::Uuid::new_v4()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for EventId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// 教师ID
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TeacherId(pub String);

/// 【类型安全的分数变化量】
/// 
/// 业务规则：
/// - 单次变化绝对值不超过 10
/// - 不允许 0 分变化
/// - 范围: (-10.0, 10.0) \ {0.0}
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub struct ScoreDelta(f64);

impl ScoreDelta {
    pub const MAX_ABS: f64 = 10.0;

    pub fn new(value: f64) -> Result<Self, String> {
        if value == 0.0 {
            return Err("单次分值变化不能为 0".to_string());
        }
        if value.abs() > Self::MAX_ABS {
            return Err(format!(
                "单次分值变化不能超过 ±{}，当前传入: {}",
                Self::MAX_ABS, value
            ));
        }
        Ok(ScoreDelta(value))
    }

    pub fn value(&self) -> f64 {
        self.0
    }

    /// 强制创建（用于从旧数据迁移，跳过校验）
    pub fn force(value: f64) -> Self {
        ScoreDelta(value)
    }
}

impl<'de> Deserialize<'de> for ScoreDelta {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw: f64 = f64::deserialize(deserializer)?;
        ScoreDelta::new(raw).map_err(serde::de::Error::custom)
    }
}

impl Serialize for ScoreDelta {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.0.serialize(serializer)
    }
}

impl std::fmt::Display for ScoreDelta {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:+.1}", self.0)
    }
}
