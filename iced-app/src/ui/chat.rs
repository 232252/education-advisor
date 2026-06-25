//! Chat page — three-column layout (agent list / conversation / tool timeline).
//!
//! Mirrors `iced-app/preview/index.html#page-chat`:
//! * left rail: 280px agent list, only on Wide
//! * middle: 1fr conversation stream + input
//! * right rail: 320px tool-call timeline, hidden on Compact
//!
//! Uses the new design tokens (`style::radius::LG` for chat-input-box, the
//! `style::card_flat` glass card, `style::primary_button` / `grad_button` for
//! the send / cancel action, `style::badge` for tool-call status rows) and
//! the new `responsive::LayoutMode::{chat_show_left_rail, chat_show_tool_timeline}`
//! breakpoints to drive the three-column grid.

use iced::widget::{button, column, container, row, scrollable, text, text_input, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::Role;
use crate::theme::Theme;
use crate::ui::components::badge::{self, PillTone};
use crate::ui::components::empty_state::empty_state as es_empty_state;
use crate::ui::components::section_header::section_header as sh_section_header;
use crate::ui::components::sidebar_item::{nav_item, NavItemSpec};
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;

/// Sidebar width for the left agent rail, matches preview's
/// `.chat-layout { grid-template-columns: 280px 1fr 320px }`.
const LEFT_RAIL_WIDTH: f32 = 280.0;
/// Tool timeline width on the right rail.
const RIGHT_RAIL_WIDTH: f32 = 320.0;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = LayoutMode::from_width(app.window_size.width);

    let header_text = "对话";
    let header_sub = "流式输出 · 工具调用可视化 · 支持 18 个 AI 代理";

    let header = column![
        text(header_text)
            .font(CJK_FONT)
            .size(20)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        text(header_sub)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(2);

    let mut row_children: Vec<Element<Message>> = Vec::new();

    if mode.chat_show_left_rail() {
        row_children.push(agent_list(app, theme));
    }

    // Middle: message area + input (always visible).
    let messages = message_area(app, theme);
    let input = input_area(app, theme);
    let middle = column![
        container(messages)
            .height(Length::Fill)
            .width(Length::Fill)
            .style(move |_: &iced::Theme| style::card_flat(theme)),
        input
    ]
    .spacing(12)
    .height(Length::Fill)
    .width(Length::Fill);
    row_children.push(middle);

    if mode.chat_show_tool_timeline() {
        row_children.push(tool_timeline(app, theme));
    }

    let body = row(row_children)
        .spacing(12)
        .height(Length::Fill)
        .width(Length::Fill);

    column![header, Space::new().height(Length::Fixed(12.0)), body]
        .spacing(0)
        .height(Length::Fill)
        .width(Length::Fill)
        .into()
}

// ── Left rail: agent list (Wide only) ──────────────────────────────

fn agent_list(app: &App, theme: &Theme) -> Element<Message> {
    let convs = app.conversations.read().clone();
    let agents = crate::agents::all_agents();

    let mut items: Vec<Element<Message>> = Vec::new();

    // Section header uses the new `section_header` component.
    items.push(sh_section_header::<Message>("代理", Some(IconName::Bot)));

    // New conversation button (uses `style::grad_button` = primary gradient).
    let new_btn = button(
        row![
            iced::widget::Svg::new(icon(IconName::Plus))
                .width(Length::Fixed(14.0))
                .height(Length::Fixed(14.0)),
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
    .style(move |_, status| style::grad_button(theme, status))
    .padding([8.0, 12.0])
    .width(Length::Fill)
    .on_press(Message::NewConversation);
    items.push(new_btn.into());
    items.push(Space::new().height(Length::Fixed(8.0)).into());

    // Conversation list (reuse `nav_item` for the active state).
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
            items.push(Space::new().height(Length::Fixed(4.0)).into());
        }
    }

    // Add an "Agents" sub-section listing the 18 agent names so the
    // preview's `<div class="agent-list">${agentsList}</div>` block is
    // represented (each agent becomes a `nav_item`).
    items.push(Space::new().height(Length::Fixed(8.0)).into());
    items.push(sh_section_header::<Message>("所有代理", Some(IconName::Users)));

    for (i, a) in agents.iter().enumerate() {
        let spec = NavItemSpec {
            label: a.name.to_string(),
            icon: pick_icon_for_agent(a.id),
            active: app.active_agent == a.id,
            badge: if i < 3 { Some("NEW".to_string()) } else { None },
        };
        items.push(nav_item(spec, Message::SetActiveAgent(a.id.to_string())));
        items.push(Space::new().height(Length::Fixed(2.0)).into());
    }

    let content = column(items).spacing(0).width(Length::Fill);

    container(scrollable(content).style(move |_, _| style::scrollable(theme)))
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .padding(Padding::from(12.0))
        .width(Length::Fixed(LEFT_RAIL_WIDTH))
        .height(Length::Fill)
        .into()
}

/// Map agent id → lucide icon.
fn pick_icon_for_agent(id: &str) -> IconName {
    if id.contains("psychology") || id.contains("counselor") {
        IconName::Heart
    } else if id.contains("risk") || id.contains("safety") {
        IconName::Shield
    } else if id.contains("discipline") {
        IconName::AlertTriangle
    } else if id.contains("academic") || id.contains("research") {
        IconName::Book
    } else if id.contains("data") || id.contains("analyst") {
        IconName::BarChart
    } else if id.contains("weekly") {
        IconName::Activity
    } else if id.contains("home_school") || id.contains("parent") {
        IconName::Mail
    } else if id.contains("enrollment") {
        IconName::Plus
    } else if id.contains("scheduling") {
        IconName::Clock
    } else if id.contains("supervisor") || id.contains("governor") {
        IconName::Briefcase
    } else {
        IconName::Bot
    }
}

// ── Middle column: message stream + chat input ─────────────────────

fn message_area(app: &App, theme: &Theme) -> Element<Message> {
    let conv_id = match app.selected_conversation {
        Some(id) => id,
        None => {
            return container(
                es_empty_state(
                    IconName::Message,
                    "选择一个对话或创建新对话",
                    "开始与 AI 代理进行智能对话",
                ),
            )
            .width(Length::Fill)
            .height(Length::Fill)
            .center_x(Length::Fill)
            .center_y(Length::Fill)
            .style(move |_: &iced::Theme| style::card_flat(theme))
            .into();
        }
    };

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

    // Conversation header strip.
    items.push(conversation_header(app, theme, &agent_id));
    items.push(Space::new().height(Length::Fixed(12.0)).into());

    for msg in &messages {
        items.push(message_bubble(
            app,
            msg.role,
            msg.content.clone(),
            msg.tool_calls.clone(),
            &agent_id,
        ));
        items.push(Space::new().height(Length::Fixed(12.0)).into());
    }

    // Streaming message (placeholder rendering — the real stream is updated by
    // `app.streaming`). The preview shows the partial text + a blinking cursor.
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
            items.push(Space::new().height(Length::Fixed(12.0)).into());
        }
    }

    if messages.is_empty() && streaming.is_none() {
        items.push(
            es_empty_state(
                IconName::Send,
                "发送第一条消息开始对话",
                "选择上方代理或直接输入问题",
            )
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

fn conversation_header(app: &App, theme: &Theme, agent_id: &str) -> Element<Message> {
    let streaming = app
        .selected_conversation
        .and_then(|id| app.streaming.get(&id).map(|s| s.active))
        .unwrap_or(false);

    let avatar: Element<Message> = container(
        text("教")
            .font(CJK_FONT)
            .size(14)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
    )
    .padding(8.0)
    .style(|_| iced::widget::container::Style {
        background: Some(iced::Background::Gradient(iced::Gradient::Linear(
            iced::gradient::Linear::new(iced::Degrees(135.0))
                .add_stop(0.0, iced::Color::from_rgb(0.66, 0.33, 0.97))
                .add_stop(1.0, iced::Color::from_rgb(0.39, 0.39, 0.94)),
        ))),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.15),
            width: 1.0,
            radius: iced::border::Radius::from(10.0),
        },
        shadow: iced::Shadow::default(),
        text_color: Some(iced::Color::WHITE),
        snap: false,
    })
    .into();

    let title_block = column![
        text(format!("{} · 本周违纪情况汇总", agent_id))
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        row![
            iced::widget::Svg::new(icon(IconName::Zap))
                .width(Length::Fixed(11.0))
                .height(Length::Fixed(11.0)),
            text("DeepSeek V3 · 上下文 8,420 / 64K")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(4)
        .align_y(Alignment::Center),
    ]
    .spacing(2);

    let status_pill = if streaming {
        badge::pill_with_dot("流式中", PillTone::Emerald, true)
    } else {
        badge::pill_with_dot("已停止", PillTone::Zinc, true)
    };

    let stop_btn = button(
        row![
            iced::widget::Svg::new(icon(IconName::X))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            text("停止")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        ]
        .spacing(4)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::danger_button(theme, status))
    .padding([5.0, 10.0])
    .on_press(Message::CancelGeneration);

    row![
        avatar,
        title_block,
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        status_pill,
        stop_btn,
    ]
    .spacing(10)
    .align_y(Alignment::Center)
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

    // PII deanonymization (kept from previous cycle).
    let content = {
        let pii = app.pii.lock();
        if pii.enabled && pii.has_mappings() {
            pii.deanonymize(&content)
        } else {
            content
        }
    };

    let (badge_color, badge_label) = match role {
        Role::User => (theme.accent, "你".to_string()),
        Role::Assistant => (theme.purple, agent_id.to_string()),
        Role::System => (theme.text_faint, "系统".to_string()),
        Role::Tool => (theme.cyan, "工具".to_string()),
    };

    let mut col_items: Vec<Element<Message>> = Vec::new();

    // Tool call rows: status icon + name + meta.
    for tc in &tool_calls {
        let (status_icon, tone) = match tc.status {
            crate::models::ToolStatus::Pending => (IconName::Clock, PillTone::Zinc),
            crate::models::ToolStatus::Running => (IconName::Refresh, PillTone::Cyan),
            crate::models::ToolStatus::Success => (IconName::Check, PillTone::Emerald),
            crate::models::ToolStatus::Failed => (IconName::X, PillTone::Red),
        };

        let meta = match tc.status {
            crate::models::ToolStatus::Pending => "等待中…".to_string(),
            crate::models::ToolStatus::Running => "执行中…".to_string(),
            _ => format!(
                "{} · {}ms",
                crate::util::truncate(&tc.result, 60),
                tc.duration_ms
            ),
        };

        let tool_pill = badge::pill(tc.name, tone);
        let tool_row = row![
            iced::widget::Svg::new(icon(status_icon))
                .width(Length::Fixed(11.0))
                .height(Length::Fixed(11.0)),
            tool_pill,
            Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
            text(meta)
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
        col_items.push(Space::new().height(Length::Fixed(6.0)).into());
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

    let role_badge = container(
        text(badge_label)
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(badge_color),
            }),
    )
    .style(move |_: &iced::Theme| style::badge(theme, badge_color))
    .padding([3.0, 8.0]);

    let bubble_col = column![role_badge, bubble]
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

fn input_area(app: &App, theme: &Theme) -> Element<Message> {
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

    let tool_btn = button(
        iced::widget::Svg::new(icon(IconName::Zap))
            .width(Length::Fixed(14.0))
            .height(Length::Fixed(14.0)),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([10.0, 12.0])
    .on_press(Message::NewConversation);

    let action_btn = if is_streaming {
        button(
            row![
                iced::widget::Svg::new(icon(IconName::X))
                    .width(Length::Fixed(14.0))
                    .height(Length::Fixed(14.0)),
                text("取消")
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(iced::Color::WHITE),
                    }),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
        )
        .style(move |_, status| style::danger_button(theme, status))
        .padding([10.0, 16.0])
        .on_press(Message::CancelGeneration)
    } else {
        button(
            row![
                iced::widget::Svg::new(icon(IconName::Send))
                    .width(Length::Fixed(14.0))
                    .height(Length::Fixed(14.0)),
                text("发送")
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(iced::Color::WHITE),
                    }),
            ]
            .spacing(6)
            .align_y(Alignment::Center),
        )
        .style(move |_, status| style::grad_button(theme, status))
        .padding([10.0, 16.0])
        .on_press(Message::SendChat)
    };

    // Chat input box with `style::radius::LG` (12 px) per preview.
    let input_box = container(
        row![input, tool_btn, action_btn]
            .spacing(8)
            .align_y(Alignment::Center)
            .width(Length::Fill),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(theme.surface)),
        border: iced::Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(style::radius::LG),
        },
        shadow: iced::Shadow {
            color: iced::Color { a: 0.06, ..theme.shadow },
            offset: iced::Vector::new(0.0, 4.0),
            blur_radius: 14.0,
        },
        text_color: None,
        snap: false,
    })
    .padding(4.0)
    .width(Length::Fill);

    container(input_box)
        .padding([10.0, 20.0])
        .width(Length::Fill)
        .into()
}

// ── Right rail: tool-call timeline (Medium & Wide) ─────────────────

fn tool_timeline(app: &App, theme: &Theme) -> Element<Message> {
    let conv_id = app.selected_conversation;
    let mut items: Vec<Element<Message>> = Vec::new();

    items.push(
        row![
            iced::widget::Svg::new(icon(IconName::Activity))
                .width(Length::Fixed(14.0))
                .height(Length::Fixed(14.0)),
            text("工具调用时间轴")
                .font(Font {
                    family: CJK_FONT.family,
                    weight: iced::font::Weight::Bold,
                    ..Default::default()
                })
                .size(13)
                .style(move |_: &iced::Theme| style::text_primary(theme)),
        ]
        .spacing(6)
        .align_y(Alignment::Center)
        .into(),
    );

    // Aggregate: pull tool calls from all messages of the current conversation
    // plus the streaming buffer. Falls back to a 4-step mock when there is no
    // data yet so the panel doesn't look empty.
    let mut all_calls: Vec<crate::models::ToolCallRecord> = Vec::new();
    if let Some(id) = conv_id {
        if let Some(msgs) = app.messages.get(&id) {
            for m in msgs {
                all_calls.extend(m.tool_calls.clone());
            }
        }
        if let Some(st) = app.streaming.get(&id) {
            all_calls.extend(st.tool_calls.clone());
        }
    }

    if !all_calls.is_empty() {
        let sum_ms: u64 = all_calls.iter().map(|t| t.duration_ms).sum();
        items.push(
            text(format!(
                "{} 次调用 · 总耗时 {}ms",
                all_calls.len(),
                sum_ms
            ))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme))
            .into(),
        );
        items.push(Space::new().height(Length::Fixed(10.0)).into());

        for tc in &all_calls {
            items.push(tool_step(
                theme,
                tc.name.clone(),
                crate::util::truncate(&tc.args, 60),
                match tc.status {
                    crate::models::ToolStatus::Pending => "等待中…".to_string(),
                    crate::models::ToolStatus::Running => "执行中…".to_string(),
                    _ => format!("{} · {}ms", crate::util::truncate(&tc.result, 40), tc.duration_ms),
                },
                match tc.status {
                    crate::models::ToolStatus::Pending => (IconName::Clock, PillTone::Zinc),
                    crate::models::ToolStatus::Running => (IconName::Refresh, PillTone::Cyan),
                    crate::models::ToolStatus::Success => (IconName::Check, PillTone::Emerald),
                    crate::models::ToolStatus::Failed => (IconName::X, PillTone::Red),
                },
            ));
            items.push(Space::new().height(Length::Fixed(8.0)).into());
        }
    } else {
        // Mock data mirroring the preview's 4 steps.
        items.push(
            text("4 次调用 · 总耗时 1.2s")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme))
                .into(),
        );
        items.push(Space::new().height(Length::Fixed(10.0)).into());

        let mocks: Vec<(String, String, String, (IconName, PillTone))> = vec![
            (
                "dashboard_summary".into(),
                "scope: \"this_week\"".into(),
                "42ms · 8.2 KB 返回".into(),
                (IconName::Check, PillTone::Emerald),
            ),
            (
                "search_students".into(),
                "query: \"违纪\"".into(),
                "86ms · 14 条匹配".into(),
                (IconName::Check, PillTone::Emerald),
            ),
            (
                "get_student".into(),
                "id: \"S_003\"".into(),
                "38ms · 1 条记录".into(),
                (IconName::Check, PillTone::Emerald),
            ),
            (
                "rag_query".into(),
                "query: \"违纪处理流程\"".into(),
                "执行中…".into(),
                (IconName::Refresh, PillTone::Cyan),
            ),
        ];
        for (name, args, result, ic) in mocks {
            items.push(tool_step(theme, name, args, result, ic));
            items.push(Space::new().height(Length::Fixed(8.0)).into());
        }
    }

    let content = column(items).spacing(0).width(Length::Fill);

    container(scrollable(content).style(move |_, _| style::scrollable(theme)))
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .padding(Padding::from(14.0))
        .width(Length::Fixed(RIGHT_RAIL_WIDTH))
        .height(Length::Fill)
        .into()
}

fn tool_step(
    theme: &Theme,
    name: String,
    args: String,
    result: String,
    (ic, tone): (IconName, PillTone),
) -> Element<Message> {
    let dot: Element<Message> = container(
        iced::widget::Svg::new(icon(ic))
            .width(Length::Fixed(11.0))
            .height(Length::Fixed(11.0)),
    )
    .padding(3.0)
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Color(theme.surface_glass)),
        border: iced::Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(999.0),
        },
        shadow: iced::Shadow::default(),
        text_color: None,
        snap: false,
    })
    .into();

    let body = column![
        text(name)
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(12)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        text(args)
            .font(CJK_FONT)
            .size(10)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        text(result)
            .font(CJK_FONT)
            .size(10)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(if matches!(tone, PillTone::Emerald) {
                    theme.success
                } else if matches!(tone, PillTone::Cyan) {
                    theme.info
                } else {
                    theme.text_dim
                }),
            }),
    ]
    .spacing(2);

    let row_el = row![dot, body]
        .spacing(10)
        .align_y(Alignment::Start)
        .width(Length::Fill);

    container(row_el)
        .padding([6.0, 8.0])
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(theme.surface)),
            border: iced::Border {
                color: theme.border_soft,
                width: 1.0,
                radius: iced::border::Radius::from(8.0),
            },
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        })
        .into()
}

// Compact-mode (`< 900px`) variant of the left rail is intentionally
// omitted from this cycle — the rail is hidden entirely on Compact per
// `LayoutMode::chat_show_left_rail()`. A future patch can introduce a
// drawer / bottom-sheet using `nav_item_compact` from the same
// `sidebar_item` component module.
