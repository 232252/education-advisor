//! Section header: small title with an icon and a horizontal hairline.
//!
//! Mirrors `.section-title` from preview: title + 1 px gradient hairline
//! fading from `--border-strong` to transparent on the right.

use iced::widget::{container, row, text, Container};
use iced::{Element, Length};

use crate::ui::icons::{icon, IconName};

pub fn section_header<'a, M: 'a>(title: &str, icon_name: Option<IconName>) -> Element<'a, M> {
    let mut children: Vec<Element<'a, M>> = Vec::new();
    if let Some(ic) = icon_name {
        children.push(
            iced::widget::Svg::new(icon(ic))
                .width(Length::Fixed(14.0))
                .height(Length::Fixed(14.0))
                .into(),
        );
        children.push(iced::widget::Space::new().width(6).height(0).into());
    }
    children.push(
        text(title.to_string())
            .size(14)
            .color(iced::Color::from_rgb(0.95, 0.95, 1.0))
            .into(),
    );
    children.push(iced::widget::Space::new().width(Length::Fill).height(1).into());
    children.push(
        container(iced::widget::Space::new())
            .width(Length::Fill)
            .height(Length::Fixed(1.0))
            .style(|_| iced::widget::container::Style {
                background: Some(iced::Background::Gradient(iced::Gradient::Linear(
                    iced::gradient::Linear::new(iced::Degrees(90.0))
                        .add_stop(0.0, iced::Color::from_rgba(1.0, 1.0, 1.0, 0.20))
                        .add_stop(1.0, iced::Color::TRANSPARENT),
                ))),
                border: iced::Border {
                    color: iced::Color::TRANSPARENT,
                    width: 0.0,
                    radius: iced::border::Radius::from(0.0),
                },
                shadow: iced::Shadow::default(),
                text_color: None,
                snap: false,
            })
            .into(),
    );

    row(children).spacing(8).align_y(iced::Alignment::Center).into()
}