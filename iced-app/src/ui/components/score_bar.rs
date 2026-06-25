//! Score row: subject label + colored bar + numeric value.
//!
//! Mirrors `.score-row` / `.score-track` / `.score-fill` from preview:
//! 18 px tall track, 6 px radius, 90 deg linear-gradient fill,
//! pct-driven width via `FillPortion`.

use iced::widget::{column, container, row, text, Container};
use iced::{Element, Length};

pub fn score_row<'a, M: 'a>(
    label: &str,
    pct: f32,
    value: &str,
    value_color: iced::Color,
    fill_from: iced::Color,
    fill_to: iced::Color,
) -> Element<'a, M> {
    let pct = pct.clamp(0.0, 100.0);
    let label_el: Element<'a, M> =
        text(label.to_string()).size(12).color(iced::Color::from_rgb(0.82, 0.84, 0.91)).into();
    let value_el: Element<'a, M> = text(value.to_string()).size(13).color(value_color).into();

    // Inner filled segment: pct of the track width.
    let fill_box: Element<'a, M> = container(iced::widget::Space::new())
        .width(Length::FillPortion(pct as u16))
        .height(Length::Fill)
        .style(move |_| iced::widget::container::Style {
            background: Some(iced::Background::Gradient(iced::Gradient::Linear(
                iced::gradient::Linear::new(iced::Degrees(90.0))
                    .add_stop(0.0, fill_from)
                    .add_stop(1.0, fill_to),
            ))),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(6.0),
            },
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        })
        .into();

    let rest_box: Element<'a, M> = container(iced::widget::Space::new())
        .width(Length::FillPortion((100.0 - pct).max(0.0) as u16))
        .height(Length::Fill)
        .into();

    let track: Element<'a, M> = container(row![fill_box, rest_box])
        .width(Length::Fill)
        .height(Length::Fixed(18.0))
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(0.4, 0.4, 0.6, 0.10))),
            border: iced::Border {
                color: iced::Color::from_rgba(0.4, 0.4, 0.6, 0.18),
                width: 1.0,
                radius: iced::border::Radius::from(6.0),
            },
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        })
        .into();

    let _ = column; // (kept for backward import compatibility)
    row![label_el, track, value_el]
        .spacing(12)
        .align_y(iced::Alignment::Center)
        .into()
}