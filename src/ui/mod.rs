//! UI layer: each page is a pure function of `&mut App` + `&mut Ui`.
//!
//! Page-local editing state lives in `UiState` so it survives re-renders and
//! is not reset when navigating away and back.

use std::collections::HashMap;
use uuid::Uuid;

use crate::models::{GradeEntry, LlmProvider, ScheduledTask, Student};

pub mod agent_history_page;
pub mod agents_page;
pub mod chat;
pub mod dashboard;
pub mod icons;
pub mod models_page;
pub mod pii_dialog;
pub mod privacy_page;
pub mod rag_page;
pub mod scheduler_page;
pub mod settings_page;
pub mod sidebar;
pub mod skills_page;
pub mod students;
pub mod toast;
pub mod topbar;
pub mod widgets;

#[derive(Default)]
pub struct UiState {
    // students page
    pub student_filter: String,
    pub editing_student: Option<Student>,
    pub grades: HashMap<Uuid, Vec<GradeEntry>>,
    pub new_grade_subject: String,
    pub new_grade_score: String,
    pub import_text: String,
    pub show_import: bool,
    /// Per-student 标签输入框内容（Bug #16 — 防止切换学生时残留）。
    pub tag_input: HashMap<Uuid, String>,
    pub export_scope: crate::models::ExportScope,
    pub show_export_preview: bool,
    pub student_detail_tab: usize,

    // ── 备注草稿缓存（Bug #1 — 失焦落盘，避免每键存盘）──────────
    /// 当前正在编辑的备注草稿，键为学生 id。
    pub notes_draft: HashMap<Uuid, String>,
    /// 草稿相对学生当前 `notes` 是否有修改。
    pub notes_dirty: HashMap<Uuid, bool>,
    /// 当前聚焦的备注编辑器对应的学生 id（用于跨帧判断"失焦"）。
    pub notes_focus_student: Option<Uuid>,

    // chat page
    pub new_conversation_agent: String,
    pub new_conversation_title: String,
    /// Bug #9 — 标记聊天输入框当前是否拥有焦点，供 chat_view 顶层
    /// 全局 Enter 检测使用（避免 TextEdit 吞掉键事件）。
    pub chat_input_focused: bool,
    /// Agent history 页面分页状态（Bug #18）。
    pub history_page: usize,
    pub history_page_size: usize,

    // scheduler page
    pub editing_task: Option<ScheduledTask>,

    // rag page
    pub rag_query: String,
    pub rag_results: Vec<(Uuid, Uuid, f32, String)>,

    // settings page
    pub editing_provider: Option<LlmProvider>,

    // 背景渐变渲染缓存键（Bug #3 — 避免每帧重绘 64 个矩形）。
    pub grad_bg_cache_key: Option<GradCacheKey>,
    pub grad_bg_cache_size: (f32, f32),

    // PII Shield dialogs (v0.1.0-rc.1 核心隐私功能)
    pub pii_dialog: crate::ui::pii_dialog::PiiDialogState,
}

/// 背景渐变缓存键——只有屏幕尺寸改变时才重绘。
#[derive(PartialEq, Eq, Clone, Copy, Debug)]
pub struct GradCacheKey {
    pub w: i32,
    pub h: i32,
    pub dark: bool,
}
