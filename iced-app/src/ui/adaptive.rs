//! Tiny helpers for building responsive layouts declaratively.
//!
//! Usage:
//! ```ignore
//! use crate::ui::adaptive::{if_wide, gap_adaptive, padding_adaptive};
//!
//! let p = padding_adaptive(mode);  // 16 / 20 / 28
//! column![...].padding(p).spacing(gap_adaptive(mode))
//! ```

use iced::Length;

use super::responsive::LayoutMode;

/// Adaptive padding: small on Compact, medium on Medium, generous on Wide.
pub fn padding_adaptive(mode: LayoutMode) -> f32 {
    match mode {
        LayoutMode::Compact => 16.0,
        LayoutMode::Medium => 22.0,
        LayoutMode::Wide => 28.0,
    }
}

/// Adaptive gap between siblings.
pub fn gap_adaptive(mode: LayoutMode) -> f32 {
    match mode {
        LayoutMode::Compact => 10.0,
        LayoutMode::Medium => 14.0,
        LayoutMode::Wide => 18.0,
    }
}

/// Adaptive card padding.
pub fn card_padding(mode: LayoutMode) -> f32 {
    match mode {
        LayoutMode::Compact => 14.0,
        LayoutMode::Medium => 18.0,
        LayoutMode::Wide => 20.0,
    }
}

/// Adaptive font size scaling factor: 0.92 / 1.0 / 1.0.
pub fn font_scale(mode: LayoutMode) -> f32 {
    match mode {
        LayoutMode::Compact => 0.92,
        _ => 1.0,
    }
}

/// Sidebar width by mode.
pub fn sidebar_width(mode: LayoutMode) -> f32 {
    match mode {
        LayoutMode::Compact => 64.0,  // icons only
        LayoutMode::Medium => 200.0, // icons + short labels
        LayoutMode::Wide => 248.0,    // full
    }
}

/// Topbar height (constant).
pub const TOPBAR_HEIGHT: f32 = 64.0;

/// Convenience: build a `Length::Fill` vs `Length::Shrink` for grid cells.
pub fn fill() -> Length {
    Length::Fill
}
pub fn shrink() -> Length {
    Length::Shrink
}
