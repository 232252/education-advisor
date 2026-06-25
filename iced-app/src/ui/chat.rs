//! Chat page — conversation list + streaming message view.

use iced::widget::{button, column, container, row, scrollable, text, text_input, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message, Page};
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
            return container(widgets::empty_state_with_cta(
                theme,
                "💬",
                "选择一个对话或创建新对话",
                "开始与 AI 代理进行智能对话",
                "新对话",
                Message::Navigate(Page::Chat),
            ))
            .width(Length::Fill)
            .height(Length::Fill)
            .center_x(Length::Fill)
            .center_y(Length::Fill)
            .into();
        }
    };

    // Look up the conversation's agent_id for AI role badges.
    let agent_id = app
        .conversations
        .read()
        .iter()
        .find(|c| c.id == conv_id)
        .map(|c| c.agent_id.clone())
        .unwrap_or_else(|| "AI".to_string());

    let messages = app.messages.get(&conv_id).cloned().unwrap_or_default();
    let streaming = app.streaming.get(&conv_id).cloned();

    let mut items: Vec<Element<Message>> = Vec::new();

    for msg in &messages {
        items.push(message_bubble(
            app,
            msg.role,
            msg.content.clone(),
            msg.tool_calls.clone(),
            &agent_id,
        ));
        items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
    }

    // Streaming message
    if let Some(st) = &streaming {
        if st.active {
            let content = if st.buffer.is_empty() {
                "正在思考…".to_string()
            } else {
                st.buffer.clone()
            };
            items.push(message_bubble(
                app,
                Role::Assistant,
                content,
                st.tool_calls.clone(),
                &agent_id,
            ));
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
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
    app: &'a App,
    role: Role,
    content: String,
    tool_calls: Vec<crate::models::ToolCallRecord>,
    agent_id: &str,
) -> Element<'a, Message> {
    let theme = &app.theme;
    let is_user = matches!(role, Role::User);

    // P0 BUG #12 fix: 显示前对消息内容调用 deanonymize()。
    // ai.rs 里发给 LLM 的内容是化名版（S_001），UI 不还原的话老师
    // 看到的是一堆别名而不是真名。先看是否启用了 PII：
    //   - 启用 + 引擎有映射：deanonymize（化名 → 真名）
    //   - 未启用 / 未解锁：保持原文
    let content = {
        let pii = app.pii.lock();
        if pii.enabled && pii.has_mappings() {
            pii.deanonymize(&content)
        } else {
            content
        }
    };

    // Role label badge: user="你", AI=agent_id
    let (badge_color, badge_label) = match role {
        Role::User => (theme.accent, "你".to_string()),
        Role::Assistant => (theme.purple, agent_id.to_string()),
        Role::System => (theme.text_faint, "系统".to_string()),
        Role::Tool => (theme.cyan, "工具".to_string()),
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
            .width(Length::Fill)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(theme.text),
            })
            .into(),
    );

    let bubble_content = column(col_items).spacing(0).width(Length::Fill);

    // Rounded 16px, with the bottom corner facing the sender tapered to 4px.
    let radius = if is_user {
        iced::border::Radius {
            top_left: 16.0,
            top_right: 16.0,
            bottom_right: 4.0,
            bottom_left: 16.0,
        }
    } else {
        iced::border::Radius {
            top_left: 16.0,
            top_right: 16.0,
            bottom_right: 16.0,
            bottom_left: 4.0,
        }
    };

    let bubble = container(bubble_content)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(if is_user {
                theme.accent_dim
            } else {
                theme.surface
            })),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius,
            },
            shadow: iced::Shadow {
                color: iced::Color { a: 0.08, ..theme.shadow },
                offset: iced::Vector::new(0.0, 2.0),
                blur_radius: 8.0,
            },
            text_color: None,
            snap: false,
        })
        .padding([10.0, 14.0])
        .width(Length::Fill);

    let badge = container(
        text(badge_label)
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(badge_color),
            }),
    )
    .style(move |_: &iced::Theme| style::badge(theme, badge_color))
    .padding([3.0, 8.0]);

    // Cap the bubble column at 70% width; right-align for user, left for AI.
    let bubble_col = column![badge, bubble]
        .spacing(4)
        .align_x(if is_user {
            iced::alignment::Horizontal::Right
        } else {
            iced::alignment::Horizontal::Left
        })
        .width(Length::FillPortion(7));

    if is_user {
        row![
            Space::new().width(Length::FillPortion(3)).height(Length::Fixed(0.0)),
            bubble_col,
        ]
        .spacing(0)
        .align_y(Alignment::Start)
        .into()
    } else {
        row![
            bubble_col,
            Space::new().width(Length::FillPortion(3)).height(Length::Fixed(0.0)),
        ]
        .spacing(0)
        .align_y(Alignment::Start)
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

    let action_btn = if is_streaming {
        button(
            text("取消")
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
        .style(move |_, status| style::grad_button(theme, status))
        .padding([12.0, 16.0])
        .on_press(Message::SendChat)
    };

    let input_row = row![input, action_btn]
        .spacing(8)
        .align_y(Alignment::Center)
        .width(Length::Fill);

    container(input_row)
        .padding([10.0, 20.0])
        .width(Length::Fill)
        .into()
}
