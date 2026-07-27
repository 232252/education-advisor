//! Dashboard page — overview stats and quick insights.

use iced::widget::{column, container, progress_bar, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message, Page};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let stats = app.stats.read().clone().unwrap_or_default();

    let header = widgets::page_header(theme, "总览", "学校数据概览与 AI 代理活动一览");

    // KPI cards
    let total_card = widgets::kpi_card::<Message>(
        theme,
        "🎓",
        stats.total_students.to_string(),
        "学生总数",
        theme.accent,
    );

    let high_risk = stats.risk_distribution[2] + stats.risk_distribution[3];
    let risk_card = widgets::kpi_card::<Message>(
        theme,
        "⚠️",
        high_risk.to_string(),
        "高风险学生",
        theme.danger,
    );

    let gpa_card = widgets::kpi_card::<Message>(
        theme,
        "📊",
        format!("{:.2}", stats.avg_gpa),
        "平均 GPA",
        theme.success,
    );

    let conv_card = widgets::kpi_card::<Message>(
        theme,
        "💬",
        stats.conversations_today.to_string(),
        "今日对话",
        theme.purple,
    );

    let kpi_row = row![total_card, risk_card, gpa_card, conv_card]
        .spacing(12)
        .width(Length::Fill)
        .wrap();

    let risk_section = risk_distribution_card(app);
    let trend_section = grade_trend_card(app);
    let agent_section = agent_activity_card(app);
    let conv_section = recent_conversations_card(app);

    let content = column![
        header,
        kpi_row,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)),
        risk_section,
        row![trend_section, agent_section].spacing(12),
        conv_section,
    ]
    .spacing(12)
    .width(Length::Fill);

    scrollable(content)
        .style(move |_, _| style::scrollable(theme))
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}

fn risk_distribution_card<'a>(app: &'a App) -> Element<'a, Message> {
    let theme = &app.theme;
    let stats = app.stats.read().clone().unwrap_or_default();
    let labels = ["低风险", "中风险", "高风险", "危机"];
    let colors = [
        theme.success,
        theme.warning,
        iced::Color::from_rgb8(249, 115, 22),
        theme.danger,
    ];
    let total: usize = stats.risk_distribution.iter().sum::<usize>().max(1);

    let mut rows: Vec<Element<Message>> = Vec::new();
    rows.push(widgets::section_title(theme, "风险分布").into());

    // Stacked capsule bar: one row of containers, each FillPortion by ratio, 14px tall, 7px radius
    let mut bar_segments: Vec<Element<Message>> = Vec::new();
    for (i, &count) in stats.risk_distribution.iter().enumerate() {
        if count == 0 {
            continue;
        }
        let color = colors[i];
        let portion = ((count as f32 / total as f32) * 100.0).max(1.0) as u16;
        bar_segments.push(
            container(Space::new().width(Length::Fill).height(Length::Fixed(14.0)))
                .style(move |_: &iced::Theme| iced::widget::container::Style {
                    background: Some(iced::Background::Color(color)),
                    border: iced::Border {
                        color: iced::Color::TRANSPARENT,
                        width: 0.0,
                        radius: iced::border::Radius::from(7.0),
                    },
                    ..Default::default()
                })
                .width(Length::FillPortion(portion))
                .height(Length::Fixed(14.0))
                .into(),
        );
    }
    if !bar_segments.is_empty() {
        rows.push(row(bar_segments).spacing(2).width(Length::Fill).into());
        rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
    }

    // Detail rows: label(60px) + capsule progress bar(girth 10px, radius 5px) + percentage value(50px)
    for (i, &count) in stats.risk_distribution.iter().enumerate() {
        let pct = count as f32 / total as f32;
        let color = colors[i];

        let bar = progress_bar(0.0..=1.0, pct)
            .style(move |_: &iced::Theme| iced::widget::progress_bar::Style {
                background: iced::Background::Color(iced::Color { a: 0.1, ..color }),
                bar: iced::Background::Color(color),
                border: iced::Border {
                    radius: iced::border::Radius::from(5.0),
                    ..Default::default()
                },
            })
            .girth(Length::Fixed(10.0))
            .length(Length::Fill);

        let row_item = row![
            text(labels[i])
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme))
                .width(Length::Fixed(60.0)),
            bar,
            text(format!("{:.0}%", pct * 100.0))
                .font(CJK_FONT)
                .size(13)
                .font(Font {
                    family: CJK_FONT.family,
                    weight: iced::font::Weight::Bold,
                    ..Default::default()
                })
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(color),
                })
                .width(Length::Fixed(50.0)),
        ]
        .spacing(12)
        .align_y(Alignment::Center);

        rows.push(row_item.into());
        rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
    }

    widgets::card(theme, column(rows).spacing(4).width(Length::Fill))
}

fn grade_trend_card<'a>(app: &'a App) -> Element<'a, Message> {
    let theme = &app.theme;
    let stats = app.stats.read().clone().unwrap_or_default();
    let mut rows: Vec<Element<Message>> = Vec::new();
    rows.push(widgets::section_title(theme, "成绩趋势").into());

    if stats.grade_trend.is_empty() {
        rows.push(
            text("暂无数据")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_faint(theme))
                .into(),
        );
    } else {
        let max_score = stats
            .grade_trend
            .iter()
            .map(|(_, v)| *v)
            .fold(0.0f32, f32::max)
            .max(1.0);

        for (label, score) in &stats.grade_trend {
            let pct = (*score / max_score).clamp(0.0, 1.0);

            // Dual-track bar: outer container (background track) + inner container (foreground track)
            let portion = (pct * 100.0).max(1.0) as u16;

            let dual_bar = container(
                row![container(Space::new().width(Length::FillPortion(portion)).height(Length::Fixed(10.0)))
                    .style(move |_: &iced::Theme| iced::widget::container::Style {
                        background: Some(iced::Background::Color(theme.accent)),
                        border: iced::Border {
                            color: iced::Color::TRANSPARENT,
                            width: 0.0,
                            radius: iced::border::Radius::from(6.0),
                        },
                        ..Default::default()
                    }),
                    Space::new().width(Length::FillPortion((100 - portion).max(1))).height(Length::Fixed(10.0))]
                .align_y(Alignment::Center),
            )
            .style(move |_: &iced::Theme| iced::widget::container::Style {
                background: Some(iced::Background::Color(iced::Color { a: 0.1, ..theme.accent })),
                border: iced::Border {
                    color: iced::Color::TRANSPARENT,
                    width: 0.0,
                    radius: iced::border::Radius::from(6.0),
                },
                ..Default::default()
            })
            .width(Length::Fill)
            .height(Length::Fixed(10.0));

            let row_item = row![
                text(label.clone())
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_faint(theme))
                    .width(Length::Fixed(50.0)),
                dual_bar.width(Length::Fill),
                text(format!("{:.1}", score))
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.accent),
                    })
                    .width(Length::Fixed(45.0)),
            ]
            .spacing(8)
            .align_y(Alignment::Center);

            rows.push(row_item.into());
            rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(6.0)).into());
        }
    }

    widgets::card(theme, column(rows).spacing(4).width(Length::Fill))
}

fn agent_activity_card<'a>(app: &'a App) -> Element<'a, Message> {
    let theme = &app.theme;
    let stats = app.stats.read().clone().unwrap_or_default();
    let mut rows: Vec<Element<Message>> = Vec::new();
    rows.push(widgets::section_title(theme, "代理活动").into());

    if stats.agent_activity.is_empty() {
        let empty_content = column![
            text("🤖").size(48),
            text("暂无代理活动")
                .font(CJK_FONT)
                .size(15)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            text("当 AI 代理执行任务后，活动数据将在此展示")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(8)
        .align_x(Alignment::Center);

        rows.push(
            container(empty_content)
                .padding(40.0)
                .width(Length::Fill)
                .align_x(Alignment::Center)
                .align_y(Alignment::Center)
                .into(),
        );
    } else {
        let max_count = stats
            .agent_activity
            .iter()
            .map(|(_, c)| *c)
            .max()
            .unwrap_or(1)
            .max(1);

        for (name, count) in &stats.agent_activity {
            let pct = (*count as f32 / max_count as f32).clamp(0.0, 1.0);
            let bar = progress_bar(0.0..=1.0, pct)
                .style(move |_: &iced::Theme| iced::widget::progress_bar::Style {
                    background: iced::Background::Color(iced::Color { a: 0.1, ..theme.purple }),
                    bar: iced::Background::Color(theme.purple),
                    border: iced::Border::default(),
                })
                .girth(Length::Fixed(6.0))
                .length(Length::Fill);

            let row_item = row![
                text(name.clone())
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_faint(theme))
                    .width(Length::Fixed(60.0)),
                bar,
                text(format!("{}", count))
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme))
                    .width(Length::Fixed(30.0)),
            ]
            .spacing(8)
            .align_y(Alignment::Center);

            rows.push(row_item.into());
            rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(6.0)).into());
        }
    }

    widgets::card(theme, column(rows).spacing(4).width(Length::Fill))
}

fn recent_conversations_card(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let convs = app.conversations.read().clone();
    let mut rows: Vec<Element<Message>> = Vec::new();
    rows.push(widgets::section_title(theme, "最近对话").into());

    if convs.is_empty() {
        rows.push(
            widgets::empty_state_with_cta(
                theme,
                "💬",
                "还没有对话记录",
                "点击按钮创建你的第一个对话",
                "开始新对话",
                Message::Navigate(Page::Chat),
            )
            .into(),
        );
    } else {
        for c in convs.iter().take(5) {
            let item = row![
                text("●")
                    .size(10)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.accent),
                    }),
                column![
                    text(c.title.clone())
                        .font(CJK_FONT)
                        .size(13)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    text(format!(
                        "{} · {}",
                        c.agent_id,
                        c.updated_at.format("%m-%d %H:%M")
                    ))
                    .font(CJK_FONT)
                    .size(11)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
                ]
                .spacing(2),
            ]
            .spacing(10)
            .align_y(Alignment::Center);

            let btn = iced::widget::button(item)
                .style(move |_, status| style::ghost_button(theme, status))
                .padding(Padding::from([6.0, 8.0]))
                .width(Length::Fill)
                .on_press(Message::NavigateToChat(c.id));

            rows.push(btn.into());
            rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)).into());
        }
    }

    widgets::card(theme, column(rows).spacing(4).width(Length::Fill))
}
