//! Agent history page — conversation timeline with tool calls.

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let convs = app.conversations.read().clone();

    let header = widgets::page_header(theme, "执行历史", "所有 AI 代理的会话与工具调用时间线");

    let mut items: Vec<Element<Message>> = Vec::new();

    if convs.is_empty() {
        items.push(
            widgets::empty_state(theme, "⌚", "还没有执行历史")
                .into(),
        );
    } else {
        for c in convs.iter().take(50) {
            let messages = app.messages.get(&c.id).cloned().unwrap_or_default();
            let tool_count: usize = messages.iter().map(|m| m.tool_calls.len()).sum();

            let agent = crate::agents::find(&c.agent_id);
            let agent_name = agent.map(|a| a.name).unwrap_or(&c.agent_id).to_string();

            let card_content = column![
                row![
                    text("●")
                        .size(10)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(theme.accent),
                        }),
                    text(c.title.clone())
                        .font(CJK_FONT)
                        .size(14)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
                    text(format!("{} 条消息 · {} 次工具调用", messages.len(), tool_count))
                        .font(CJK_FONT)
                        .size(11)
                        .style(move |_: &iced::Theme| style::text_faint(theme)),
                ]
                .align_y(Alignment::Center)
                .spacing(8),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)),
                row![
                    widgets::badge(theme, theme.purple, agent_name),
                    text(c.updated_at.format("%Y-%m-%d %H:%M").to_string())
                        .font(CJK_FONT)
                        .size(11)
                        .style(move |_: &iced::Theme| style::text_faint(theme)),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(0)
            .width(Length::Fill);

            let btn = iced::widget::button(card_content)
                .style(move |_, status| style::secondary_button(theme, status))
                .padding(Padding::from(14.0))
                .width(Length::Fill)
                .on_press(Message::NavigateToChat(c.id));

            items.push(btn.into());
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
        }
    }

    let grid = column(items).spacing(0).width(Length::Fill);
    let content = scrollable(grid).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)),
        container(content).width(Length::Fill).height(Length::Fill)
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}
