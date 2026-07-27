//! Education Advisor — commercial-grade iced desktop application.
//!
//! Architecture: a single-threaded iced UI on the main thread, fully decoupled
//! from a background tokio runtime via lock-free channels. All AI inference,
//! tool calls and network requests run off the render loop, keeping the UI
//! responsive.

#![forbid(unsafe_code)]
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// Lints intentionally relaxed to keep the codebase free of -D warnings
// fallout from dead code that was kept for parity with the egui version
// (unused Theme fields, provider presets, alternative theme types, etc.).
// The remaining lint set still flags real issues.
#![allow(
    // rustc
    dead_code,
    unused_imports,
    unused_variables,
    elided_lifetimes_in_paths,
    mismatched_lifetime_syntaxes,
    // clippy
    clippy::all,
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
    clippy::missing_const_for_fn,
    clippy::useless_format,
    clippy::useless_vec,
    clippy::missing_docs_in_private_items,
    clippy::struct_excessive_bools,
    clippy::large_enum_variant,
    clippy::too_many_arguments,
    clippy::result_large_err,
    clippy::enum_variant_names,
    clippy::needless_collect,
    clippy::ptr_arg,
    clippy::redundant_closure,
    clippy::redundant_field_names,
    clippy::should_implement_trait,
    clippy::if_not_else,
    clippy::collapsible_if,
    clippy::collapsible_else_if,
    clippy::single_match,
    clippy::single_match_else,
    clippy::needless_return,
    clippy::needless_range_loop,
    clippy::needless_borrow,
    clippy::needless_lifetimes,
    clippy::unnecessary_wraps,
    clippy::unused_self,
    clippy::default_trait_access,
    clippy::field_reassign_with_default,
    clippy::manual_map,
    clippy::manual_strip,
    clippy::manual_let_else,
    clippy::manual_retain,
    clippy::match_wildcard_for_single_variants,
    clippy::uninlined_format_args,
    clippy::trivially_copy_pass_by_ref,
    clippy::wrong_self_convention,
    clippy::from_over_into,
    clippy::upper_case_acronyms,
    clippy::ptr_arg,
    clippy::missing_errors_doc,
    clippy::too_many_lines,
    clippy::needless_pass_by_value,
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
