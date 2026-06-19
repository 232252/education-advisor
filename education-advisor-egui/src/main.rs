//! Education Advisor — commercial-grade egui desktop application.
//!
//! Architecture: a single-threaded egui UI on the main thread, fully decoupled
//! from a background tokio runtime via lock-free channels. All AI inference,
//! tool calls and network requests run off the render loop, keeping the UI at
//! a constant 60/120fps.

#![forbid(unsafe_code)]
#![warn(clippy::all, clippy::pedantic, clippy::nursery)]
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
mod charts;
mod db;
mod llm;
mod models;
mod privacy;
mod runtime;
mod scheduler;
mod students;
mod theme;
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

    let viewport = egui::ViewportBuilder::default()
        .with_title("Education Advisor")
        .with_inner_size([1280.0, 820.0])
        .with_min_inner_size([960.0, 600.0])
        .with_icon(load_icon());

    eframe::run_native(
        "Education Advisor",
        eframe::NativeOptions {
            viewport,
            ..Default::default()
        },
        Box::new(|cc| Box::new(app::App::new(cc))),
    )
}

fn load_icon() -> egui::IconData {
    // A simple procedurally generated icon: a rounded gradient square with a
    // graduation-cap silhouette. Avoids shipping a binary asset.
    let size = 64usize;
    let mut rgba = Vec::with_capacity(size * size * 4);
    for y in 0..size {
        for x in 0..size {
            let t = (x + y) as f32 / (2 * size) as f32;
            let r = 90.0f32.mul_add(t, 40.0) as u8;
            let g = 120.0f32.mul_add(t, 60.0) as u8;
            let b = 100.0f32.mul_add(t, 120.0) as u8;
            // rounded corners
            let corner = 12.0;
            let mut alpha = 255u8;
            let dx = (x as f32).min((size - 1 - x) as f32);
            let dy = (y as f32).min((size - 1 - y) as f32);
            if dx < corner || dy < corner {
                let d = (dx.min(dy) - corner).max(0.0);
                alpha = (255.0 * (d / corner).clamp(0.0, 1.0)) as u8;
            }
            rgba.extend_from_slice(&[r, g, b, alpha]);
        }
    }
    egui::IconData {
        rgba,
        width: size as u32,
        height: size as u32,
    }
}
