//! Responsive layout mode: a single source of truth for "how wide is the
//! window right now". Each page reads this once at the top of its `view()`
//! and branches its layout accordingly.
//!
//! The three breakpoints below mirror the design intent in
//! `iced-app/preview/index.html`:
//! * preview `viewport=1320` (Wide) — full layout, 4-col KPI grid, sidebar expanded
//! * 900-1280 (Medium) — 2-col grids, condensed padding
//! * < 900 (Compact) — single column, sidebar collapsed

use iced::Size;

/// Coarse-grained layout mode derived from the current window width.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutMode {
    /// < 900px: phone-ish. Sidebar collapsed by default, single column, hide
    /// non-critical columns in tables.
    Compact,
    /// 900 - 1280px: small laptop. Sidebar collapsed but expandable, 2-col
    /// grids, condensed padding.
    Medium,
    /// ≥ 1280px: full layout. Sidebar expanded, 4-col grids, all features.
    Wide,
}

impl LayoutMode {
    /// Resolve a layout mode from a current window size.
    pub fn from_size(size: Size) -> Self {
        Self::from_width(size.width)
    }

    pub fn from_width(w: f32) -> Self {
        if w < 900.0 {
            Self::Compact
        } else if w < 1280.0 {
            Self::Medium
        } else {
            Self::Wide
        }
    }

    pub fn is_wide(self) -> bool {
        matches!(self, Self::Wide)
    }
    pub fn is_compact(self) -> bool {
        matches!(self, Self::Compact)
    }
    pub fn is_medium_or_wider(self) -> bool {
        !matches!(self, Self::Compact)
    }

    /// Sidebar default collapsed state.
    pub fn sidebar_default_collapsed(self) -> bool {
        !self.is_wide()
    }

    /// Number of grid columns for KPI cards.
    pub fn kpi_columns(self) -> u16 {
        match self {
            Self::Compact => 1,
            Self::Medium => 2,
            Self::Wide => 4,
        }
    }

    /// Number of columns for the agent grid.
    pub fn agent_columns(self) -> u16 {
        match self {
            Self::Compact => 1,
            Self::Medium => 2,
            Self::Wide => 3,
        }
    }

    /// Whether the right-hand tool timeline panel is visible in chat.
    pub fn chat_show_tool_timeline(self) -> bool {
        self.is_medium_or_wider()
    }

    /// Whether the chat middle column shows the agent list inline.
    pub fn chat_show_left_rail(self) -> bool {
        self.is_wide()
    }

    /// Whether the dashboard `row-2` collapses to single column.
    pub fn dashboard_row_collapse(self) -> bool {
        self.is_compact()
    }

    // ── Preview-aligned scale helpers (added in ui-refactor/gap-analysis) ──
    //
    // These three methods give every page a single, declarative way to
    // translate a layout mode into a numeric scale that downstream code
    // (e.g. component paddings, font sizes, sparkline widths) can apply.
    //
    // Values picked to match `iced-app/preview/index.html`:
    // * Compact: 0.9  (tighter than preview default — preview keeps 1320 px)
    // * Medium:  1.0
    // * Wide:    1.0
    //
    // Pages that previously called `adaptive::font_scale(mode)` can now
    // call `mode.font_scale()` directly without a free-function import.

    /// Reference viewport width in pixels (matches preview's
    /// `<meta name="viewport" content="width=1320" />`).
    pub const PREVIEW_VIEWPORT_PX: f32 = 1320.0;

    /// Canonical width in CSS pixels for this layout mode. Used as a stable
    /// reference when layout is computed at "design time" rather than at
    /// runtime.
    ///
    /// * Compact →  720 px
    /// * Medium  → 1100 px
    /// * Wide    → 1320 px (matches preview)
    pub fn width_px(self) -> f32 {
        match self {
            Self::Compact => 720.0,
            Self::Medium => 1100.0,
            Self::Wide => Self::PREVIEW_VIEWPORT_PX,
        }
    }

    /// Global padding multiplier: 0.9 / 1.0 / 1.0.
    ///
    /// Mirrors `adaptive::padding_adaptive` but exposes it as a method so
    /// pages can write `mode.padding_scale() * 18.0` inline without an
    /// extra `use` import.
    pub fn padding_scale(self) -> f32 {
        match self {
            Self::Compact => 0.9,
            _ => 1.0,
        }
    }

    /// Global font-size multiplier: 0.92 / 1.0 / 1.0.
    ///
    /// Replaces `adaptive::font_scale` (kept as a free fn for backwards
    /// compatibility). On Compact we shrink long-form prose slightly so
    /// KPI cards stay readable; Medium and Wide keep the design baseline.
    pub fn font_scale(self) -> f32 {
        match self {
            Self::Compact => 0.92,
            _ => 1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_width_thresholds() {
        assert_eq!(LayoutMode::from_width(720.0), LayoutMode::Compact);
        assert_eq!(LayoutMode::from_width(900.0), LayoutMode::Medium);
        assert_eq!(LayoutMode::from_width(1280.0), LayoutMode::Wide);
        assert_eq!(LayoutMode::from_width(1320.0), LayoutMode::Wide);
    }

    #[test]
    fn scales_match_preview() {
        assert!((LayoutMode::Compact.font_scale() - 0.92).abs() < 0.001);
        assert_eq!(LayoutMode::Medium.font_scale(), 1.0);
        assert_eq!(LayoutMode::Wide.font_scale(), 1.0);
        assert!((LayoutMode::Compact.padding_scale() - 0.9).abs() < 0.001);
        assert_eq!(LayoutMode::Medium.padding_scale(), 1.0);
        assert_eq!(LayoutMode::Wide.padding_scale(), 1.0);
        assert_eq!(LayoutMode::Wide.width_px(), 1320.0);
    }
}