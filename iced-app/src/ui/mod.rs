//! UI layer: each page is a pure function of `&App` → `Element<Message>`.

use std::collections::HashMap;
use uuid::Uuid;

use crate::models::{GradeEntry, LlmProvider, ScheduledTask, Student};

pub mod adaptive;
pub mod agent_history_page;
pub mod agents_page;
pub mod chat;
pub mod components;
pub mod dashboard;
pub mod icons;
pub mod models_page;
pub mod pii_dialog;
pub mod privacy_page;
pub mod rag_page;
pub mod responsive;
pub mod scheduler_page;
pub mod settings_page;
pub mod sidebar;
pub mod skills_page;
pub mod students;
pub mod style;
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
    pub tag_input: HashMap<Uuid, String>,
    pub export_scope: crate::models::ExportScope,
    pub show_export_preview: bool,
    pub student_detail_tab: usize,

    pub notes_draft: HashMap<Uuid, String>,
    pub notes_dirty: HashMap<Uuid, bool>,
    pub notes_focus_student: Option<Uuid>,

    // chat page
    pub new_conversation_agent: String,
    pub new_conversation_title: String,
    pub chat_input_focused: bool,

    // agent history page
    pub history_page: usize,
    pub history_page_size: usize,

    // scheduler page
    pub editing_task: Option<ScheduledTask>,

    // rag page
    pub rag_query: String,
    pub rag_results: Vec<(Uuid, Uuid, f32, String)>,
    pub rag_adding_document: bool,
    pub rag_new_title: String,
    pub rag_new_content: String,

    // settings page
    pub editing_provider: Option<LlmProvider>,

    // PII Shield dialogs
    pub pii_dialog: pii_dialog::PiiDialogState,
}
