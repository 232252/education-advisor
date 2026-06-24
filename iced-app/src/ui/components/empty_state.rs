//! Empty state: large icon + title + optional subtitle.

use iced::widget::{column, container, text, Container};
use iced::{Alignment, Element, Length};

use crate::ui::icons::{icon, IconName};

pub fn empty_state<'a, M: 'a>(
    icon_name: IconName,
    title: &str,
    description: &str,
) -> Element<'a, M> {
    let icon_box: Element<'a, M> = container(
        iced::widget::Svg::new(icon(icon_name))
            .width(Length::Fixed(30.0))
            .height(Length::Fixed(30.0)),
    )
    .padding(17.0)
    .style(|_| iced::widget::container::Style {
        background: Some(iced::Background::Color(iced::Color::from_rgba(0.66, 0.33, 0.97, 0.10))),
        border: iced::Border {
            color: iced::Color::from_rgba(0.66, 0.33, 0.97, 0.20),
            width: 1.0,
            radius: iced::border::Radius::from(18.0),
        },
        shadow: iced::Shadow::default(),
        text_color: Some(iced::Color::from_rgb(0.66, 0.33, 0.97)),
        snap: false,
    })
    .into();

    column![
        icon_box,
        text(title.to_string()).size(14).color(iced::Color::from_rgb(0.82, 0.84, 0.91)),
        text(description.to_string()).size(12).color(iced::Color::from_rgb(0.49, 0.51, 0.64)),
    ]
    .spacing(8)
    .align_x(Alignment::Center)
    .padding(40)
    .into()
}

