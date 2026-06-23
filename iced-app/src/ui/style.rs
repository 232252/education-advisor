//! Reusable iced style functions matching the commercial design system.
//!
//! Glassmorphism + soft diffuse shadow design language: borderless surfaces,
//! large radii, translucent glass backgrounds and layered diffuse shadows.

use iced::widget::{button, container, pick_list, scrollable as iced_scrollable, text, text_input};
use iced::{gradient, Background, Border, Color, Degrees, Gradient, Shadow, Vector};

use crate::theme::Theme;

type Ctx = &'static Theme;

// ── Container styles ───────────────────────────────────────────────

pub fn card(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.surface_glass)),
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(20.0),
        },
        shadow: Shadow {
            color: Color { a: 0.06, ..theme.shadow },
            offset: Vector::new(0.0, 8.0),
            blur_radius: 32.0,
        },
        text_color: None,
        snap: false,
    }
}

pub fn card_flat(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.surface)),
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(16.0),
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
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(16.0),
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
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(16.0),
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

pub fn topbar_bg(theme: &Theme) -> container::Style {
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
                    radius: iced::border::Radius::from(3.0),
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
                    radius: iced::border::Radius::from(3.0),
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

// ── Button styles ──────────────────────────────────────────────────

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
            radius: iced::border::Radius::from(12.0),
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
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(12.0),
        },
        shadow,
        snap: false,
    }
}

pub fn ghost_button(theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => Color { a: 0.08, ..theme.text },
        _ => Color::TRANSPARENT,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: theme.text_dim,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: Shadow::default(),
        snap: false,
    }
}

pub fn danger_button(theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => Color { a: 0.9, ..theme.danger },
        button::Status::Pressed => Color { a: 0.8, ..theme.danger },
        _ => theme.danger,
    };
    let shadow = match status {
        button::Status::Hovered => Shadow {
            color: Color { a: 0.4, ..theme.danger },
            offset: Vector::new(0.0, 5.0),
            blur_radius: 16.0,
        },
        button::Status::Pressed => Shadow {
            color: Color { a: 0.2, ..theme.danger },
            offset: Vector::new(0.0, 1.0),
            blur_radius: 4.0,
        },
        _ => Shadow {
            color: Color { a: 0.25, ..theme.danger },
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
            radius: iced::border::Radius::from(12.0),
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
        (Color::TRANSPARENT, theme.text_dim)
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: text,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: Shadow::default(),
        snap: false,
    }
}

/// Gradient button style for primary/high-emphasis actions.
///
/// Simulates a two-color overlay using a linear gradient between the accent
/// and its hover variant. The shadow deepens and grows on hover, and shrinks
/// when pressed.
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
            radius: iced::border::Radius::from(12.0),
        },
        shadow,
        snap: false,
    }
}

// ── Text input styles ──────────────────────────────────────────────

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
            radius: iced::border::Radius::from(12.0),
        },
        icon: theme.text_faint,
        placeholder: theme.text_faint,
        value: theme.text,
        selection: theme.accent,
    }
}

// ── Text styles ────────────────────────────────────────────────────

pub fn pick_list_style(theme: &Theme, _status: pick_list::Status) -> pick_list::Style {
    pick_list::Style {
        text_color: theme.text,
        placeholder_color: theme.text_faint,
        handle_color: theme.text_faint,
        background: Background::Color(theme.surface),
        border: Border {
            color: Color { a: 0.08, ..theme.border },
            width: 1.0,
            radius: iced::border::Radius::from(12.0),
        },
    }
}

pub fn text_primary(theme: &Theme) -> text::Style {
    text::Style { color: Some(theme.text) }
}

pub fn text_dim(theme: &Theme) -> text::Style {
    text::Style { color: Some(theme.text_dim) }
}

pub fn text_faint(theme: &Theme) -> text::Style {
    text::Style { color: Some(theme.text_faint) }
}

pub fn text_accent(theme: &Theme) -> text::Style {
    text::Style { color: Some(theme.accent) }
}

#[allow(dead_code)]
fn _unused_ctx(_ctx: Ctx) {}
