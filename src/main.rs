//! Education Advisor — commercial-grade egui desktop application.
//!
//! Architecture: a single-threaded egui UI on the main thread, fully decoupled
//! from a background tokio runtime via lock-free channels. All AI inference,
//! tool calls and network requests run off the render loop, keeping the UI at
//! a constant 60/120fps.

#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![warn(clippy::all)]
#![allow(
    clippy::module_name_repetitions,
    clippy::too_many_lines,
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::must_use_candidate,
    clippy::missing_errors_doc,
    clippy::missing_panics_doc,
    clippy::needless_pass_by_value,
    // egui page functions share a uniform `&mut App` signature for consistency,
    // even when a particular page only reads.
    clippy::needless_pass_by_ref_mut,
    // Lock-guard scoping in immediate-mode UI is intentionally loose; we clone
    // data out of locks before crossing closure boundaries.
    clippy::significant_drop_tightening,
    // Single-char and similar names are idiomatic in graphics/math code.
    clippy::many_single_char_names,
    clippy::similar_names,
    // Style preferences that don't affect correctness.
    clippy::option_if_let_else,
    clippy::while_let_loop,
)]

mod agents;
mod ai;
mod app;
mod audit;
mod charts;
mod db;
mod embedding;
mod llm;
mod models;
mod pii_shield;
mod privacy;
mod runtime;
mod scheduler;
mod students;
mod theme;
mod tools;
mod tray;
mod ui;
mod util;

use eframe::egui;

fn main() -> eframe::Result<()> {
    // Redirect panics to a graceful log instead of aborting the window process
    // in a way that hides the cause. `panic = abort` keeps binaries small, but
    // we still want the message on stderr.
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[FATAL] {info}");
    }));

    // Restore persisted window geometry if available.
    let settings = load_settings();
    let mut viewport = egui::ViewportBuilder::default()
        .with_title("Education Advisor")
        .with_inner_size([1280.0, 820.0])
        .with_min_inner_size([960.0, 600.0])
        .with_icon(load_icon());
    if let Some(r) = settings.window_rect.as_ref() {
        if r.w >= 600.0 && r.h >= 400.0 {
            // Guard against absurdly small "saved" rects that would
            // otherwise pop the window into an unusable corner of the
            // screen.
            viewport = viewport
                .with_inner_size([r.w, r.h])
                .with_position([r.x, r.y]);
        }
    }

    eframe::run_native(
        "Education Advisor",
        eframe::NativeOptions {
            viewport,
            ..Default::default()
        },
        Box::new(|cc| Box::new(app::App::new(cc))),
    )
}

fn load_settings() -> crate::models::Settings {
    let db_path = db_path();
    if let Ok(db) = crate::db::Db::open(&db_path) {
        db.load_settings().unwrap_or_default()
    } else {
        crate::models::Settings::default()
    }
}

fn load_icon() -> egui::IconData {
    let (rgba, width, height) = crate::theme::app_icon_rgba();
    egui::IconData {
        rgba,
        width,
        height,
    }
}

fn db_path() -> std::path::PathBuf {
    let mut p = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    p.push("education-advisor");
    let _ = std::fs::create_dir_all(&p);
    p.push("ea.db");
    p
}
