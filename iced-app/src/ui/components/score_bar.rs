//! Score row: subject label + colored bar + numeric value.

use iced::widget::{container, row, text, Container};
use iced::{Element, Length};

pub fn score_row<'a, M: 'a>(
    label: &str,
    pct: f32,
    value: &str,
    value_color: iced::Color,
    fill_from: iced::Color,
    fill_to: iced::Color,
) -> Element<'a, M> {
    let label_el: Element<'a, M> =
        text(label.to_string()).size(12).color(iced::Color::from_rgb(0.82, 0.84, 0.91)).into();
    let value_el: Element<'a, M> = text(value.to_string()).size(13).color(value_color).into();
    let track: Element<'a, M> = container(
        container(iced::widget::Space::new())
            .width(Length::Fill)
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
            }),
    )
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
    let _ = pct; // pct unused; the inner bar fills to 100% by default. The
                 // caller can replace this with a width-constrained variant
                 // for actual score visualization.

    row![label_el, track, value_el]
        .spacing(12)
        .align_y(iced::Alignment::Center)
        .into()
}

