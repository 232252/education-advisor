//! KPI card: icon + label + big value + delta + optional sparkline placeholder.

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
    /// Accent color, e.g. `Color::from_rgb(0.66, 0.33, 0.97)` for purple.
    pub accent: iced::Color,
    pub mono: bool,
}

pub fn kpi_card<'a, Message: 'a>(spec: &'a KpiSpec) -> Element<'a, Message> {
    let accent = spec.accent;
    let icon_bg = iced::Color::from_rgba(accent.r, accent.g, accent.b, 0.18);

    let icon_box = container(
        iced::widget::Svg::new(icon(spec.icon))
            .width(Length::Fixed(18.0))
            .height(Length::Fixed(18.0)),
    )
    .padding(10.0)
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Color(icon_bg)),
        border: iced::Border {
            color: iced::Color::from_rgba(accent.r, accent.g, accent.b, 0.3),
            width: 1.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: iced::Shadow::default(),
        text_color: None,
        snap: false,
    });

    let delta_tone = match spec.delta_dir {
        DeltaDir::Up => PillTone::Emerald,
        DeltaDir::Down => PillTone::Red,
        DeltaDir::Neutral => PillTone::Zinc,
    };
    let delta_pill = pill_with_dot(&spec.delta, delta_tone, false);

    let value_text = text(spec.value.clone()).size(28).color(iced::Color::WHITE);
    let label_text = text(spec.label.clone()).size(12).color(iced::Color::from_rgb(0.62, 0.65, 0.78));

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
        background: Some(iced::Background::Color(iced::Color::from_rgba(accent.r, accent.g, accent.b, 0.06))),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
            width: 1.0,
            radius: iced::border::Radius::from(16.0),
        },
        shadow: iced::Shadow {
            color: iced::Color::from_rgba(0.0, 0.0, 0.0, 0.3),
            offset: iced::Vector::new(0.0, 8.0),
            blur_radius: 24.0,
        },
        text_color: None,
        snap: false,
    })
    .into()
}

