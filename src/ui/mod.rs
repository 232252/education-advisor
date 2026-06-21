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
    pub tag_input: String,
    pub export_scope: crate::models::ExportScope,
    pub show_export_preview: bool,
    pub student_detail_tab: usize,

    // chat page
    pub new_conversation_agent: String,
    pub new_conversation_title: String,

    // scheduler page
    pub editing_task: Option<ScheduledTask>,

    // rag page
    pub rag_query: String,
    pub rag_results: Vec<(Uuid, Uuid, f32, String)>,

    // settings page
    pub editing_provider: Option<LlmProvider>,

    // PII Shield dialogs (v0.1.0-rc.1 核心隐私功能)
    pub pii_dialog: crate::ui::pii_dialog::PiiDialogState,
}
