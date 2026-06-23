//! Scheduler page — cron-based scheduled tasks.

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let tasks = app.tasks.read().clone();

    let header = widgets::page_header(theme, "定时任务", "使用 5 段 cron 表达式调度代理自动执行");

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
