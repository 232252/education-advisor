//! AI Agents page — list of 18 specialized agents.

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let agents = crate::agents::all_agents();

    let header = widgets::page_header(theme, "AI 代理", "18 个专业化 AI 代理，覆盖教育管理全场景");

    let mut items: Vec<Element<Message>> = Vec::new();

    for agent in agents {
        let active = app.active_agent == agent.id;
        let icon_char = agent.name.chars().next().unwrap_or('◆');

        let card_content = column![
            row![
                text(icon_char.to_string())
                    .font(Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(24)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.accent),
                    }),
                column![
                    text(agent.name.clone())
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(15)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    text(agent.id.clone())
                        .font(CJK_FONT)
                        .size(11)
                        .style(move |_: &iced::Theme| style::text_faint(theme)),
                ]
                .spacing(2),
                iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
                if active {
                    widgets::badge(theme, theme.success, "当前".to_string())
                } else {
                    iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(0.0)).into()
                },
            ]
            .align_y(Alignment::Center)
            .spacing(12),
            iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)),
            text(agent.description.clone())
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(0)
        .width(Length::Fill);

        let btn = iced::widget::button(card_content)
            .style(move |_, status| {
                if active {
                    style::nav_button(theme, true, status)
                } else {
                    style::secondary_button(theme, status)
                }
            })
            .padding(Padding::from(16.0))
            .width(Length::Fill)
            .on_press(Message::None);

        items.push(btn.into());
        items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
    }

    let grid = column(items).spacing(0).width(Length::Fill);
    let content = scrollable(grid).style(move |_, _| style::scrollable(theme));

    column![header, Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)), container(content).width(Length::Fill).height(Length::Fill)]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}
