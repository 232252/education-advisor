//! 严格枚举定义——穷尽所有合法值，杜绝拼写错误

use serde::{Deserialize, Serialize};

// ─── 纪律类别 ───

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DisciplineCategory {
    SpeakInClass,
    SleepInClass,
    Late,
    SchoolCaught,
    Makeup,
    DeskUnaligned,
    PhoneInClass,
    Smoking,
    DrinkingDorm,
    OtherDeduct,
    AppearanceViolation,
    // 实验室类
    LabEquipmentDamage,
    LabSafetyViolation,
    LabUnsafeBehavior,
    LabCleanUp,
}

impl std::fmt::Display for DisciplineCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", serde_json::to_value(self).unwrap().as_str().unwrap())
    }
}

// ─── 加分类别 ───

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BonusCategory {
    BonusVariable,
    ActivityParticipation,
    ClassMonitor,
    ClassCommittee,
    CivilizedDorm,
    MonthlyAttendance,
}

impl std::fmt::Display for BonusCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", serde_json::to_value(self).unwrap().as_str().unwrap())
    }
}

// ─── 严重程度 ───

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Minor,
    Major,
    Critical,
}

// ─── 地点 ───

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Location {
    Classroom,
    Playground,
    Dormitory,
    Lab,
    Online,
    Other,
}

// ─── 考勤状态 ───

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttendanceStatus {
    Late,
    EarlyLeave,
    Absent,
    Excused,
}

impl std::fmt::Display for AttendanceStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AttendanceStatus::Late => write!(f, "迟到"),
            AttendanceStatus::EarlyLeave => write!(f, "早退"),
            AttendanceStatus::Absent => write!(f, "旷课"),
            AttendanceStatus::Excused => write!(f, "请假"),
        }
    }
}

// ─── 事件大类 ───

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EventCategory {
    ConductDeduct,
    ConductBonus,
    Attendance,
    System,
}

// ─── 实体状态 ───

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EntityStatus {
    Active,
    Transferred,
    Suspended,
}

impl Default for EntityStatus {
    fn default() -> Self {
        EntityStatus::Active
    }
}

// ─── 心理预警级别 ───

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PsychLevel {
    Low,
    Medium,
    HighRisk,
}
