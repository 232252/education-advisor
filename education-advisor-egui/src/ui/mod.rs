//! UI layer: each page is a pure function of `&mut App` + `&mut Ui`.
//!
//! Page-local editing state lives in `UiState` so it survives re-renders and
//! is not reset when navigating away and back.

use std::collections::HashMap;
use uuid::Uuid;

use crate::models::{Student, GradeEntry, ScheduledTask, LlmProvider};

pub mod agents_page;
pub mod chat;
pub mod dashboard;
pub mod scheduler_page;
pub mod settings_page;
pub mod sidebar;
pub mod students_page;
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

    // chat page
    #[allow(dead_code)]
    pub new_conversation_agent: String,
    #[allow(dead_code)]
    pub new_conversation_title: String,

    // scheduler page
    pub editing_task: Option<ScheduledTask>,

    // settings page
    pub editing_provider: Option<LlmProvider>,
}
