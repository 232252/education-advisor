//! Education Advisor — commercial-grade iced desktop application.
//!
//! Architecture: a single-threaded iced UI on the main thread, fully decoupled
//! from a background tokio runtime via lock-free channels. All AI inference,
//! tool calls and network requests run off the render loop, keeping the UI
//! responsive.

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
    clippy::needless_pass_by_ref_mut,
    clippy::significant_drop_tightening,
    clippy::many_single_char_names,
    clippy::similar_names,
    clippy::option_if_let_else,
    clippy::while_let_loop,
)]

mod agents;
mod ai;
mod app;
mod audit;
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
mod ui;
mod util;

use iced::window;

pub fn main() -> iced::Result {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[FATAL] {info}");
    }));

    iced::application(app::App::new, app::App::update, app::App::view)
        .title("Education Advisor")
        .theme(app::App::theme)
        .subscription(app::App::subscription)
        .window(window::Settings {
            size: iced::Size::new(1280.0, 820.0),
            min_size: Some(iced::Size::new(960.0, 600.0)),
            resizable: true,
            decorations: true,
            ..Default::default()
        })
        .run()
}
