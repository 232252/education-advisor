//! Domain models shared across the whole application.
//!
//! All types are `Serialize`/`Deserialize` so they can flow losslessly from the
//! UI -> privacy engine -> AI orchestrator -> `SQLite` and back to UI charts.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use uuid::Uuid;

/// A student record with comprehensive fields for education management.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Student {
    pub id: Uuid,
    pub name: String,
    pub gender: Option<String>,
    pub grade: String,
    pub class: String,
    pub id_number: Option<String>, // 学号/学籍号
    pub birth_date: Option<NaiveDate>,
    pub enrollment_date: Option<NaiveDate>,
    pub guardian_name: Option<String>,
    pub guardian_contact: Option<String>, // stored encrypted
    pub guardian_relation: Option<String>,
    pub home_address: Option<String>,
    pub emergency_contact: Option<String>,
    pub risk_level: RiskLevel,
    pub gpa: Option<f32>,
    pub tags: Vec<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// 备注最后修改时间 — 独立于 `updated_at`，避免备注草稿每次键入都
    /// 把整张学生表重排（详见 v0.1.0-rc.1 修复 Bug #12）。
    #[serde(default)]
    pub notes_modified_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum RiskLevel {
    #[default]
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Low => "低风险",
            Self::Medium => "中风险",
            Self::High => "高风险",
            Self::Critical => "危机",
        }
    }
    pub const fn all() -> [Self; 4] {
        [Self::Low, Self::Medium, Self::High, Self::Critical]
    }
}

/// A single grade entry for a student.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradeEntry {
    pub id: Uuid,
    pub student_id: Uuid,
    pub subject: String,
    pub score: f32,
    pub max_score: f32,
    pub exam_date: NaiveDate,
    pub recorded_at: DateTime<Utc>,
}

/// A chat conversation tied to an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: Uuid,
    pub agent_id: String,
    pub student_id: Option<Uuid>,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: Uuid,
    pub conversation_id: Uuid,
    pub role: Role,
    pub content: String,
    pub tool_calls: Vec<ToolCallRecord>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
    System,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolCallRecord {
    /// The assistant message this tool call belongs to. Combined with `name`,
    /// this uniquely identifies a tool invocation (so two `lookup_student`
    /// calls in the same turn don't collide).
    #[serde(default)]
    pub message_id: Uuid,
    pub name: String,
    pub args: String,
    pub result: String,
    pub status: ToolStatus,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
pub enum ToolStatus {
    #[default]
    Pending,
    Running,
    Success,
    Failed,
}

/// A scheduled cron task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledTask {
    pub id: Uuid,
    pub name: String,
    pub cron_expr: String,
    pub agent_id: String,
    pub prompt: String,
    pub enabled: bool,
    pub last_run: Option<DateTime<Utc>>,
    pub next_run: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// LLM provider configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub api_key: Option<String>, // stored encrypted at rest
    pub model: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProviderKind {
    OpenAi,
    Anthropic,
    Gemini,
    OpenRouter,
    Ollama,
    Custom,
}

/// Persisted application settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    pub theme: ThemeMode,
    pub active_provider_id: Option<String>,
    pub privacy_enabled: bool,
    pub max_tool_iterations: u32,
    pub temperature: f32,
    pub sidebar_collapsed: bool,
    pub window_rect: Option<WindowRect>,
    /// 启用的技能 ID 集合；为空时默认全部启用。
    pub enabled_skills: HashSet<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum ThemeMode {
    #[default]
    Dark,
    Light,
    /// Follow OS preference (Windows: `AppsUseLightTheme` registry value;
    /// macOS / Linux: best-effort detection, falls back to dark).
    Auto,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WindowRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeMode::Dark,
            active_provider_id: None,
            privacy_enabled: true,
            max_tool_iterations: 8,
            temperature: 0.4,
            sidebar_collapsed: false,
            window_rect: None,
            enabled_skills: HashSet::new(),
        }
    }
}

/// Aggregated dashboard statistics.
#[derive(Debug, Clone, Default)]
pub struct DashboardStats {
    pub total_students: usize,
    pub risk_distribution: [usize; 4],
    pub avg_gpa: f32,
    pub conversations_today: usize,
    pub tool_calls_total: usize,
    pub agent_activity: Vec<(String, u32)>,
    pub grade_trend: Vec<(String, f32)>,
}

/// A local RAG document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagDocument {
    pub id: Uuid,
    pub title: String,
    pub content: String,
    pub chunks: Vec<RagChunk>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagChunk {
    pub id: Uuid,
    pub document_id: Uuid,
    pub text: String,
    pub embedding: Vec<f32>,
}

/// Built-in provider preset so users can pick from 30+ models out of the box.
#[derive(Debug, Clone)]
pub struct ProviderPreset {
    pub name: String,
    pub kind: ProviderKind,
    pub base_url: String,
    pub model: String,
}

/// Export scope for students/grades.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExportScope {
    #[default]
    All,
    SelectedStudent,
}

/// A complete, portable snapshot of every user-visible table in the
/// database. Used by the Settings page "数据备份 / 恢复" feature.
///
/// Bump `schema_version` whenever the on-disk shape of this struct changes
/// in a non-backward-compatible way; the restore path rejects mismatched
/// versions explicitly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullBackup {
    pub schema_version: u32,
    pub created_at: DateTime<Utc>,
    pub students: Vec<Student>,
    /// `(student_id, grade)` pairs; we keep the `student_id` explicit so
    /// the backup file is self-describing even if a parent row is missing.
    pub grades: Vec<(Uuid, GradeEntry)>,
    pub conversations: Vec<Conversation>,
    pub messages: Vec<Message>,
    pub tasks: Vec<ScheduledTask>,
    pub providers: Vec<LlmProvider>,
    pub rag_documents: Vec<RagDocument>,
}

impl FullBackup {
    pub const CURRENT_SCHEMA_VERSION: u32 = 1;
}
