//! Chat page — conversation list + streaming message view.

use iced::widget::{button, column, container, row, scrollable, text, text_input, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::Role;
use crate::theme::Theme;
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let header = widgets::page_header(theme, "对话", "与 AI 代理进行智能对话");

    // Conversation list panel
    let conv_list = conversation_list(app);

    // Message area
    let messages = message_area(app);

    // Input area
    let input = input_area(app);

    let chat_area = column![
        container(messages).height(Length::Fill).width(Length::Fill),
        input,
    ]
    .spacing(12)
    .height(Length::Fill)
    .width(Length::Fill);

    let body = row![conv_list, chat_area].spacing(12).height(Length::Fill);

    column![header, Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)), body]
        .spacing(0)
        .height(Length::Fill)
        .width(Length::Fill)
        .into()
}

fn conversation_list(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let convs = app.conversations.read().clone();

    let mut items: Vec<Element<Message>> = Vec::new();
    items.push(widgets::section_title(theme, "会话列表").into());

    // New conversation controls
    let new_btn = button(
        row![
            text("✚").size(14).style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
            text("新对话")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::primary_button(theme, status))
    .padding([8.0, 12.0])
    .width(Length::Fill)
    .on_press(Message::NewConversation);
    items.push(new_btn.into());
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    if convs.is_empty() {
        items.push(
            text("暂无会话")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme))
                .into(),
        );
    } else {
        for c in convs.iter().take(30) {
            let active = app.selected_conversation == Some(c.id);
            let item = column![
                text(c.title.clone())
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(if active { theme.accent_hover } else { theme.text }),
                    }),
                text(format!(
                    "{} · {}",
                    c.agent_id,
                    c.updated_at.format("%m-%d %H:%M")
                ))
                .font(CJK_FONT)
                .size(10)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(2);

            let btn = button(item)
                .style(move |_, status| style::nav_button(theme, active, status))
                .padding([8.0, 10.0])
                .width(Length::Fill)
                .on_press(Message::SelectConversation(c.id));
            items.push(btn.into());
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)).into());
        }
    }

    let content = column(items).spacing(0).width(Length::Fill);

    container(
        scrollable(content).style(move |_, _| style::scrollable(theme)),
    )
    .style(move |_: &iced::Theme| style::card_flat(theme))
    .padding(Padding::from(12.0))
    .width(Length::Fixed(260.0))
    .height(Length::Fill)
    .into()
}

fn message_area(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let conv_id = match app.selected_conversation {
        Some(id) => id,
        None => {
            return container(widgets::empty_state(
                theme,
                "💬",
                "选择一个会话或创建新对话开始聊天",
            ))
            .width(Length::Fill)
            .height(Length::Fill)
            .center_x(Length::Fill)
            .into();
        }
    };

    let messages = app.messages.get(&conv_id).cloned().unwrap_or_default();
    let streaming = app.streaming.get(&conv_id).cloned();

    let mut items: Vec<Element<Message>> = Vec::new();

    for msg in &messages {
        items.push(message_bubble(theme, msg.role, msg.content.clone(), msg.tool_calls.clone()));
        items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
    }

    // Streaming message
    if let Some(st) = &streaming {
        if st.active {
            let content = if st.buffer.is_empty() {
                "正在思考…".to_string()
            } else {
                st.buffer.clone()
            };
            items.push(message_bubble(theme, Role::Assistant, content, st.tool_calls.clone()));
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
        }
    }

    if messages.is_empty() && streaming.is_none() {
        items.push(
            widgets::empty_state(theme, "💬", "发送第一条消息开始对话")
                .into(),
        );
    }

    let scroll = scrollable(column(items).width(Length::Fill))
        .style(move |_, _| style::scrollable(theme))
        .width(Length::Fill)
        .height(Length::Fill);

    container(scroll)
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .padding(Padding::from(16.0))
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}

fn message_bubble<'a>(
    theme: &'a Theme,
    role: Role,
    content: String,
    tool_calls: Vec<crate::models::ToolCallRecord>,
) -> Element<'a, Message> {
    let (is_user, name, color) = match role {
        Role::User => (true, "你", theme.accent),
        Role::Assistant => (false, "AI", theme.purple),
        Role::System => (false, "系统", theme.text_faint),
        Role::Tool => (false, "工具", theme.cyan),
    };

    let mut col_items: Vec<Element<Message>> = Vec::new();

    // Tool calls
    for tc in &tool_calls {
        let status_icon = match tc.status {
            crate::models::ToolStatus::Pending => "⏳",
            crate::models::ToolStatus::Running => "⚙",
            crate::models::ToolStatus::Success => "✓",
            crate::models::ToolStatus::Failed => "✕",
        };
        let tool_row = row![
            text(status_icon).size(11),
            text(format!(" {} ", tc.name))
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(theme.cyan),
                }),
            text(crate::util::truncate(&tc.result, 80))
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(4)
        .align_y(Alignment::Center);

        col_items.push(
            container(tool_row)
                .style(move |_: &iced::Theme| style::badge(theme, theme.cyan))
                .padding([4.0, 8.0])
                .into(),
        );
        col_items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(6.0)).into());
    }

    col_items.push(
        text(content)
            .font(CJK_FONT)
            .size(14)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(theme.text),
            })
            .into(),
    );

    let bubble_content = column(col_items).spacing(0).width(Length::Fill);

    let bubble = container(bubble_content)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(if is_user {
                theme.accent_dim
            } else {
                theme.surface
            })),
            border: iced::Border {
                color: if is_user { theme.accent } else { theme.border },
                width: 1.0,
                radius: iced::border::Radius::from(12.0),
            },
            shadow: iced::Shadow {
                color: iced::Color { a: 0.08, ..theme.shadow },
                offset: iced::Vector::new(0.0, 2.0),
                blur_radius: 8.0,
            },
            text_color: None,
            snap: false,
        })
        .padding(Padding::from(14.0))
        .width(Length::Fill);

    let name_label = text(name)
        .font(CJK_FONT)
        .size(11)
        .style(move |_: &iced::Theme| iced::widget::text::Style {
            color: Some(color),
        });

    let bubble_col = column![name_label, bubble].spacing(4);

    if is_user {
        row![
            iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
            bubble_col.width(Length::FillPortion(3)),
        ]
        .spacing(0)
        .into()
    } else {
        row![
            bubble_col.width(Length::FillPortion(3)),
            iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        ]
        .spacing(0)
        .into()
    }
}

fn input_area(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let is_streaming = app
        .selected_conversation
        .and_then(|id| app.streaming.get(&id).map(|s| s.active))
        .unwrap_or(false);

    let input = text_input("输入消息… (Enter 发送)", &app.chat_input)
        .on_input(Message::ChatInputChanged)
        .on_submit(Message::SendChat)
        .font(CJK_FONT)
        .size(14)
        .padding([12.0, 16.0])
        .style(move |_, status| style::text_input_style(theme, status))
        .width(Length::Fill);

    let send_btn = if is_streaming {
        button(
            text("⏹ 停止")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::danger_button(theme, status))
        .padding([12.0, 16.0])
        .on_press(Message::CancelGeneration)
    } else {
        button(
            text("发送 ▸")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([12.0, 16.0])
        .on_press(Message::SendChat)
    };

    row![input, send_btn]
        .spacing(8)
        .align_y(Alignment::Center)
        .width(Length::Fill)
        .into()
}
