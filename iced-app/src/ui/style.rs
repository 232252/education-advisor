//! Reusable iced style functions matching the commercial design system.

use iced::widget::{button, container, pick_list, scrollable as iced_scrollable, text, text_input};
use iced::{Background, Border, Color, Shadow, Vector};

use crate::theme::Theme;

type Ctx = &'static Theme;

// ── Container styles ───────────────────────────────────────────────

pub fn card(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.surface_glass)),
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(16.0),
        },
        shadow: Shadow {
            color: theme.shadow,
            offset: Vector::new(0.0, 4.0),
            blur_radius: 20.0,
        },
        text_color: None,
        snap: false,
    }
}

pub fn card_flat(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.surface)),
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(12.0),
        },
        shadow: Shadow::default(),
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
            radius: iced::border::Radius::from(12.0),
        },
        shadow: Shadow {
            color: theme.shadow,
            offset: Vector::new(0.0, 2.0),
            blur_radius: 10.0,
        },
        text_color: None,
        snap: false,
    }
}

pub fn sidebar_bg(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.bg_elevated)),
        border: Border::default(),
        shadow: Shadow::default(),
        text_color: None,
        snap: false,
    }
}

pub fn topbar_bg(theme: &Theme) -> container::Style {
    container::Style {
        background: Some(Background::Color(theme.bg_elevated)),
        border: Border {
            color: theme.border,
            width: 0.0,
            radius: iced::border::Radius::from(0.0),
        },
        shadow: Shadow {
            color: theme.shadow,
            offset: Vector::new(0.0, 2.0),
            blur_radius: 8.0,
        },
        text_color: None,
        snap: false,
    }
}

pub fn badge(theme: &Theme, color: Color) -> container::Style {
    container::Style {
        background: Some(Background::Color(Color {
            a: 0.15,
            ..color
        })),
        border: Border {
            color: Color { a: 0.3, ..color },
            width: 1.0,
            radius: iced::border::Radius::from(8.0),
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
    iced_scrollable::Style {
        container: container::Style::default(),
        vertical_rail: iced_scrollable::Rail {
            background: None,
            border: Border::default(),
            scroller: iced_scrollable::Scroller {
                background: Background::Color(theme.border_strong),
                border: Border::default(),
            },
        },
        horizontal_rail: iced_scrollable::Rail {
            background: None,
            border: Border::default(),
            scroller: iced_scrollable::Scroller {
                background: Background::Color(theme.border_strong),
                border: Border::default(),
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
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: Shadow {
            color: Color { a: 0.3, ..theme.accent },
            offset: Vector::new(0.0, 2.0),
            blur_radius: 8.0,
        },
        snap: false,
    }
}

pub fn secondary_button(theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => theme.surface_hover,
        _ => theme.surface,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: theme.text,
        border: Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: Shadow::default(),
        snap: false,
    }
}

pub fn ghost_button(theme: &Theme, status: button::Status) -> button::Style {
    let bg = match status {
        button::Status::Hovered => theme.surface_hover,
        _ => Color::TRANSPARENT,
    };
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: theme.text_dim,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(8.0),
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
    button::Style {
        background: Some(Background::Color(bg)),
        text_color: Color::WHITE,
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: Shadow::default(),
        snap: false,
    }
}

pub fn nav_button(theme: &Theme, active: bool, status: button::Status) -> button::Style {
    let (bg, text) = if active {
        (theme.accent_dim, theme.accent_hover)
    } else if matches!(status, button::Status::Hovered) {
        (theme.surface_hover, theme.text)
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

// ── Text input styles ──────────────────────────────────────────────

pub fn text_input_style(theme: &Theme, status: text_input::Status) -> text_input::Style {
    let border_color = match status {
        text_input::Status::Focused { .. } => theme.accent,
        text_input::Status::Hovered => theme.border_strong,
        _ => theme.border,
    };
    text_input::Style {
        background: Background::Color(theme.surface),
        border: Border {
            color: border_color,
            width: if matches!(status, text_input::Status::Focused { .. }) {
                2.0
            } else {
                1.0
            },
            radius: iced::border::Radius::from(10.0),
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
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(10.0),
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
