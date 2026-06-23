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

    // Two-column grid for agents
    let mut row_items: Vec<Element<Message>> = Vec::new();
    for agent in agents {
        let active = app.active_agent == agent.id;
        let icon_char = agent.name.chars().next().unwrap_or('◆');

        // Top row: big icon (left) + active badge (right)
        let top_row = row![
            text(icon_char.to_string())
                .font(Font {
                    family: CJK_FONT.family,
                    weight: iced::font::Weight::Bold,
                    ..Default::default()
                })
                .size(28)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(theme.accent),
                }),
            Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
            if active {
                widgets::badge(theme, theme.success, "当前".to_string())
            } else {
                Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(0.0)).into()
            },
        ]
        .align_y(Alignment::Center)
        .spacing(8);

        // Name + ID sub-column (tight spacing for breathing feel)
        let name_id = column![
            text(agent.name.clone())
                .font(Font {
                    family: CJK_FONT.family,
                    weight: iced::font::Weight::Bold,
                    ..Default::default()
                })
                .size(16)
                .style(move |_: &iced::Theme| style::text_primary(theme)),
            text(agent.id.clone())
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(2);

        let card_content = column![
            top_row,
            Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)),
            name_id,
            Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)),
            text(agent.description.clone())
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(0)
        .width(Length::Fill);

        let btn = iced::widget::button(card_content)
            .style(move |_, status| style::secondary_button(theme, status))
            .padding(Padding::from(20.0))
            .width(Length::Fill)
            .on_press(Message::SetActiveAgent(agent.id.to_string()));

        row_items.push(btn.into());
    }

    // Arrange in pairs (two-column grid)
    let mut grid_rows: Vec<Element<Message>> = Vec::new();
    let mut iter = row_items.into_iter();
    while let Some(first) = iter.next() {
        if let Some(second) = iter.next() {
            grid_rows.push(
                row![first, second]
                    .spacing(14)
                    .width(Length::Fill)
                    .into(),
            );
        } else {
            grid_rows.push(first);
        }
        grid_rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(14.0)).into());
    }
    items.extend(grid_rows);

    let grid = column(items).spacing(0).width(Length::Fill);
    let content = scrollable(grid).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(14.0)),
        container(content).width(Length::Fill).height(Length::Fill)
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}
