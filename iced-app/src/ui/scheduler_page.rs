//! Scheduler page — cron-based scheduled tasks.
//!
//! Layout (matches `iced-app/preview/index.html#page-scheduler`):
//!
//! ```text
//! ┌──────────────── pageHead ────────────────┐
//! ├ grid-cols-2 (1/1 on Compact) ────────────┤
//! │  ┌── Card ──┐  ┌── Card ──┐              │
//! │  │ head     │  │ head     │              │
//! │  │ toggle   │  │ toggle   │              │
//! │  │ 2-col    │  │ 2-col    │              │
//! │  │ actions  │  │ actions  │              │
//! │  └──────────┘  └──────────┘              │
//! └──────────────────────────────────────────┘
//! ```
//!
//! Each card has:
//! * `header-row` (clock icon + name + active/paused pill + cron pill + toggle)
//! * 2-col body (agent / last-run / next-run)
//! * action row (edit / log / run-now)
//!
//! Responsive: `LayoutMode::Compact` collapses to a single column.

use iced::widget::{column, container, row, scrollable, text, Space, Svg};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::ScheduledTask;
use crate::ui::components;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;
use crate::ui::widgets;

/// Public page entry — same signature as cycle 1, body rewritten to render
/// a `.grid-cols-2` of cron cards with status pill, toggle switch, and
/// the three action buttons (edit / log / run-now).
pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = app.layout_mode;

    let header = widgets::page_header(
        theme,
        "调度",
        "Cron 调度器 · 每 30s 唤醒 · 触发后为每次执行创建独立对话",
    );

    // Editing form takes over the whole page.
    if let Some(editing) = app.ui_state.editing_task.clone() {
        return column![
            header,
            Space::new().width(0.0).height(style::spacing::MD),
            task_edit_form(app, editing),
        ]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into();
    }

    let tasks = app.tasks.read().clone();
    let mut cards: Vec<Element<Message>> = Vec::new();

    // New-task card (mirrors the "+" tile in preview's grid).
    cards.push(new_task_card(app));

    if tasks.is_empty() {
        cards.push(
            components::empty_state::empty_state(
                IconName::Clock,
                "还没有定时任务",
                "点击左上角「新增任务」卡片创建你的第一个 Cron 调度",
            )
            .into(),
        );
    } else {
        for t in tasks.iter() {
            cards.push(task_card(app, t));
        }
    }

    let body: Element<Message> = if mode.is_compact() {
        let mut col = column![].spacing(style::spacing::MD).width(Length::Fill);
        for c in cards {
            col = col.push(c);
        }
        col.into()
    } else {
        // 2-col grid via wrapping pairs.
        let mut col = column![].spacing(style::spacing::MD).width(Length::Fill);
        let mut iter = cards.into_iter();
        while let Some(a) = iter.next() {
            let b = iter.next();
            let r = if let Some(b_el) = b {
                row![a, Space::new().width(style::spacing::MD), b_el]
                    .spacing(0)
                    .width(Length::Fill)
            } else {
                row![a].spacing(0).width(Length::Fill)
            };
            col = col.push(r);
        }
        col.into()
    };

    let content = scrollable(body).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().width(0.0).height(style::spacing::MD),
        container(content).width(Length::Fill).height(Length::Fill),
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

// ── New-task tile ──────────────────────────────────────────────────

fn new_task_card(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let clock: Element<Message> = Svg::new(icon(IconName::Plus))
        .width(Length::Fixed(22.0))
        .height(Length::Fixed(22.0))
        .into();

    let body = column![
        clock,
        Space::new().width(0.0).height(style::spacing::SM),
        text("新增任务")
            .size(15)
            .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        Space::new().width(0.0).height(style::spacing::XS),
        text("为任意代理配置 Cron 表达式")
            .size(11.5)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(0)
    .align_x(Alignment::Center)
    .padding(style::spacing::LG);

    let on_press = Message::EditTask(Some(ScheduledTask {
        id: uuid::Uuid::new_v4(),
        name: String::new(),
        cron_expr: "0 9 * * *".into(),
        agent_id: "main".into(),
        prompt: String::new(),
        enabled: true,
        last_run: None,
        next_run: None,
        created_at: chrono::Utc::now(),
    }));

    button_card(app, body, on_press)
}

fn button_card(
    app: &App,
    content: iced::widget::Column<'_, Message>,
    on_press: Message,
) -> Element<Message> {
    let theme = &app.theme;
    container(
        iced::widget::button(content)
            .style(move |_, status| {
                let bg = match status {
                    iced::widget::button::Status::Hovered => theme.surface_glass,
                    _ => iced::Color::TRANSPARENT,
                };
                iced::widget::button::Style {
                    background: Some(iced::Background::Color(bg)),
                    text_color: theme.text,
                    border: iced::Border {
                        color: iced::Color::TRANSPARENT,
                        width: 0.0,
                        radius: iced::border::Radius::from(style::radius::XL),
                    },
                    ..Default::default()
                }
            })
            .padding(0)
            .on_press(on_press)
            .width(Length::Fill),
    )
    .style(move |_: &iced::Theme| style::card_flat(theme))
    .padding(0)
    .width(Length::Fill)
    .into()
}

// ── Existing task card ─────────────────────────────────────────────

fn task_card(app: &App, task: &ScheduledTask) -> Element<Message> {
    let theme = &app.theme;
    let enabled = task.enabled;
    let active_tone = if enabled {
        components::badge::PillTone::Emerald
    } else {
        components::badge::PillTone::Zinc
    };
    let status_label = if enabled { "运行中" } else { "已暂停" };

    let agent = crate::agents::find(&task.agent_id);
    let agent_name = agent.map(|a| a.name).unwrap_or(&task.agent_id).to_string();
    let last_run = task
        .last_run
        .map(|d| d.format("%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "—".into());
    let next_run = task
        .next_run
        .map(|d| d.format("%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "—".into());

    // ── Header row: clock + name + pills + toggle ──
    let name_text = text(task.name.clone())
        .size(14)
        .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
        .style(move |_: &iced::Theme| style::text_primary(theme));

    let pills_row = row![
        components::badge::pill_with_dot(status_label, active_tone, true),
        Space::new().width(style::spacing::SM),
        components::badge::pill(&task.cron_expr, components::badge::PillTone::Zinc),
    ]
    .spacing(0)
    .align_y(Alignment::Center);

    let toggle = toggle_switch(
        theme,
        enabled,
        Message::EditTask(Some(ScheduledTask {
            enabled: !enabled,
            ..task.clone()
        })),
    );

    let head = row![
        row![
            Svg::new(icon(IconName::Clock))
                .width(Length::Fixed(16.0))
                .height(Length::Fixed(16.0)),
            Space::new().width(style::spacing::SM),
            column![name_text, Space::new().width(0.0).height(style::spacing::XS), pills_row]
                .spacing(0),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
        Space::new().width(Length::Fill).height(0),
        toggle,
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    // ── Divider ──
    let divider = container(Space::new().width(Length::Fill).height(Length::Fixed(1.0)))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(style::border_step::hairline(theme))),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(0.0),
            },
            ..Default::default()
        })
        .width(Length::Fill);

    // ── 2-col info grid: agent / last / next ──
    let next_color = theme.purple;
    let info_grid = row![
        col_kv(theme, "代理", &agent_name, false),
        col_kv(theme, "上次执行", &last_run, false),
    ]
    .spacing(style::spacing::LG)
    .width(Length::Fill);

    let next_row = column![
        text("下次执行")
            .size(11)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        Space::new().width(0.0).height(style::spacing::XS),
        text(next_run)
            .size(13)
            .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
            .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(next_color), ..Default::default() }),
    ]
    .spacing(0);

    // ── Actions row: edit / log / run-now ──
    let edit_btn = action_btn(theme, IconName::Edit, "编辑", Message::EditTask(Some(task.clone())));
    let log_btn = action_btn(theme, IconName::History, "日志", Message::EditTask(Some(task.clone())));
    let run_btn = primary_action_btn(theme, IconName::Play, "立即执行", Message::RunTaskNow(task.id));
    let delete_btn = action_btn(theme, IconName::Trash, "删除", Message::DeleteTask(task.id));
    let actions = row![
        delete_btn,
        Space::new().width(Length::Fill).height(0),
        edit_btn,
        log_btn,
        run_btn,
    ]
    .spacing(style::spacing::SM)
    .align_y(Alignment::Center);

    let body = column![
        head,
        Space::new().width(0.0).height(style::spacing::MD),
        divider,
        Space::new().width(0.0).height(style::spacing::MD),
        info_grid,
        Space::new().width(0.0).height(style::spacing::MD),
        next_row,
        Space::new().width(0.0).height(style::spacing::MD),
        divider,
        Space::new().width(0.0).height(style::spacing::MD),
        actions,
    ]
    .spacing(0)
    .padding(Padding { top: 18.0, bottom: 18.0, left: 20.0, right: 20.0 });

    container(body)
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .padding(0)
        .width(Length::Fill)
        .into()
}

fn col_kv(theme: &crate::theme::Theme, label: &str, value: &str, _mono: bool) -> Element<Message> {
    column![
        text(label)
            .size(11)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        Space::new().width(0.0).height(style::spacing::XS),
        text(value.to_string())
            .size(13)
            .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
            .style(move |_: &iced::Theme| style::text_primary(theme)),
    ]
    .spacing(0)
    .into()
}

fn toggle_switch(
    theme: &crate::theme::Theme,
    on: bool,
    on_press: Message,
) -> Element<Message> {
    let bg = if on {
        theme.purple
    } else {
        style::border_step::strong(theme)
    };
    let thumb_offset = if on { 18.0 } else { 2.0 };
    let thumb = container(Space::new().width(Length::Fixed(18.0)).height(Length::Fixed(18.0)))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::WHITE)),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(style::radius::PILL),
            },
            ..Default::default()
        });
    let track = container(
        row![
            Space::new().width(Length::Fixed(thumb_offset)).height(0),
            thumb,
        ]
        .spacing(0)
        .align_y(Alignment::Center)
        .padding(0),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(bg)),
        border: iced::Border {
            color: iced::Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(style::radius::PILL),
        },
        ..Default::default()
    })
    .width(Length::Fixed(38.0))
    .height(Length::Fixed(22.0))
    .padding(Padding { top: 2.0, bottom: 2.0, left: 0.0, right: 0.0 });

    // Wrap in a transparent button so we can dispatch the message.
    iced::widget::button(track)
        .style(|_t, _status| iced::widget::button::Style {
            background: Some(iced::Background::Color(iced::Color::TRANSPARENT)),
            text_color: iced::Color::WHITE,
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(style::radius::PILL),
            },
            ..Default::default()
        })
        .padding(0)
        .on_press(on_press)
        .into()
}

fn action_btn(
    theme: &crate::theme::Theme,
    ic: IconName,
    label: &str,
    on_press: Message,
) -> Element<Message> {
    iced::widget::button(
        row![
            Svg::new(icon(ic))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            Space::new().width(5).height(0),
            text(label)
                .size(11.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([4.0, 10.0])
    .on_press(on_press)
    .into()
}

fn primary_action_btn(
    theme: &crate::theme::Theme,
    ic: IconName,
    label: &str,
    on_press: Message,
) -> Element<Message> {
    iced::widget::button(
        row![
            Svg::new(icon(ic))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            Space::new().width(5).height(0),
            text(label)
                .size(11.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(iced::Color::WHITE), ..Default::default() }),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::primary_button(theme, status))
    .padding([4.0, 10.0])
    .on_press(on_press)
    .into()
}

// ── Edit form ──────────────────────────────────────────────────────

fn task_edit_form(app: &App, task: ScheduledTask) -> Element<Message> {
    use iced::widget::{pick_list, text_input};
    let theme = &app.theme;
    let mut items: Vec<Element<Message>> = Vec::new();

    items.push(
        text(if task.name.is_empty() { "新增任务" } else { "编辑任务" })
            .size(20)
            .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
            .style(move |_: &iced::Theme| style::text_primary(theme))
            .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::LG).into());

    let t = task.clone();

    items.push(
        column![
            text("任务名称")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(style::spacing::XS),
            text_input("输入任务名称", &t.name)
                .on_input(|v| Message::TaskFieldChanged(crate::app::TaskField::Name(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(0)
        .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::SM).into());

    items.push(
        column![
            text("Cron 表达式")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(style::spacing::XS),
            text_input("例如: 0 9 * * *", &t.cron_expr)
                .on_input(|v| Message::TaskFieldChanged(crate::app::TaskField::CronExpr(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(0)
        .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::SM).into());

    let agents = crate::agents::all_agents();
    let agent_names: Vec<String> = agents.iter().map(|a| a.id.to_string()).collect();
    let current_agent = t.agent_id.clone();

    items.push(
        column![
            text("执行代理")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(style::spacing::XS),
            pick_list(
                agent_names,
                Some(current_agent),
                move |id| Message::TaskFieldChanged(crate::app::TaskField::AgentId(id)),
            )
            .font(CJK_FONT)
            .text_size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::pick_list_style(theme, status))
            .width(Length::Fill),
        ]
        .spacing(0)
        .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::SM).into());

    items.push(
        column![
            text("提示词")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(style::spacing::XS),
            text_input("输入每次执行时发送给代理的提示词", &t.prompt)
                .on_input(|v| Message::TaskFieldChanged(crate::app::TaskField::Prompt(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(0)
        .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::SM).into());

    let enabled_options = vec!["启用".to_string(), "禁用".to_string()];
    let current_enabled = if t.enabled { "启用".to_string() } else { "禁用".to_string() };

    items.push(
        column![
            text("状态")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(style::spacing::XS),
            pick_list(
                enabled_options,
                Some(current_enabled),
                move |label| Message::TaskFieldChanged(crate::app::TaskField::Enabled(label == "启用")),
            )
            .font(CJK_FONT)
            .text_size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::pick_list_style(theme, status))
            .width(Length::Fill),
        ]
        .spacing(0)
        .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::LG).into());

    let actions = row![
        iced::widget::button(
            text("保存")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(iced::Color::WHITE), ..Default::default() }),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::SaveTask),
        iced::widget::button(
            text("取消")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::EditTask(None)),
    ]
    .spacing(style::spacing::MD);

    items.push(actions.into());

    let content = column(items).spacing(0).width(Length::Fill);
    container(
        scrollable(content).style(move |_, _| style::scrollable(theme)),
    )
    .style(move |_: &iced::Theme| style::card_flat(theme))
    .padding(Padding::from(20.0))
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

// ── Cross-cutting helpers (kept private to this page) ──────────────