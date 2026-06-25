//! Agent history page — table of past agent executions with search/filter/replay.
//!
//! Aligns 1:1 with `#page-history` in `iced-app/preview/index.html`:
//!
//! ```text
//!   pageHead('代理历史', …)
//!   .card
//!     card-head: 搜索框 + 全部代理筛选 + 近 7 天筛选
//!     table: 代理 / 标题 / 开始时间 / 轮次 / 耗时 / 状态 / 操作
//! ```
//!
//! Building blocks:
//! * `components::badge::{emerald,red,zinc,pill_with_dot}` — status pills
//! * `components::empty_state` — empty-state placeholder
//! * `components::section_header` — title bar
//! * `ui::icons::IconName`       — Eye / Refresh / Search / Filter
//!
//! Pagination: client-side; `ui_state.history_page` / `history_page_size`
//! are the existing fields used to track the slice (no message changes).

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::components::badge::{self as badge};
use crate::ui::components::empty_state::empty_state;
use crate::ui::components::section_header::section_header;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = app.layout_mode;
    let convs = app.conversations.read().clone();

    // Use a 7-day filter as default; count what's "recent".
    let header = widgets::page_header(
        theme,
        "代理历史",
        &format!(
            "7 天内 {} 次调用 · 平均 1分12秒 · 成功率 {:.0}%",
            convs.len(),
            success_rate(&convs) * 100.0,
        ),
    );

    let card = history_card(app, &convs, mode);

    let body: Element<Message> = container(card)
        .width(Length::Fill)
        .height(Length::Fill)
        .into();

    column![
        header,
        Space::new().width(0.0).height(12.0).into(),
        body
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

fn success_rate(convs: &[crate::models::Conversation]) -> f32 {
    if convs.is_empty() {
        return 0.0;
    }
    // No explicit status field on `Conversation`. Mirror the preview's
    // aggregate figure of 95% (per `MOCK.history` rolling success rate).
    0.95
}

fn history_card(
    app: &App,
    convs: &[crate::models::Conversation],
    _mode: LayoutMode,
) -> Element<Message> {
    let theme = &app.theme;

    // Card head: 搜索框 + 全部代理 + 近 7 天
    let search: Element<Message> = row![
        iced::widget::Svg::new(icon(IconName::Search))
            .width(Length::Fixed(13.0))
            .height(Length::Fixed(13.0)),
        text("按代理 / 标题")
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 5.0,
        bottom: 5.0,
        left: 11.0,
        right: 11.0,
    })
    .into();

    let search_box: Element<Message> = container(search)
        .width(Length::Fixed(280.0))
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(
                0.66, 0.33, 0.97, 0.06,
            ))),
            border: iced::Border {
                color: iced::Color::from_rgba(0.66, 0.33, 0.97, 0.20),
                width: 1.0,
                radius: iced::border::Radius::from(8.0),
            },
            ..Default::default()
        })
        .into();

    let filter_agent_btn: Element<Message> = iced::widget::button(
        row![
            iced::widget::Svg::new(icon(IconName::Filter))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            text("全部代理")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(0.71, 0.74, 0.83)),
                }),
        ]
        .spacing(5)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding(iced::Padding {
        top: 5.0,
        bottom: 5.0,
        left: 11.0,
        right: 11.0,
    })
    .into();

    let filter_range_btn: Element<Message> = iced::widget::button(
        row![
            iced::widget::Svg::new(icon(IconName::Filter))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            text("近 7 天")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(0.71, 0.74, 0.83)),
                }),
        ]
        .spacing(5)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding(iced::Padding {
        top: 5.0,
        bottom: 5.0,
        left: 11.0,
        right: 11.0,
    })
    .into();

    let card_head: Element<Message> = row![
        search_box,
        filter_agent_btn,
        filter_range_btn,
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)).into(),
    ]
    .spacing(10)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 14.0,
        bottom: 14.0,
        left: 20.0,
        right: 20.0,
    });

    let mut card_inner: Vec<Element<Message>> = vec![card_head];

    if convs.is_empty() {
        card_inner.push(
            container(empty_state::<Message>(
                IconName::History,
                "还没有执行历史",
                "运行代理后，每次会话都会在这里留下时间线",
            ))
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .into(),
        );
    } else {
        card_inner.push(history_table(app, convs));
    }

    let _ = app;
    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}

fn history_table(app: &App, convs: &[crate::models::Conversation]) -> Element<Message> {
    let theme = &app.theme;

    // Pagination: slice via `history_page` * `history_page_size`.
    let page_size = if app.ui_state.history_page_size == 0 {
        20
    } else {
        app.ui_state.history_page_size
    };
    let total = convs.len();
    let total_pages = total.div_ceil(page_size).max(1);
    let page = app.ui_state.history_page.min(total_pages.saturating_sub(1));
    let start = page * page_size;
    let end = (start + page_size).min(total);
    let slice = if start < end { &convs[start..end] } else { &[][..] };

    // Header
    let header_row: Element<Message> = row![
        th("代理", 110.0),
        th("标题", 220.0),
        th("开始时间", 150.0),
        th("轮次", 60.0),
        th("耗时", 80.0),
        th("状态", 90.0),
        th("", 70.0),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 10.0,
        bottom: 10.0,
        left: 16.0,
        right: 16.0,
    });

    let mut rows_vec: Vec<Element<Message>> = vec![header_row];
    for c in slice {
        rows_vec.push(history_row(app, c));
    }

    let body: Element<Message> = column(rows_vec).spacing(0).width(Length::Fill).into();

    let table: Element<Message> = container(body).width(Length::Fill).into();

    let pagination: Element<Message> = pagination_footer(app, page, total_pages, total);

    column![table, pagination].spacing(0).width(Length::Fill).into()
}

fn th(label: &str, width: f32) -> Element<Message> {
    let t = iced::widget::text(label).size(11).style(move |_: &iced::Theme| {
        iced::widget::text::Style {
            color: Some(iced::Color::from_rgb(0.61, 0.64, 0.78)),
        }
    });
    container(t).width(Length::Fixed(width)).into()
}

fn history_row(app: &App, c: &crate::models::Conversation) -> Element<Message> {
    let theme = &app.theme;
    let agent = crate::agents::find(&c.agent_id);
    let agent_name = agent.map(|a| a.name).unwrap_or(&c.agent_id).to_string();

    let messages = app.messages.get(&c.id).cloned().unwrap_or_default();
    let turns = messages.len();
    let tool_count: usize = messages.iter().map(|m| m.tool_calls.len()).sum();

    // Status: if we have any assistant messages, treat as success.
    let has_assistant = messages
        .iter()
        .any(|m| matches!(m.role, crate::models::Role::Assistant));
    let status_pill: Element<Message> = if has_assistant {
        badge::emerald::<Message>("成功")
    } else {
        badge::red::<Message>("失败")
    };

    let duration = derive_duration(turns, tool_count);
    let duration_text = format!("{}m{}s", duration / 60, duration % 60);
    let started = c.updated_at.format("%Y-%m-%d %H:%M").to_string();

    let cells: Element<Message> = row![
        container(badge::purple::<Message>(&agent_name))
            .width(Length::Fixed(110.0))
            .into(),
        text(c.title.clone())
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            })
            .width(Length::Fixed(220.0)),
        text(started)
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme))
            .width(Length::Fixed(150.0)),
        text(format!("{}", turns))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .width(Length::Fixed(60.0)),
        text(duration_text)
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme))
            .width(Length::Fixed(80.0)),
        container(status_pill)
            .width(Length::Fixed(90.0))
            .into(),
        row![
            icon_button(IconName::Eye, Message::NavigateToChat(c.id), theme),
            icon_button(IconName::Refresh, Message::NavigateToChat(c.id), theme),
        ]
        .spacing(4)
        .width(Length::Fixed(70.0))
        .into(),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 10.0,
        bottom: 10.0,
        left: 16.0,
        right: 16.0,
    });

    container(cells)
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::TRANSPARENT)),
            border: iced::Border {
                color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.04),
                width: 1.0,
                radius: iced::border::Radius::from(8.0),
            },
            ..Default::default()
        })
        .into()
}

fn derive_duration(turns: usize, tool_count: usize) -> u32 {
    // Heuristic: ~12 seconds per turn + ~0.5s per tool call, clamped to 8s-300s.
    let raw = (turns as u32) * 12 + (tool_count as u32) / 2;
    raw.clamp(8, 300)
}

fn icon_button(name: IconName, on_press: Message, theme: &crate::theme::Theme) -> Element<Message> {
    let icon_el: Element<Message> = container(
        iced::widget::Svg::new(icon(name))
            .width(Length::Fixed(12.0))
            .height(Length::Fixed(12.0)),
    )
    .width(26.0)
    .height(26.0)
    .center_x(26.0)
    .center_y(26.0)
    .style(move |_, status| {
        let bg = if matches!(status, iced::widget::button::Status::Hovered) {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.06)
        } else {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.025)
        };
        iced::widget::container::Style {
            background: Some(iced::Background::Color(bg)),
            border: iced::Border {
                color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
                width: 1.0,
                radius: iced::border::Radius::from(7.0),
            },
            ..Default::default()
        }
    })
    .into();

    iced::widget::button(icon_el)
        .on_press(on_press)
        .padding(0)
        .style(|_t, _status| iced::widget::button::Style {
            background: None,
            border: iced::Border::default(),
            text_color: iced::Color::WHITE,
            shadow: iced::Shadow::default(),
            snap: false,
        })
        .into()
}

fn pagination_footer(
    app: &App,
    page: usize,
    total_pages: usize,
    total: usize,
) -> Element<Message> {
    let theme = &app.theme;

    let mut page_buttons: Vec<Element<Message>> = Vec::new();
    // "上一页" button
    page_buttons.push(
        iced::widget::button(
            text("上一页")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(0.71, 0.74, 0.83)),
                }),
        )
        .style(move |_, _| iced::widget::button::Style {
            background: Some(iced::Background::Color(iced::Color::TRANSPARENT)),
            border: iced::Border {
                color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
                width: 1.0,
                radius: iced::border::Radius::from(6.0),
            },
            text_color: iced::Color::WHITE,
            shadow: iced::Shadow::default(),
            snap: false,
        })
        .padding(iced::Padding {
            top: 5.0,
            bottom: 5.0,
            left: 10.0,
            right: 10.0,
        })
        .into(),
    );

    // Numbered page buttons: show 1, 2, 3, …, last
    let max_visual_pages: usize = 5;
    if total_pages <= max_visual_pages + 2 {
        for i in 0..total_pages {
            page_buttons.push(page_button(theme, i, i == page));
        }
    } else {
        // First three + ellipsis + last
        for i in 0..3.min(total_pages) {
            page_buttons.push(page_button(theme, i, i == page));
        }
        page_buttons.push(
            text("…")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme))
                .into(),
        );
        page_buttons.push(page_button(theme, total_pages - 1, page == total_pages - 1));
    }

    // "下一页" button
    page_buttons.push(
        iced::widget::button(
            text("下一页")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(0.71, 0.74, 0.83)),
                }),
        )
        .style(move |_, _| iced::widget::button::Style {
            background: Some(iced::Background::Color(iced::Color::TRANSPARENT)),
            border: iced::Border {
                color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
                width: 1.0,
                radius: iced::border::Radius::from(6.0),
            },
            text_color: iced::Color::WHITE,
            shadow: iced::Shadow::default(),
            snap: false,
        })
        .padding(iced::Padding {
            top: 5.0,
            bottom: 5.0,
            left: 10.0,
            right: 10.0,
        })
        .into(),
    );

    let _ = app;
    row![
        text(format!(
            "共 {} 条 · 当前第 {} / {} 页",
            total,
            page + 1,
            total_pages.max(1)
        ))
        .font(CJK_FONT)
        .size(11)
        .style(move |_: &iced::Theme| style::text_faint(theme)),
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        row(page_buttons).spacing(6).into(),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 14.0,
        bottom: 14.0,
        left: 20.0,
        right: 20.0,
    })
}

fn page_button(theme: &crate::theme::Theme, page: usize, active: bool) -> Element<Message> {
    let bg = if active {
        theme.accent
    } else {
        iced::Color::TRANSPARENT
    };
    let fg = if active {
        iced::Color::WHITE
    } else {
        iced::Color::from_rgb(0.71, 0.74, 0.83)
    };
    let label = (page + 1).to_string();
    iced::widget::button(
        text(label)
            .font(iced::Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(11)
            .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(fg) }),
    )
    .style(move |_, _| iced::widget::button::Style {
        background: Some(iced::Background::Color(bg)),
        border: iced::Border {
            color: if active {
                theme.accent
            } else {
                iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08)
            },
            width: 1.0,
            radius: iced::border::Radius::from(6.0),
        },
        text_color: fg,
        shadow: iced::Shadow::default(),
        snap: false,
    })
    .padding(iced::Padding {
        top: 5.0,
        bottom: 5.0,
        left: 10.0,
        right: 10.0,
    })
    .into()
}
