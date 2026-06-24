//! Sidebar navigation item: icon + label, with active/hover states.

use iced::widget::{button, container, row, text, Button, Container};
use iced::{Alignment, Element, Length};

use crate::ui::icons::{icon, IconName};

pub struct NavItemSpec {
    pub label: String,
    pub icon: IconName,
    pub active: bool,
    pub badge: Option<String>,
}

/// Render a clickable sidebar item.
pub fn nav_item<'a, M: 'a + Clone>(spec: NavItemSpec, on_press: M) -> Element<'a, M> {
    let active = spec.active;
    let label = spec.label;
    let icon_name = spec.icon;
    let badge = spec.badge;

    let content: Element<'a, M> = row![
        iced::widget::Svg::new(icon(icon_name))
            .width(Length::Fixed(17.0))
            .height(Length::Fixed(17.0)),
        text(label).size(13).color(if active {
            iced::Color::WHITE
        } else {
            iced::Color::from_rgb(0.71, 0.74, 0.83)
        }),
    ]
    .spacing(11)
    .align_y(Alignment::Center)
    .padding(iced::Padding { top: 9.0, bottom: 9.0, left: 10.0, right: 10.0 })
    .into();

    let content: Element<'a, M> = if let Some(b) = badge {
        let badge_el: Element<'a, M> = container(text(b).size(10).color(iced::Color::from_rgb(0.97, 0.66, 0.83)))
            .padding(iced::Padding { top: 1.0, bottom: 1.0, left: 6.0, right: 6.0 })
            .style(|_| iced::widget::container::Style {
                background: Some(iced::Background::Color(iced::Color::from_rgba(0.93, 0.28, 0.6, 0.18))),
                border: iced::Border { color: iced::Color::TRANSPARENT, width: 0.0, radius: iced::border::Radius::from(5.0) },
                shadow: iced::Shadow::default(),
                text_color: None,
                snap: false,
            })
            .into();
        row![content, iced::widget::Space::new().width(Length::Fill).height(0), badge_el]
            .align_y(Alignment::Center)
            .into()
    } else {
        content
    };

    let bg = if active {
        iced::Color::from_rgba(0.66, 0.33, 0.97, 0.16)
    } else {
        iced::Color::TRANSPARENT
    };
    let border = if active {
        iced::Color::from_rgba(0.66, 0.33, 0.97, 0.22)
    } else {
        iced::Color::TRANSPARENT
    };

    button(
        container(content)
            .width(Length::Fill)
            .style(move |_| iced::widget::container::Style {
                background: Some(iced::Background::Color(bg)),
                border: iced::Border { color: border, width: 1.0, radius: iced::border::Radius::from(9.0) },
                shadow: iced::Shadow::default(),
                text_color: None,
                snap: false,
            }),
    )
    .on_press(on_press)
    .padding(0)
    .style(|_t, status| {
        let bg = if matches!(status, button::Status::Hovered) {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.04)
        } else {
            iced::Color::TRANSPARENT
        };
        button::Style {
            background: Some(iced::Background::Color(bg)),
            text_color: iced::Color::WHITE,
            border: iced::Border { color: iced::Color::TRANSPARENT, width: 0.0, radius: iced::border::Radius::from(9.0) },
            shadow: iced::Shadow::default(),
            snap: false,
        }
    })
    .width(Length::Fill)
    .into()
}

/// Render a collapsed-mode (icon-only) sidebar item.
pub fn nav_item_compact<'a, M: 'a + Clone>(spec: NavItemSpec, on_press: M) -> Element<'a, M> {
    let active = spec.active;
    let icon_name = spec.icon;

    let bg = if active {
        iced::Color::from_rgba(0.66, 0.33, 0.97, 0.16)
    } else {
        iced::Color::TRANSPARENT
    };
    let border = if active {
        iced::Color::from_rgba(0.66, 0.33, 0.97, 0.22)
    } else {
        iced::Color::TRANSPARENT
    };

    let mut content_children: Vec<Element<'a, M>> = vec![
        iced::widget::Svg::new(icon(icon_name))
            .width(Length::Fixed(18.0))
            .height(Length::Fixed(18.0))
            .into(),
    ];
    if let Some(b) = spec.badge {
        content_children.push(
            text(b)
                .size(9)
                .color(iced::Color::from_rgb(0.97, 0.66, 0.83))
                .into(),
        );
    }
    let content = row(content_children)
        .spacing(4)
        .align_y(Alignment::Center);

    button(
        container(content)
            .width(Length::Fill)
            .padding(iced::Padding { top: 9.0, bottom: 9.0, left: 0.0, right: 0.0 })
            .style(move |_| iced::widget::container::Style {
                background: Some(iced::Background::Color(bg)),
                border: iced::Border { color: border, width: 1.0, radius: iced::border::Radius::from(9.0) },
                shadow: iced::Shadow::default(),
                text_color: None,
                snap: false,
            }),
    )
    .on_press(on_press)
    .padding(0)
    .style(|_t, status| {
        let bg = if matches!(status, button::Status::Hovered) {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.04)
        } else {
            iced::Color::TRANSPARENT
        };
        button::Style {
            background: Some(iced::Background::Color(bg)),
            text_color: iced::Color::WHITE,
            border: iced::Border { color: iced::Color::TRANSPARENT, width: 0.0, radius: iced::border::Radius::from(9.0) },
            shadow: iced::Shadow::default(),
            snap: false,
        }
    })
    .width(Length::Fill)
    .into()
}

