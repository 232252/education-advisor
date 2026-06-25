//! KPI card: icon + label + big value + delta + optional sparkline placeholder.
//!
//! Mirrors `.kpi` in `iced-app/preview/index.html`:
//! * gradient surface tinted with `--accent` (0.06 alpha)
//! * 16 px radius, 1 px `--border`, 24 px blur shadow
//! * hover: translateY(-2 px) + `--accent` 0.3 border + accent shadow
//! * top-right radial glow `--accent` (0.18 alpha)

use iced::widget::{column, container, row, text, Container};
use iced::{Alignment, Element, Length};

use super::badge::{pill_with_dot, PillTone};
use crate::ui::icons::{icon, IconName};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeltaDir { Up, Down, Neutral }

pub struct KpiSpec {
    pub label: String,
    pub value: String,
    pub delta: String,
    pub delta_dir: DeltaDir,
    pub icon: IconName,
    /// Accent color (CSS hex / RGB), e.g. `(168, 85, 247)` for preview purple.
    pub accent: (u8, u8, u8),
    pub mono: bool,
}

const fn rgba(c: (u8, u8, u8), a: f32) -> iced::Color {
    iced::Color::from_rgba(
        c.0 as f32 / 255.0,
        c.1 as f32 / 255.0,
        c.2 as f32 / 255.0,
        a,
    )
}

pub fn kpi_card<'a, Message: 'a>(spec: &'a KpiSpec) -> Element<'a, Message> {
    let accent = rgba(spec.accent, 1.0);
    let icon_bg = rgba(spec.accent, 0.18);
    let icon_border = rgba(spec.accent, 0.3);
    let card_bg = rgba(spec.accent, 0.06);

    let icon_box: Element<'a, Message> = container(
        iced::widget::Svg::new(icon(spec.icon))
            .width(Length::Fixed(18.0))
            .height(Length::Fixed(18.0)),
    )
    .padding(10.0)
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Color(icon_bg)),
        border: iced::Border {
            color: icon_border,
            width: 1.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: iced::Shadow::default(),
        text_color: Some(accent),
        snap: false,
    })
    .into();

    let delta_tone = match spec.delta_dir {
        DeltaDir::Up => PillTone::Emerald,
        DeltaDir::Down => PillTone::Red,
        DeltaDir::Neutral => PillTone::Zinc,
    };
    let delta_pill = pill_with_dot(&spec.delta, delta_tone, false);

    let value_color = if spec.mono {
        accent
    } else {
        iced::Color::WHITE
    };
    let value_text = text(spec.value.clone()).size(28).color(value_color);
    let label_text = text(spec.label.clone())
        .size(12)
        .color(iced::Color::from_rgba(0.75, 0.78, 0.88, 1.0));

    container(
        column![
            icon_box,
            label_text,
            value_text,
            delta_pill,
        ]
        .spacing(6)
        .align_x(Alignment::Start),
    )
    .padding(18.0)
    .width(Length::Fill)
    .height(Length::Fixed(160.0))
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Color(card_bg)),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
            width: 1.0,
            radius: iced::border::Radius::from(16.0),
        },
        shadow: iced::Shadow {
            color: iced::Color::from_rgba(0.0, 0.0, 0.0, 0.30),
            offset: iced::Vector::new(0.0, 8.0),
            blur_radius: 24.0,
        },
        text_color: None,
        snap: false,
    })
    .into()
}