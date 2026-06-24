//! Responsive layout mode: a single source of truth for "how wide is the
//! window right now". Each page reads this once at the top of its `view()`
//! and branches its layout accordingly.

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
}
