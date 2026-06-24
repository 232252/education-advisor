//! Three-way theme picker: Dark / Light / Auto.

use iced::widget::{button, column, container, row, text, Button, Container};
use iced::{Alignment, Element, Length};

use crate::ui::icons::{icon, IconName};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeChoice {
    Dark,
    Light,
    Auto,
}

pub struct ThemePickerSpec {
    pub current: ThemeChoice,
    pub on_dark: iced::widget::button::Style,
}

pub fn theme_picker<'a, M: 'a + Clone>(current: ThemeChoice, on_pick: fn(ThemeChoice) -> M) -> Element<'a, M> {
    let cards = column![
        choice_card("🌙 深色", "dark", &current, ThemeChoice::Dark, on_pick),
        choice_card("☀ 浅色", "light", &current, ThemeChoice::Light, on_pick),
        choice_card("⚙ 跟随系统", "auto", &current, ThemeChoice::Auto, on_pick),
    ]
    .spacing(8);

    cards.into()
}

fn choice_card<'a, M: 'a + Clone>(
    label: &str,
    sub: &str,
    current: &ThemeChoice,
    this: ThemeChoice,
    on_pick: fn(ThemeChoice) -> M,
) -> Element<'a, M> {
    let is_current = *current == this;
    let bg = if is_current {
        if matches!(this, ThemeChoice::Light) {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.95)
        } else {
            iced::Color::from_rgba(0.05, 0.05, 0.10, 0.95)
        }
    } else if matches!(this, ThemeChoice::Light) {
        iced::Color::from_rgba(0.98, 0.98, 0.98, 1.0)
    } else if matches!(this, ThemeChoice::Dark) {
        iced::Color::from_rgba(0.10, 0.11, 0.20, 1.0)
    } else {
        // Auto: half-half, simulate via a 2-stop gradient
        iced::Color::from_rgba(0.55, 0.55, 0.55, 1.0)
    };
    let border = if is_current {
        iced::Color::from_rgba(0.66, 0.33, 0.97, 1.0)
    } else {
        iced::Color::from_rgba(0.39, 0.40, 0.50, 0.20)
    };
    let label_color = if is_current && matches!(this, ThemeChoice::Light) {
        iced::Color::from_rgb(0.21, 0.25, 0.34)
    } else if is_current || matches!(this, ThemeChoice::Dark) || matches!(this, ThemeChoice::Auto) {
        iced::Color::WHITE
    } else {
        iced::Color::from_rgb(0.21, 0.25, 0.34)
    };
    let sub_color = if is_current && matches!(this, ThemeChoice::Light) {
        iced::Color::from_rgb(0.58, 0.64, 0.72)
    } else if is_current || matches!(this, ThemeChoice::Dark) || matches!(this, ThemeChoice::Auto) {
        iced::Color::from_rgba(1.0, 1.0, 1.0, 0.55)
    } else {
        iced::Color::from_rgb(0.58, 0.64, 0.72)
    };

    let content = column![
        text(label.to_string()).size(12).color(label_color),
        text(sub.to_string()).size(10).color(sub_color),
    ]
    .align_x(Alignment::Center)
    .spacing(2);

    button(
        container(content)
            .width(Length::Fill)
            .padding(14)
            .align_x(Alignment::Center)
            .style(move |_| iced::widget::container::Style {
                background: Some(iced::Background::Color(bg)),
                border: iced::Border { color: border, width: if is_current { 2.0 } else { 1.0 }, radius: iced::border::Radius::from(10.0) },
                shadow: iced::Shadow::default(),
                text_color: Some(label_color),
                snap: false,
            }),
    )
    .on_press(on_pick(this))
    .padding(0)
    .style(|_t, status| {
        let bg = if matches!(status, button::Status::Hovered) {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.05)
        } else {
            iced::Color::TRANSPARENT
        };
        button::Style {
            background: Some(iced::Background::Color(bg)),
            text_color: iced::Color::WHITE,
            border: iced::Border { color: iced::Color::TRANSPARENT, width: 0.0, radius: iced::border::Radius::from(10.0) },
            shadow: iced::Shadow::default(),
            snap: false,
        }
    })
    .into()
}

