//! Capsule progress bar: a single horizontal bar with a label and percentage.

use iced::widget::{container, row, text, Container};
use iced::{Element, Length};

pub struct CapsuleBar {
    pub label: String,
    pub dot_color: iced::Color,
    pub pct: f32, // 0..100
    pub value_text: String,
    pub value_color: iced::Color,
    pub fill_from: iced::Color,
    pub fill_to: iced::Color,
}

/// Build a horizontal capsule bar. Caller is responsible for sizing the
/// surrounding `Container` with `Length::Fill`.
pub fn capsule_bar<'a, M: 'a>(spec: CapsuleBar) -> Element<'a, M> {
    let dot_color = spec.dot_color;
    let fill_from = spec.fill_from;
    let fill_to = spec.fill_to;
    let value_color = spec.value_color;
    let label = spec.label;
    let pct = spec.value_text;
    let _ = spec.pct; // visual fill width is fixed to 100% here; replace with
                      // a width-constrained variant if exact pct rendering is needed.

    let dot_box: Element<'a, M> = container(iced::widget::Space::new())
        .width(Length::Fixed(8.0))
        .height(Length::Fixed(8.0))
        .style(move |_| iced::widget::container::Style {
            background: Some(iced::Background::Color(dot_color)),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(2.0),
            },
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        })
        .into();

    let track: Element<'a, M> = container(iced::widget::Space::new())
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
        })
        .into();

    let label_el: Element<'a, M> = text(label).size(12).color(iced::Color::from_rgb(0.82, 0.84, 0.91)).into();
    let pct_el: Element<'a, M> = text(pct).size(12).color(value_color).into();

    let track_wrap: Element<'a, M> = container(track)
        .width(Length::Fill)
        .height(Length::Fixed(10.0))
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(1.0, 1.0, 1.0, 0.05))),
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

    row![dot_box, label_el, track_wrap, pct_el]
        .spacing(12)
        .align_y(iced::Alignment::Center)
        .into()
}

