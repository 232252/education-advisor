//! Dashboard page — overview stats and quick insights.
//!
//! Aligns 1:1 with `#page-dashboard` in `iced-app/preview/index.html`:
//!
//! ```text
//!   pageHead('总览', …)
//!   .kpi-grid              (4-col on Wide, 2-col on Medium, 1-col on Compact)
//!   .row-2                 (risk 分布 + 成绩趋势)
//!   .row-2                 (最近对话 + 代理活跃度)
//! ```
//!
//! On Compact (`< 900 px`) `row-2` collapses to a single column via
//! `responsive::LayoutMode::dashboard_row_collapse()`. The KPI grid uses
//! `LayoutMode::kpi_columns()` to choose between 1/2/4 columns.
//!
//! Building blocks:
//! * `components::kpi::kpi_card`  — replaces the old `widgets::kpi_card`
//! * `components::section_header`  — replaces `widgets::section_title`
//! * `components::score_bar::score_row` — replaces the manual `progress_bar`
//!   inside `grade_trend_card`
//! * `components::capsule_bar::capsule_bar` — stacked risk distribution
//! * `components::empty_state` — replaces `widgets::empty_state`
//! * `ui::icons::IconName`        — replaces the literal `🎓 / ⚠️ / 📊 / 💬` emoji

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Length};

use crate::app::{App, CJK_FONT, Message, Page};
use crate::ui::components::badge::{self as badge, PillTone};
use crate::ui::components::capsule_bar;
use crate::ui::components::kpi::{kpi_card, DeltaDir, KpiSpec};
use crate::ui::components::score_bar::score_row;
use crate::ui::components::section_header::section_header;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let stats = app.stats.read().clone().unwrap_or_default();
    let mode = app.layout_mode;

    // Use the page header widget as a baseline (it still supplies the CJK
    // title + subtitle block), but layer `section_header` on top of each
    // card so the visual treatment matches the preview's `.section-title`.
    let header = widgets::page_header(theme, "总览", "学校数据概览与 AI 代理活动一览");

    // ── KPI grid ──────────────────────────────────────────────────────
    let high_risk = stats.risk_distribution[2] + stats.risk_distribution[3];

    let kpi_total = KpiSpec {
        label: "学生总数".into(),
        value: stats.total_students.to_string(),
        delta: "本学期".into(),
        delta_dir: DeltaDir::Neutral,
        icon: IconName::GraduationCap,
        accent: (168, 85, 247), // preview purple
        mono: false,
    };
    let kpi_risk = KpiSpec {
        label: "高风险学生".into(),
        value: high_risk.to_string(),
        delta: "需关注".into(),
        delta_dir: DeltaDir::Down,
        icon: IconName::AlertTriangle,
        accent: (239, 68, 68), // preview red
        mono: false,
    };
    let kpi_gpa = KpiSpec {
        label: "平均 GPA".into(),
        value: format!("{:.2}", stats.avg_gpa),
        delta: "↑ 0.08".into(),
        delta_dir: DeltaDir::Up,
        icon: IconName::TrendingUp,
        accent: (16, 185, 129), // preview emerald
        mono: true,
    };
    let kpi_conv = KpiSpec {
        label: "今日对话".into(),
        value: stats.conversations_today.to_string(),
        delta: format!("{} 次工具调用", stats.tool_calls_total),
        delta_dir: DeltaDir::Up,
        icon: IconName::Message,
        accent: (6, 182, 212), // preview cyan
        mono: false,
    };
    let kpis = vec![kpi_total, kpi_risk, kpi_gpa, kpi_conv];

    // Build the KPI grid. `kpi_columns` returns 1 / 2 / 4.
    let kpi_columns = mode.kpi_columns();
    let kpi_grid: Element<Message> = if kpi_columns == 1 {
        // Compact: a single column of full-width cards.
        let mut items: Vec<Element<Message>> = Vec::with_capacity(kpis.len());
        for spec in &kpis {
            items.push(kpi_card::<Message>(spec));
        }
        column(items).spacing(12).width(Length::Fill).into()
    } else {
        // Medium (2) / Wide (4): wrap a row of `kpi_columns` cards.
        let mut current_row: Vec<Element<Message>> = Vec::new();
        let mut rows: Vec<Element<Message>> = Vec::new();
        for (idx, spec) in kpis.iter().enumerate() {
            current_row.push(kpi_card::<Message>(spec));
            if current_row.len() == kpi_columns as usize || idx == kpis.len() - 1 {
                let r = row(std::mem::take(&mut current_row))
                    .spacing(12)
                    .width(Length::Fill);
                rows.push(r.into());
            }
        }
        column(rows).spacing(12).width(Length::Fill).into()
    };

    // ── Row 2a: risk distribution + grade trend ───────────────────────
    let risk_section = risk_distribution_card(app);
    let trend_section = grade_trend_card(app);

    // ── Row 2b: recent conversations + agent activity ─────────────────
    let conv_section = recent_conversations_card(app);
    let agent_section = agent_activity_card(app);

    // Row-2 layout branches on `dashboard_row_collapse()`.
    let row_2_collapse = mode.dashboard_row_collapse();
    let row_2_a: Element<Message> = if row_2_collapse {
        column![risk_section, trend_section]
            .spacing(12)
            .width(Length::Fill)
            .into()
    } else {
        row![risk_section, trend_section]
            .spacing(12)
            .width(Length::Fill)
            .into()
    };
    let row_2_b: Element<Message> = if row_2_collapse {
        column![conv_section, agent_section]
            .spacing(12)
            .width(Length::Fill)
            .into()
    } else {
        row![conv_section, agent_section]
            .spacing(12)
            .width(Length::Fill)
            .into()
    };

    let content = column![
        header,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)),
        kpi_grid,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)),
        row_2_a,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)),
        row_2_b,
    ]
    .spacing(0)
    .width(Length::Fill);

    scrollable(content)
        .style(move |_, _| style::scrollable(theme))
        .width(Length::Fill)
        .height(Length::Fill)
        .into()
}

// ── risk distribution card ─────────────────────────────────────────

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

    let mut card_inner: Vec<Element<Message>> = Vec::new();

    // Card head: section header icon + title + subtitle
    let head: Element<Message> = row![
        section_header::<Message>("风险分布", Some(IconName::AlertTriangle)),
        Space::new().width(Length::Fixed(8.0)).height(Length::Fixed(0.0)),
        text(format!("共 {} 名学生", total))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .align_y(Alignment::Center)
    .into();
    card_inner.push(head);
    card_inner.push(Space::new().width(0.0).height(12.0).into());

    // Stacked capsule bar: one row of containers, each FillPortion by ratio,
    // 18 px tall, 8 px radius — matches preview's `height:18px;border-radius:8px`.
    let mut bar_segments: Vec<Element<Message>> = Vec::new();
    for (i, &count) in stats.risk_distribution.iter().enumerate() {
        if count == 0 {
            continue;
        }
        let color = colors[i];
        let portion = ((count as f32 / total as f32) * 100.0).max(1.0) as u16;
        let first = i == 0 || stats.risk_distribution[..i].iter().all(|c| *c == 0);
        bar_segments.push(
            container(Space::new().width(Length::Fill).height(Length::Fixed(18.0)))
                .style(move |_: &iced::Theme| iced::widget::container::Style {
                    background: Some(iced::Background::Color(color)),
                    border: iced::Border {
                        color: if first {
                            iced::Color::TRANSPARENT
                        } else {
                            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.15)
                        },
                        width: if first { 0.0 } else { 1.0 },
                        radius: iced::border::Radius::from(8.0),
                    },
                    ..Default::default()
                })
                .width(Length::FillPortion(portion))
                .height(Length::Fixed(18.0))
                .into(),
        );
    }
    if !bar_segments.is_empty() {
        card_inner.push(
            row(bar_segments)
                .spacing(0)
                .width(Length::Fill)
                .into(),
        );
        card_inner.push(Space::new().width(0.0).height(18.0).into());
    } else {
        card_inner.push(
            container(iced::widget::Space::new().width(0.0).height(0.0))
                .width(Length::Fill)
                .height(Length::Fixed(18.0))
                .into(),
        );
        card_inner.push(Space::new().width(0.0).height(18.0).into());
    }

    // Detail rows: capsule progress bar (10 px tall) + percentage.
    for (i, &count) in stats.risk_distribution.iter().enumerate() {
        let pct = count as f32 / total as f32;
        let color = colors[i];

        // `capsule_bar` expects a fill gradient. Use a 90 deg gradient
        // tinted by `color` for the filled segment.
        let fill_from = color;
        let fill_to = iced::Color::from_rgba(color.r, color.g, color.b, 0.6);
        let value_color = color;
        let value_text = format!("{:.0}%", pct * 100.0);
        let spec = capsule_bar::CapsuleBar {
            label: labels[i].to_string(),
            dot_color: color,
            pct: pct * 100.0,
            value_text,
            value_color,
            fill_from,
            fill_to,
        };
        card_inner.push(capsule_bar::capsule_bar::<Message>(spec));
        card_inner.push(Space::new().width(0.0).height(8.0).into());
    }

    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}

// ── grade trend card ───────────────────────────────────────────────

fn grade_trend_card<'a>(app: &'a App) -> Element<'a, Message> {
    let theme = &app.theme;
    let stats = app.stats.read().clone().unwrap_or_default();
    let mut card_inner: Vec<Element<Message>> = Vec::new();
    card_inner.push(
        row![
            section_header::<Message>("成绩趋势", Some(IconName::TrendingUp)),
            Space::new().width(Length::Fixed(8.0)).height(Length::Fixed(0.0)),
            text("月考 · 综合分")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .align_y(Alignment::Center)
        .into(),
    );
    card_inner.push(Space::new().width(0.0).height(12.0).into());

    if stats.grade_trend.is_empty() {
        card_inner.push(
            container(
                text("暂无数据")
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            )
            .padding(20.0)
            .width(Length::Fill)
            .align_x(Alignment::Center)
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
            let pct = ((*score / max_score) * 100.0).clamp(0.0, 100.0);
            let value_text = format!("{:.1}", score);
            let value_color = theme.accent;
            // Use a 90 deg linear gradient (preview: `linear-gradient(90deg,#a855f7,#06b6d4)`)
            let c_from = iced::Color::from_rgb(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0);
            let c_to = iced::Color::from_rgb(6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0);
            card_inner.push(score_row::<Message>(
                label,
                pct,
                &value_text,
                value_color,
                c_from,
                c_to,
            ));
            card_inner.push(Space::new().width(0.0).height(6.0).into());
        }
    }

    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}

// ── agent activity card ────────────────────────────────────────────

fn agent_activity_card<'a>(app: &'a App) -> Element<'a, Message> {
    let theme = &app.theme;
    let stats = app.stats.read().clone().unwrap_or_default();
    let mut card_inner: Vec<Element<Message>> = Vec::new();
    card_inner.push(
        row![
            section_header::<Message>("代理活跃度", Some(IconName::Activity)),
            Space::new().width(Length::Fixed(8.0)).height(Length::Fixed(0.0)),
            text("最近 7 天")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .align_y(Alignment::Center)
        .into(),
    );
    card_inner.push(Space::new().width(0.0).height(12.0).into());

    if stats.agent_activity.is_empty() {
        let empty_icon: Element<Message> = container(
            iced::widget::Svg::new(icon(IconName::Bot))
                .width(Length::Fixed(28.0))
                .height(Length::Fixed(28.0)),
        )
        .padding(14.0)
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(
                0.66, 0.33, 0.97, 0.10,
            ))),
            border: iced::Border {
                color: iced::Color::from_rgba(0.66, 0.33, 0.97, 0.20),
                width: 1.0,
                radius: iced::border::Radius::from(16.0),
            },
            ..Default::default()
        })
        .into();
        card_inner.push(
            column![
                empty_icon,
                Space::new().width(0.0).height(8.0).into(),
                text("暂无代理活动")
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| style::text_dim(theme)),
                text("当 AI 代理执行任务后，活动数据将在此展示")
                    .font(CJK_FONT)
                    .size(11)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(6)
            .align_x(Alignment::Center)
            .padding(20.0)
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
            let pct = (*count as f32 / max_count as f32) * 100.0;
            let value_text = format!("{}", count);
            let value_color = theme.purple;
            let c_from = iced::Color::from_rgb(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0);
            let c_to = iced::Color::from_rgb(99.0 / 255.0, 102.0 / 255.0, 241.0 / 255.0);
            card_inner.push(score_row::<Message>(
                name,
                pct,
                &value_text,
                value_color,
                c_from,
                c_to,
            ));
            card_inner.push(Space::new().width(0.0).height(6.0).into());
        }
    }

    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}

// ── recent conversations card ──────────────────────────────────────

fn recent_conversations_card(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let convs = app.conversations.read().clone();
    let mut card_inner: Vec<Element<Message>> = Vec::new();
    card_inner.push(
        row![
            section_header::<Message>("最近对话", Some(IconName::Message)),
            Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
            badge::pill_with_dot::<Message>("查看全部", PillTone::Zinc, false),
        ]
        .align_y(Alignment::Center)
        .into(),
    );
    card_inner.push(Space::new().width(0.0).height(8.0).into());

    if convs.is_empty() {
        card_inner.push(
            container(
                column![
                    container(
                        iced::widget::Svg::new(icon(IconName::Message))
                            .width(Length::Fixed(22.0))
                            .height(Length::Fixed(22.0)),
                    )
                    .padding(12.0)
                    .style(|_| iced::widget::container::Style {
                        background: Some(iced::Background::Color(iced::Color::from_rgba(
                            0.66, 0.33, 0.97, 0.10,
                        ))),
                        border: iced::Border {
                            color: iced::Color::from_rgba(0.66, 0.33, 0.97, 0.20),
                            width: 1.0,
                            radius: iced::border::Radius::from(14.0),
                        },
                        ..Default::default()
                    })
                    .into(),
                    Space::new().width(0.0).height(8.0).into(),
                    text("还没有对话记录")
                        .font(CJK_FONT)
                        .size(13)
                        .style(move |_: &iced::Theme| style::text_dim(theme)),
                    text("点击按钮创建你的第一个对话")
                        .font(CJK_FONT)
                        .size(11)
                        .style(move |_: &iced::Theme| style::text_faint(theme)),
                    Space::new().width(0.0).height(12.0).into(),
                    iced::widget::button(
                        text("开始新对话")
                            .font(CJK_FONT)
                            .size(12)
                            .style(move |_: &iced::Theme| iced::widget::text::Style {
                                color: Some(iced::Color::WHITE),
                            }),
                    )
                    .style(move |_, status| style::primary_button(theme, status))
                    .padding(iced::Padding {
                        top: 6.0,
                        bottom: 6.0,
                        left: 14.0,
                        right: 14.0,
                    })
                    .on_press(Message::Navigate(Page::Chat)),
                ]
                .align_x(Alignment::Center)
                .spacing(6)
                .padding(20.0),
            )
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .into(),
        );
    } else {
        for c in convs.iter().take(5) {
            let agent = crate::agents::find(&c.agent_id);
            let agent_name = agent.map(|a| a.name).unwrap_or(&c.agent_id).to_string();

            let item = row![
                iced::widget::Svg::new(icon(IconName::Message))
                    .width(Length::Fixed(14.0))
                    .height(Length::Fixed(14.0))
                    .style(move |_, _| iced::widget::svg::Style {
                        color: Some(theme.accent),
                    }),
                column![
                    text(c.title.clone())
                        .font(CJK_FONT)
                        .size(13)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    text(format!(
                        "{} · {}",
                        agent_name,
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

            let btn = iced::widget::button(
                container(item)
                    .width(Length::Fill)
                    .padding(iced::Padding {
                        top: 6.0,
                        bottom: 6.0,
                        left: 8.0,
                        right: 8.0,
                    }),
            )
            .style(move |_, status| style::ghost_button(theme, status))
            .padding(0)
            .width(Length::Fill)
            .on_press(Message::NavigateToChat(c.id));

            card_inner.push(btn.into());
            card_inner.push(Space::new().width(0.0).height(4.0).into());
        }
    }

    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}
