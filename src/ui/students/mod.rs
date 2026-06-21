//! Students page: list + detail + tabs + edit dialog + import/export.
//!
//! Broken into sub-modules for readability:
//! - [`list`] — the left-hand student list panel and individual row widget
//! - [`detail`] — the right-hand detail header + tab switcher
//! - [`tabs`] — the four tab content panes (basic / grades / family / notes)
//! - [`edit`] — the modal "Edit student" dialog and the blank-student factory
//! - [`io`] — the CSV import / export side panels

use eframe::egui::Ui;

use crate::app::App;

mod detail;
mod edit;
mod io;
mod list;
mod tabs;

/// Render the full Students page into the given UI tree.
pub fn show(app: &mut App, ui: &mut Ui) {
    list::show(app, ui);
    io::show_panels(app, ui);
    edit::show_dialog(app, ui);
}
