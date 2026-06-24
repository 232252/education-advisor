//! Agent card: gradient icon + name + role + description + tags + status.

use iced::widget::{column, container, row, text, Container};
use iced::{Alignment, Element, Length};

use super::badge::PillTone;
use crate::ui::components::badge;
use crate::ui::icons::{icon, IconName};

pub struct AgentCardSpec {
    pub name: String,
    pub role: String,
    pub desc: String,
    pub tags: Vec<String>,
    pub status: String,
    pub status_online: bool,
    pub tools: u32,
    pub icon: IconName,
    pub c1: (u8, u8, u8),
    pub c2: (u8, u8, u8),
}

pub fn agent_card<'a, M: 'a>(spec: &'a AgentCardSpec) -> Element<'a, M> {
    let (r1, g1, b1) = spec.c1;
    let (r2, g2, b2) = spec.c2;
    let c1 = iced::Color::from_rgb(r1 as f32 / 255.0, g1 as f32 / 255.0, b1 as f32 / 255.0);
    let c2 = iced::Color::from_rgb(r2 as f32 / 255.0, g2 as f32 / 255.0, b2 as f32 / 255.0);

    let icon_box: Element<'a, M> = container(
        iced::widget::Svg::new(icon(spec.icon))
            .width(Length::Fixed(20.0))
            .height(Length::Fixed(20.0)),
    )
    .padding(10.0)
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Gradient(iced::Gradient::Linear(
            iced::gradient::Linear::new(iced::Degrees(135.0))
                .add_stop(0.0, c1)
                .add_stop(1.0, c2),
        ))),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.15),
            width: 1.0,
            radius: iced::border::Radius::from(11.0),
        },
        shadow: iced::Shadow::default(),
        text_color: Some(iced::Color::WHITE),
        snap: false,
    })
    .into();

    let status_pill: Element<'a, M> = if spec.status_online {
        badge::pill_with_dot(&spec.status, PillTone::Emerald, true)
    } else {
        badge::pill_with_dot(&spec.status, PillTone::Zinc, true)
    };

    let tags_row: Vec<Element<'a, M>> = spec
        .tags
        .iter()
        .map(|t| badge::zinc::<M>(t))
        .collect();
    let tags_el: Element<'a, M> = if tags_row.is_empty() {
        iced::widget::Space::new().into()
    } else {
        row(tags_row).spacing(5).wrap().into()
    };

    let name: Element<'a, M> = text(spec.name.clone()).size(14).color(iced::Color::WHITE).into();
    let role: Element<'a, M> = text(spec.role.clone()).size(11).color(iced::Color::from_rgb(0.49, 0.51, 0.64)).into();
    let desc: Element<'a, M> = text(spec.desc.clone()).size(12).color(iced::Color::from_rgb(0.71, 0.74, 0.83)).into();
    let tools_label: Element<'a, M> = text(format!("⚡ {} 个工具", spec.tools))
        .size(11)
        .color(iced::Color::from_rgb(0.61, 0.64, 0.78))
        .into();

    container(
        column![
            row![icon_box, iced::widget::Space::new().width(Length::Fill).height(0), status_pill]
                .align_y(Alignment::Center),
            iced::widget::Space::new().width(0).height(12),
            name,
            role,
            iced::widget::Space::new().width(0).height(10),
            desc,
            iced::widget::Space::new().width(0).height(12),
            tags_el,
            iced::widget::Space::new().width(0).height(10),
            row![iced::widget::Space::new().width(Length::Fill).height(0), tools_label]
                .align_y(Alignment::Center),
        ]
        .padding(16.0)
        .width(Length::Fill),
    )
    .style(|_| iced::widget::container::Style {
        background: Some(iced::Background::Color(iced::Color::from_rgba(1.0, 1.0, 1.0, 0.04))),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.07),
            width: 1.0,
            radius: iced::border::Radius::from(14.0),
        },
        shadow: iced::Shadow::default(),
        text_color: None,
        snap: false,
    })
    .into()
}

