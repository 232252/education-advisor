//! Reusable UI components, each as a small focused module.
//!
//! Every component takes the data it needs plus a `&Theme` and returns an
//! `Element<'a, Message>`. Components never touch `App` directly — that keeps
//! them testable in isolation and makes the data flow obvious at the call
//! site.

pub mod agent_card;
pub mod badge;
pub mod capsule_bar;
pub mod empty_state;
pub mod kpi;
pub mod score_bar;
pub mod section_header;
pub mod sidebar_item;
pub mod theme_picker;

