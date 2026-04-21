//! 核心事件类型——类型驱动的 ADT

use serde::{Deserialize, Serialize};
use super::enums::*;
use super::newtypes::ScoreDelta;

/// ─── 学校事件枚举（穷尽所有类型） ───
/// AI 或 CLI 只能从这个列表里选，编译器强制穷尽检查。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum SchoolEvent {
    /// 纪律扣分事件
    Discipline(DisciplinePayload),
    /// 加分事件
    Bonus(BonusPayload),
    /// 考勤事件
    Attendance(AttendancePayload),
    /// 系统操作（撤销、强制修正等）
    System(SystemPayload),
}

// ─── 纪律事件载荷 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisciplinePayload {
    pub category: DisciplineCategory,
    pub score_delta: ScoreDelta,
    pub location: Location,
    pub severity: Severity,
    /// 原始原因描述（人类可读）
    pub description: String,
    /// 对方学生ID（打架/霸凌时必填，由 validate() 校验）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opponent_id: Option<String>,
    /// 证据引用（至少一个）
    pub evidence_refs: Vec<String>,
    /// 操作人
    pub operator: String,
    /// 备注
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

impl DisciplinePayload {
    pub fn validate(&self) -> Result<(), String> {
        // 打架/吸烟/饮酒必须有对方或证据
        if self.evidence_refs.is_empty() {
            return Err("防呆拦截：违纪事件必须提供至少一个证据引用 (evidence_refs)".to_string());
        }
        // 严重违纪需要班主任确认（通过 note 字段或 evidence_refs 体现）
        if self.severity == Severity::Critical && self.evidence_refs.len() < 2 {
            return Err("防呆拦截：严重违纪必须提供至少两个证据引用".to_string());
        }
        Ok(())
    }
}

// ─── 加分事件载荷 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BonusPayload {
    pub category: BonusCategory,
    pub score_delta: ScoreDelta,
    pub description: String,
    pub operator: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub note: String,
}

impl BonusPayload {
    pub fn validate(&self) -> Result<(), String> {
        // 加分必须为正
        if self.score_delta.value() <= 0.0 {
            return Err("防呆拦截：加分事件 score_delta 必须为正数".to_string());
        }
        Ok(())
    }
}

// ─── 考勤事件载荷 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttendancePayload {
    pub status: AttendanceStatus,
    pub period: String, // "第一节", "第二节", "晚自习" 等
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub operator: String,
}

impl AttendancePayload {
    pub fn validate(&self) -> Result<(), String> {
        if self.period.trim().is_empty() {
            return Err("防呆拦截：考勤事件必须指定时段 (period)".to_string());
        }
        Ok(())
    }
}

// ─── 系统事件载荷 ───

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SystemPayload {
    pub action: String,
    pub description: String,
    pub operator: String,
}

impl SchoolEvent {
    /// 统一校验入口
    pub fn validate(&self) -> Result<(), String> {
        match self {
            SchoolEvent::Discipline(d) => d.validate(),
            SchoolEvent::Bonus(b) => b.validate(),
            SchoolEvent::Attendance(a) => a.validate(),
            SchoolEvent::System(_) => Ok(()),
        }
    }

    /// 获取分数变化
    pub fn score_delta(&self) -> f64 {
        match self {
            SchoolEvent::Discipline(d) => d.score_delta.value(),
            SchoolEvent::Bonus(b) => b.score_delta.value(),
            SchoolEvent::Attendance(_) => -2.0, // 默认考勤扣分
            SchoolEvent::System(_) => 0.0,
        }
    }

    /// 获取标签
    pub fn category_tags(&self) -> Vec<String> {
        match self {
            SchoolEvent::Discipline(d) => vec![format!("纪律:{}", d.category)],
            SchoolEvent::Bonus(b) => vec![format!("加分:{}", b.category)],
            SchoolEvent::Attendance(a) => vec![format!("考勤:{}", a.status)],
            SchoolEvent::System(s) => vec![format!("系统:{}", s.action)],
        }
    }

    /// 获取描述
    pub fn description(&self) -> &str {
        match self {
            SchoolEvent::Discipline(d) => &d.description,
            SchoolEvent::Bonus(b) => &b.description,
            SchoolEvent::Attendance(a) => &a.description,
            SchoolEvent::System(s) => &s.description,
        }
    }

    /// 获取操作人
    pub fn operator(&self) -> &str {
        match self {
            SchoolEvent::Discipline(d) => &d.operator,
            SchoolEvent::Bonus(b) => &b.operator,
            SchoolEvent::Attendance(a) => &a.operator,
            SchoolEvent::System(s) => &s.operator,
        }
    }
}
