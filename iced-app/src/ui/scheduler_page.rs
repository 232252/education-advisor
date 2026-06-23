//! Scheduler page — cron-based scheduled tasks.

use iced::widget::{column, container, row, scrollable, text, text_input, pick_list, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let header = widgets::page_header(theme, "定时任务", "使用 5 段 cron 表达式调度代理自动执行");

    // If editing, show edit form
    if let Some(editing) = app.ui_state.editing_task.clone() {
        return column![
            header,
            Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)),
            task_edit_form(app, editing)
        ]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into();
    }

    let tasks = app.tasks.read().clone();
    let mut items: Vec<Element<Message>> = Vec::new();

    // Add button
    items.push(
        iced::widget::button(
            row![
                text("✚").size(14).style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
                text("新增任务")
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
        .padding([8.0, 14.0])
        .on_press(Message::EditTask(Some(crate::models::ScheduledTask {
            id: uuid::Uuid::new_v4(),
            name: String::new(),
            cron_expr: "0 9 * * *".into(),
            agent_id: "main".into(),
            prompt: String::new(),
            enabled: true,
            last_run: None,
            next_run: None,
            created_at: chrono::Utc::now(),
        })))
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    if tasks.is_empty() {
        items.push(
            widgets::empty_state(theme, "⏰", "还没有定时任务")
                .into(),
        );
    } else {
        for t in &tasks {
            let agent = crate::agents::find(&t.agent_id);
            let agent_name = agent.map(|a| a.name).unwrap_or(&t.agent_id).to_string();
            let enabled = t.enabled;
            let success_color = theme.success;
            let faint_color = theme.text_faint;

            let card_content = column![
                row![
                    text(if enabled { "●" } else { "○" })
                        .size(12)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(if enabled { success_color } else { faint_color }),
                        }),
                    text(t.name.clone())
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(14)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
                    widgets::badge(theme, theme.info, t.cron_expr.clone()),
                ]
                .align_y(Alignment::Center)
                .spacing(8),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(6.0)),
                text(crate::util::truncate(&t.prompt, 80))
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme)),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(6.0)),
                row![
                    widgets::badge(theme, theme.purple, agent_name.clone()),
                    text(format!(
                        "下次: {}",
                        t.next_run
                            .map(|d| d.format("%m-%d %H:%M").to_string())
                            .unwrap_or_else(|| "—".into())
                    ))
                    .font(CJK_FONT)
                    .size(11)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
                ]
                .spacing(8)
                .align_y(Alignment::Center),
            ]
            .spacing(0)
            .width(Length::Fill);

            let actions = row![
                iced::widget::button(
                    text("▶ 立即运行")
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(iced::Color::WHITE),
                        }),
                )
                .style(move |_, status| style::primary_button(theme, status))
                .padding([6.0, 10.0])
                .on_press(Message::RunTaskNow(t.id)),
                iced::widget::button(
                    text("✎ 编辑")
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| style::text_dim(theme)),
                )
                .style(move |_, status| style::secondary_button(theme, status))
                .padding([6.0, 10.0])
                .on_press(Message::EditTask(Some(t.clone()))),
                iced::widget::button(
                    text("✕ 删除")
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(iced::Color::WHITE),
                        }),
                )
                .style(move |_, status| style::danger_button(theme, status))
                .padding([6.0, 10.0])
                .on_press(Message::DeleteTask(t.id)),
            ]
            .spacing(8);

            let full = column![
                container(card_content)
                    .style(move |_: &iced::Theme| style::card_flat(theme))
                    .padding(Padding::from(14.0))
                    .width(Length::Fill),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)),
                actions,
            ]
            .spacing(0)
            .width(Length::Fill);

            items.push(full.into());
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
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

fn task_edit_form(app: &App, task: crate::models::ScheduledTask) -> Element<Message> {
    let theme = &app.theme;
    let mut items: Vec<Element<Message>> = Vec::new();

    items.push(
        text(if task.name.is_empty() { "新增任务" } else { "编辑任务" })
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(20)
            .style(move |_: &iced::Theme| style::text_primary(theme))
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    let t = task.clone();

    // Name
    items.push(
        column![
            text("任务名称")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("输入任务名称", &t.name)
                .on_input(|v| Message::TaskFieldChanged(crate::app::TaskField::Name(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Cron expression
    items.push(
        column![
            text("Cron 表达式")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("例如: 0 9 * * *", &t.cron_expr)
                .on_input(|v| Message::TaskFieldChanged(crate::app::TaskField::CronExpr(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Agent picker
    let agents = crate::agents::all_agents();
    let agent_names: Vec<String> = agents.iter().map(|a| a.id.to_string()).collect();
    let current_agent = t.agent_id.clone();

    items.push(
        column![
            text("执行代理")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
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
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Prompt
    items.push(
        column![
            text("提示词")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("输入每次执行时发送给代理的提示词", &t.prompt)
                .on_input(|v| Message::TaskFieldChanged(crate::app::TaskField::Prompt(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Enabled toggle
    let enabled_options = vec!["启用".to_string(), "禁用".to_string()];
    let current_enabled = if t.enabled { "启用".to_string() } else { "禁用".to_string() };

    items.push(
        column![
            text("状态")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
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
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    // Actions
    let actions = row![
        iced::widget::button(
            text("保存")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
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
    .spacing(12);
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
