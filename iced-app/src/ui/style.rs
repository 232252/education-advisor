//! Reusable iced style functions matching `iced-app/preview/index.html`.
//!
//! ## Design token reference (preview → iced)
//!
//! Every value below mirrors a CSS variable defined in the preview HTML.
//! The mapping preserves both the *visual identity* (color, radius,
//! shadow blur) and the *semantic role* (text-1 = brightest body, border-
//! soft = subtle separator, etc.).
//!
//! | preview token        | preview value                                       | iced equivalent                 |
//! |----------------------|-----------------------------------------------------|---------------------------------|
//! | `--bg-base`          | `#08080f` / `#f4f5fa`                               | `theme.bg`                      |
//! | `--bg-soft`          | `rgba(99,102,241,.04)` / `rgba(99,102,241,.04)`      | `theme.surface`                 |
//! | `--bg-soft-hover`    | `rgba(99,102,241,.08)`                               | `theme.surface_hover`           |
//! | `--bg-card`          | `linear-gradient(180deg,rgba(255,255,255,.045)...)` | `style::glass_card`             |
//! | `--bg-card-solid`    | `rgba(15,15,26,.78)`                                 | `theme.surface_glass`           |
//! | `--bg-elevated`      | `rgba(255,255,255,.7)`                               | `theme.elevated`                |
//! | `--border`           | `rgba(99,102,241,.12)`                               | `theme.border`                  |
//! | `--border-soft`      | `rgba(99,102,241,.07)`                               | `theme.border_soft`             |
//! | `--border-strong`    | `rgba(99,102,241,.2)`                                | `theme.border_strong`           |
//! | `--text-1`           | `#fff` / `#0f172a`                                   | `theme.text`                    |
//! | `--text-2`           | — / `#1e293b`                                        | `theme.text`                    |
//! | `--text-3`           | — / `#334155`                                        | `theme.text`                    |
//! | `--text-4`           | — / `#475569`                                        | `theme.text_dim`                |
//! | `--text-5`           | — / `#64748b`                                        | `theme.text_dim`                |
//! | `--text-6`           | — / `#94a3b8`                                        | `theme.text_faint`              |
//! | `--text-faint`       | `#4a5070` / `#cbd5e1`                                | `theme.text_faint`              |
//! | `--shadow-card`      | `0 1px 0 var inset, 0 8px 24px -8px rgba(0,0,0,.5)`  | `style::card_shadow`            |
//! | `--shadow-hover`     | `0 16px 40px -12px rgba(0,0,0,.6)`                   | hover-state shadow              |
//! | `--bg-glow-1..4`     | purple/pink/cyan/violet ambient orbs                  | `style::glow_*` helpers         |
//!
//! ## Radius scale
//!
//! | preview px | use case                                                |
//! |------------|---------------------------------------------------------|
//! |  3 px      | scrollbar thumb, slider thumb inset                     |
//! |  4 px      | kbd / code inline                                       |
//! |  5 px      | nav-badge, kbd                                           |
//! |  6 px      | capsule/score track                                     |
//! |  7 px      | kbd inner border                                         |
//! |  9 px      | nav-item                                                |
//! | 10 px      | brand-logo, kpi-icon, conv-agent                        |
//! | 11 px      | agent-card-icon                                         |
//! | 12 px      | chat-input-box, brand-version                           |
//! | 14 px      | agent-card                                              |
//! | 16 px      | card, kpi, capsule-row, score-row, student-panel        |
//! | 18 px      | empty-icon                                              |
//! | 20 px      | score-row pill-button                                   |
//!
//! ## Theme switching
//!
//! `data-theme="dark|light|auto"` mirrors the preview's `<html data-theme>`
//! attribute. The current Rust app resolves this to a concrete
//! `Theme::dark()` / `Theme::light()` at startup (see `app::detect_os_theme`)
//! and stores it on `App::theme`. The `Auto` stub is wired through the
//! `ThemeMode::Auto` variant in `models.rs` — actual OS detection lives in
//! `theme::detect_os_uses_light`.
//!
//! ## Responsive breakpoints
//!
//! preview ships at `viewport=1320` (Wide). See `responsive.rs` for the
//! three-mode abstraction (`Compact` < 900, `Medium` 900-1280, `Wide` ≥ 1280)
//! and the `width_px / padding_scale / font_scale` helpers.

use iced::widget::{button, container, pick_list, scrollable as iced_scrollable, text, text_input};
use iced::{gradient, Background, Border, Color, Degrees, Gradient, Shadow, Vector};

use crate::theme::Theme;

type Ctx = &'static Theme;

// ── Numeric scale (preview-aligned) ────────────────────────────────

/// preview-aligned radius scale, exposed for components that want to share
/// the exact rounded-corner language used in the HTML.
pub mod radius {
    pub const XS: f32 = 3.0;   // scroll thumb
    pub const SM: f32 = 5.0;   // nav-badge
    pub const MD: f32 = 9.0;   // nav-item
    pub const LG: f32 = 12.0;  // chat-input-box
    pub const XL: f32 = 14.0;  // agent-card
    pub const XXL: f32 = 16.0; // card / kpi / student-panel
    pub const HUGE: f32 = 18.0; // empty-icon
    pub const PILL: f32 = 999.0; // pill / chip
}

/// preview-aligned padding scale.
pub mod spacing {
    pub const XS: f32 = 4.0;
    pub const SM: f32 = 8.0;
    pub const MD: f32 = 12.0;
    pub const LG: f32 = 16.0;
    pub const XL: f32 = 20.0;
    pub const XXL: f32 = 24.0;
    pub const MAIN_H_PAD: f32 = 36.0; // matches `.main { padding: 28px 36px 60px }`
    pub const MAIN_TOP: f32 = 28.0;
    pub const MAIN_BOTTOM: f32 = 60.0;
}

/// preview-aligned card padding (matches `.card-pad { padding: 20px 22px }`).
pub const CARD_PAD: (f32, f32) = (20.0, 22.0);

/// 6-step text scale: text-1 (brightest) → text-6 (faintest).
/// Maps to `theme.text` / `theme.text_dim` / `theme.text_faint` for both
/// dark and light themes.
pub mod text_step {
    use iced::Color;

    /// `--text-1`: brightest (titles, KPI values). Preview dark `#fff`,
    /// light `#0f172a`.
    pub fn level_1(theme: &super::Theme) -> Color { theme.text }
    /// `--text-2`: high-emphasis body. Preview dark inherits text-1, light `#1e293b`.
    pub fn level_2(theme: &super::Theme) -> Color { theme.text }
    /// `--text-3`: default body. Preview dark inherits, light `#334155`.
    pub fn level_3(theme: &super::Theme) -> Color { theme.text }
    /// `--text-4`: secondary body, table headers. Preview dark inherits,
    /// light `#475569`. Maps to `text_dim` in dark, plain `text` in light.
    pub fn level_4(theme: &super::Theme) -> Color {
        if theme.dark { theme.text_dim } else { theme.text }
    }
    /// `--text-5`: tertiary, captions. Preview dark inherits, light `#64748b`.
    /// Always `text_dim`.
    pub fn level_5(theme: &super::Theme) -> Color { theme.text_dim }
    /// `--text-6`: faintest. Preview dark inherits, light `#94a3b8`. Always
    /// `text_faint`.
    pub fn level_6(theme: &super::Theme) -> Color { theme.text_faint }
}

/// 5-step border scale: border-soft → border-strong (plus scroll / grid
/// variants). Maps to the corresponding `theme.border_*` field.
pub mod border_step {
    use iced::Color;

    pub fn hairline(theme: &super::Theme) -> Color { theme.border_soft }
    pub fn soft(theme: &super::Theme) -> Color { theme.border_soft }
    pub fn base(theme: &super::Theme) -> Color { theme.border }
    pub fn strong(theme: &super::Theme) -> Color { theme.border_strong }
    /// scroll-thumb hover: brighter than border-strong.
    pub fn scroll_thumb(theme: &super::Theme) -> Color { theme.border_strong }
}

/// 4 ambient glow colors used by `.app-bg::before/after` and the KPI
/// hover radial. Mirrors `--bg-glow-1..4` exactly.
pub fn glow_indigo() -> Color { Color::from_rgba(99.0 / 255.0, 102.0 / 255.0, 241.0 / 255.0, 0.18) }
pub fn glow_pink() -> Color   { Color::from_rgba(236.0 / 255.0, 72.0 / 255.0, 153.0 / 255.0, 0.14) }
pub fn glow_cyan() -> Color   { Color::from_rgba(6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0, 0.12) }
pub fn glow_violet() -> Color { Color::from_rgba(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0, 0.18) }

/// Solid accent palette for foreground UI (icons, gradient dots, status
/// pills, etc.). Mirrors the preview's accent dot pairs in
/// `accent_dot_row` (settings page). All values are fully opaque.
pub mod accent {
    use iced::Color;
    pub fn violet()  -> Color { Color::from_rgb(168.0 / 255.0,  85.0 / 255.0, 247.0 / 255.0) } // #a855f7
    pub fn pink()    -> Color { Color::from_rgb(236.0 / 255.0,  72.0 / 255.0, 153.0 / 255.0) } // #ec4899
    pub fn cyan()    -> Color { Color::from_rgb(  6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0) } // #06b6d4
    pub fn blue()    -> Color { Color::from_rgb( 59.0 / 255.0, 130.0 / 255.0, 246.0 / 255.0) } // #3b82f6
    pub fn emerald() -> Color { Color::from_rgb( 16.0 / 255.0, 185.0 / 255.0, 129.0 / 255.0) } // #10b981
    pub fn amber()   -> Color { Color::from_rgb(245.0 / 255.0, 158.0 / 255.0,  11.0 / 255.0) } // #f59e0b
    pub fn red()     -> Color { Color::from_rgb(239.0 / 255.0,  68.0 / 255.0,  68.0 / 255.0) } // #ef4444
}

/// `--brand-logo` conic gradient stops. Approximated by a linear gradient
/// in iced 0.14 (which has no conic gradient primitive).
pub fn brand_logo_gradient() -> Gradient {
    Gradient::Linear(
        gradient::Linear::new(Degrees(135.0))
            .add_stop(0.0, Color::from_rgb(99.0 / 255.0, 102.0 / 255.0, 241.0 / 255.0))
            .add_stop(0.5, Color::from_rgb(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0))
            .add_stop(1.0, Color::from_rgb(236.0 / 255.0, 72.0 / 255.0, 153.0 / 255.0)),
    )
}

/// preview `linear-gradient(135deg,#a855f7,#6366f1)` for primary buttons
/// and the chat send button.
pub fn primary_gradient() -> Gradient {
    Gradient::Linear(
        gradient::Linear::new(Degrees(135.0))
            .add_stop(0.0, Color::from_rgb(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0))
            .add_stop(1.0, Color::from_rgb(99.0 / 255.0, 102.0 / 255.0, 241.0 / 255.0)),
    )
}

// ── Container styles ───────────────────────────────────────────────

/// `.card` in preview: glass surface with `--shadow-card` and 16 px radius.
pub fn card(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.surface_glass)),
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(radius::XXL),
        },
        shadow: card_shadow(theme),
        text_color: None,
        snap: false,
    }
}

/// `.card-flat`: same glass but without the inset highlight.
pub fn card_flat(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.surface)),
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(radius::XL),
        },
        shadow: Shadow {
            color: Color { a: 0.03, ..theme.shadow },
            offset: Vector::new(0.0, 2.0),
            blur_radius: 12.0,
        },
        text_color: None,
        snap: false,
    }
}

/// Lifted container style for hoverable cards.
///
/// Provides a subtle elevated base shadow; the actual hover deepening is
/// handled by wrapping the container inside a button that uses
/// [`secondary_button`] or [`card_flat`] with a `Hovered` status.
pub fn hover_lift(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.surface)),
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(radius::XL),
        },
        shadow: Shadow {
            color: Color { a: 0.06, ..theme.shadow },
            offset: Vector::new(0.0, 4.0),
            blur_radius: 32.0,
        },
        text_color: None,
        snap: false,
    }
}

pub fn elevated(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.elevated)),
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(radius::XL),
        },
        shadow: Shadow {
            color: Color { a: 0.12, ..theme.shadow },
            offset: Vector::new(0.0, 6.0),
            blur_radius: 20.0,
        },
        text_color: None,
        snap: false,
    }
}

/// `.sidebar` in preview: opaque glass with `--bg-card-solid` and 1 px
/// right border. Preview also applies `backdrop-filter: blur(20px)` which
/// iced cannot replicate exactly — we use a higher alpha glass instead.
pub fn sidebar_bg(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color {
            a: 0.6,
            ..theme.surface_glass
        })),
        border: Border {
            color: Color { a: 0.08, ..theme.border },
            width: 1.0,
            radius: iced::border::Radius::from(0.0),
        },
        shadow: Shadow::default(),
        text_color: None,
        snap: false,
    }
}

/// `.topbar` in preview: 50% alpha glass for dark, 70% for light.
pub fn topbar_bg(theme: &Theme) -> container::Style {
    let alpha = if theme.dark { 0.5 } else { 0.7 };
    container::Style {
        background: Some(Background::Color(Color {
            a: alpha,
            ..theme.surface_glass
        })),
        border: Border {
            color: Color { a: 0.08, ..theme.border },
            width: 1.0,
            radius: iced::border::Radius::from(0.0),
        },
        shadow: Shadow {
            color: Color { a: 0.04, ..theme.shadow },
            offset: Vector::new(0.0, 2.0),
            blur_radius: 12.0,
        },
        text_color: None,
        snap: false,
    }
}

pub fn badge(theme: &Theme, color: Color) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color { a: 0.12, ..color })),
        border: Border {
            color: Color { a: 0.3, ..color },
            width: 1.0,
            radius: iced::border::Radius::from(6.0),
        },
        shadow: Shadow::default(),
        text_color: Some(color),
        snap: false,
    }
}

pub fn accent_badge(theme: &Theme) -> container::Style {
    badge(theme, theme.accent)
}

pub fn scrollable(theme: &Theme) -> iced_scrollable::Style {
    let rail_bg = Color {
        a: 0.03,
        ..theme.text
    };
    let scroller_bg = Color {
        a: 0.25,
        ..theme.text
    };
    iced_scrollable::Style {
        container: container::Style::default(),
        vertical_rail: iced_scrollable::Rail {
            background: Some(Background::Color(rail_bg)),
            border: Border::default(),
            scroller: iced_scrollable::Scroller {
                background: Background::Color(scroller_bg),
                border: Border {
                    color: Color::TRANSPARENT,
                    width: 0.0,
                    radius: iced::border::Radius::from(radius::XS),
                },
            },
        },
        horizontal_rail: iced_scrollable::Rail {
            background: Some(Background::Color(rail_bg)),
            border: Border::default(),
            scroller: iced_scrollable::Scroller {
                background: Background::Color(scroller_bg),
                border: Border {
                    color: Color::TRANSPARENT,
                    width: 0.0,
                    radius: iced::border::Radius::from(radius::XS),
                },
            },
        },
        gap: None,
        auto_scroll: iced_scrollable::AutoScroll {
            background: Background::Color(Color::TRANSPARENT),
            border: Border::default(),
            shadow: Shadow::default(),
            icon: theme.text_faint,
        },
    }
}

// ── Shadows (preview-named) ────────────────────────────────────────

/// `--shadow-card`: `0 1px 0 var(--bg-soft) inset, 0 8px 24px -8px rgba(0,0,0,.5)`.
/// The inset highlight is approximated by a small downward offset; full
/// inset-shadow is not supported in iced 0.14's `Shadow` struct.
pub fn card_shadow(theme: &Theme) -> Shadow {
    let alpha = if theme.dark { 0.5 } else { 0.04 };
    Shadow {
        color: Color { a: alpha, ..Color::BLACK },
        offset: Vector::new(0.0, 8.0),
        blur_radius: 24.0,
    }
}

/// `--shadow-hover`: `0 16px 40px -12px rgba(0,0,0,.6)` (dark) /
/// `0 16px 40px -12px rgba(99,102,241,.18)` (light).
pub fn hover_shadow(theme: &Theme) -> Shadow {
    let alpha = if theme.dark { 0.6 } else { 0.18 };
    let color = if theme.dark {
        Color::BLACK
    } else {
        theme.accent // 99,102,241 family
    };
    Shadow {
        color: Color { a: alpha, ..color },
        offset: Vector::new(0.0, 16.0),
        blur_radius: 40.0,
    }
}

// ── Button styles ──────────────────────────────────────────────────

/// Solid primary button. Preview uses a `linear-gradient(135deg,#a855f7,#6366f1)`
/// fill, but we expose a flat solid variant here so non-gradient callers
/// (e.g. table row buttons) can use the same shadow language. Use
/// [`grad_button`] when you want the exact preview gradient.
pub fn primary_button(theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => theme.accent_hover,
        button::Status::Pressed => theme.accent_strong,
        _ => theme.accent,
    };
    let shadow = match status {
        button::Status::Hovered => Shadow {
            color: Color { a: 0.5, ..theme.accent },
            offset: Vector::new(0.0, 6.0),
            blur_radius: 20.0,
        },
        button::Status::Pressed => Shadow {
            color: Color { a: 0.2, ..theme.accent },
            offset: Vector::new(0.0, 1.0),
            blur_radius: 4.0,
        },
        _ => Shadow {
            color: Color { a: 0.3, ..theme.accent },
            offset: Vector::new(0.0, 3.0),
            blur_radius: 12.0,
        },
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(radius::MD),
        },
        shadow,
        snap: false,
    }
}

pub fn secondary_button(theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => theme.surface_hover,
        _ => Color { a: 0.5, ..theme.surface },
    };
    let shadow = match status {
        button::Status::Hovered => Shadow {
            color: Color { a: 0.18, ..theme.shadow },
            offset: Vector::new(0.0, 8.0),
            blur_radius: 40.0,
        },
        _ => Shadow::default(),
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: theme.text,
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(radius::MD),
        },
        shadow,
        snap: false,
    }
}

/// `.btn-ghost`: transparent in preview, surface-soft on hover.
pub fn ghost_button(theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => theme.surface_hover,
        _ => Color::TRANSPARENT,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: text_step::level_3(theme),
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(radius::MD),
        },
        shadow: Shadow::default(),
        snap: false,
    }
}

/// `.btn-danger`: `rgba(239,68,68,.12)` bg, `.3` border, `#fca5a5` text.
pub fn danger_button(theme: &Theme, status: button::Status) -> button::Style {
    let danger_red = Color::from_rgb(239.0 / 255.0, 68.0 / 255.0, 68.0 / 255.0);
    let bg = match status {
        button::Status::Hovered => Color { a: 0.9, ..danger_red },
        button::Status::Pressed => Color { a: 0.8, ..danger_red },
        _ => danger_red,
    };
    let shadow = match status {
        button::Status::Hovered => Shadow {
            color: Color { a: 0.4, ..danger_red },
            offset: Vector::new(0.0, 5.0),
            blur_radius: 16.0,
        },
        button::Status::Pressed => Shadow {
            color: Color { a: 0.2, ..danger_red },
            offset: Vector::new(0.0, 1.0),
            blur_radius: 4.0,
        },
        _ => Shadow {
            color: Color { a: 0.25, ..danger_red },
            offset: Vector::new(0.0, 3.0),
            blur_radius: 10.0,
        },
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(radius::MD),
        },
        shadow,
        snap: false,
    }
}

pub fn nav_button(theme: &Theme, active: bool, status: button::Status) -> button::Style {
    let (bg, text) = if active {
        (theme.accent_bg, theme.accent_hover)
    } else if matches!(status, button::Status::Hovered) {
        (Color { a: 0.05, ..theme.text }, theme.text)
    } else {
        (Color::TRANSPARENT, text_step::level_3(theme))
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: text,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(radius::MD),
        },
        shadow: Shadow::default(),
        snap: false,
    }
}

/// Gradient button style for primary/high-emphasis actions.
///
/// `linear-gradient(135deg,#a855f7,#6366f1)` matches the preview's
/// `.btn-primary` rule exactly. The shadow deepens and grows on hover,
/// and shrinks when pressed.
pub fn grad_button(theme: &Theme, status: button::Status) -> button::Style {
    let (from, to, shadow) = match status {
        button::Status::Hovered => (
            theme.accent_hover,
            theme.accent_strong,
            Shadow {
                color: Color { a: 0.55, ..theme.accent },
                offset: Vector::new(0.0, 6.0),
                blur_radius: 20.0,
            },
        ),
        button::Status::Pressed => (
            theme.accent_strong,
            theme.accent,
            Shadow {
                color: Color { a: 0.25, ..theme.accent },
                offset: Vector::new(0.0, 1.0),
                blur_radius: 4.0,
            },
        ),
        _ => (
            theme.accent,
            theme.accent_hover,
            Shadow {
                color: Color { a: 0.4, ..theme.accent },
                offset: Vector::new(0.0, 4.0),
                blur_radius: 14.0,
            },
        ),
    };
    let bg = Gradient::Linear(
        gradient::Linear::new(Degrees(135.0))
            .add_stop(0.0, from)
            .add_stop(1.0, to),
    );
    button::Style {
        background: Some(Background::Gradient(bg)),
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(radius::MD),
        },
        shadow,
        snap: false,
    }
}

// ── Text input styles ──────────────────────────────────────────────

/// `.input` / `.select` / `.textarea` in preview: 9-px radius, 12-px
/// padding, accent focus ring `0 0 0 3px rgba(168,85,247,.12)`.
pub fn text_input_style(theme: &Theme, status: text_input::Status) -> text_input::Style {
    let (border_color, border_width) = match status {
        text_input::Status::Focused { .. } => (theme.accent, 2.0),
        text_input::Status::Hovered => (theme.border_strong, 1.0),
        _ => (theme.border, 1.0),
    };
    text_input::Style {
        background: Background::Color(theme.surface),
        border: Border {
            color: border_color,
            width: border_width,
            radius: iced::border::Radius::from(radius::MD - 3.0),
        },
        icon: theme.text_faint,
        placeholder: theme.text_faint,
        value: theme.text,
        selection: theme.accent,
    }
}

pub fn pick_list_style(theme: &Theme, _status: pick_list::Status) -> pick_list::Style {
    pick_list::Style {
        text_color: theme.text,
        placeholder_color: theme.text_faint,
        handle_color: theme.text_faint,
        background: Background::Color(theme.surface),
        border: Border {
            color: Color { a: 0.08, ..theme.border },
            width: 1.0,
            radius: iced::border::Radius::from(radius::MD - 3.0),
        },
    }
}

// ── Text styles (now preview-aligned via text_step::level_*) ───────

/// `--text-1`: brightest body / title color.
pub fn text_primary(theme: &Theme) -> text::Style {
    text::Style { color: Some(text_step::level_1(theme)) }
}

/// `--text-3`: default body. Same value as primary in both themes, but kept
/// as a separate symbol for readability at the call site.
pub fn text_dim(theme: &Theme) -> text::Style {
    text::Style { color: Some(text_step::level_3(theme)) }
}

/// `--text-5` / `--text-6`: muted captions and faint hints.
pub fn text_faint(theme: &Theme) -> text::Style {
    text::Style { color: Some(text_step::level_5(theme)) }
}

/// `--accent`: brand purple/violet.
pub fn text_accent(theme: &Theme) -> text::Style {
    text::Style { color: Some(theme.accent) }
}

#[allow(dead_code)]
fn _unused_ctx(_ctx: Ctx) {}