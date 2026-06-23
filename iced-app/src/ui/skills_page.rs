//! Skills page — list of available AI tools/skills.

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

struct SkillInfo {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    icon: &'static str,
}

const SKILLS: &[SkillInfo] = &[
    SkillInfo { id: "lookup_student", name: "查找学生", description: "按姓名（子串）查找学生", icon: "🔍" },
    SkillInfo { id: "get_student", name: "获取学生记录", description: "按 UUID 获取完整学生档案", icon: "📋" },
    SkillInfo { id: "search_students", name: "搜索学生", description: "按姓名/年级/班级/标签子串搜索", icon: "🔎" },
    SkillInfo { id: "get_grades", name: "获取成绩", description: "获取某学生的所有成绩", icon: "📊" },
    SkillInfo { id: "recent_grades", name: "最近成绩", description: "获取全校最近 N 条成绩", icon: "📈" },
    SkillInfo { id: "list_risk_students", name: "风险学生列表", description: "列出高/危机风险学生", icon: "⚠" },
    SkillInfo { id: "count_students", name: "学生统计", description: "总数 + 风险分布", icon: "🔢" },
    SkillInfo { id: "dashboard_summary", name: "总览摘要", description: "首页仪表盘统计数据", icon: "🏠" },
    SkillInfo { id: "rag_query", name: "知识库查询", description: "查询本地知识库 (RAG)", icon: "📚" },
];

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let header = widgets::page_header(theme, "技能", "AI 代理可调用的工具技能列表");

    let mut items: Vec<Element<Message>> = Vec::new();

    let count_badge = widgets::badge(theme, theme.accent, format!("{} 个技能", SKILLS.len()));
    items.push(
        row![
            count_badge,
            text("所有工具均强制 15 秒超时 + 16KB 参数上限")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // Two-column grid layout
    let mut row_items: Vec<Element<Message>> = Vec::new();
    for skill in SKILLS {
        let card_content = row![
            text(skill.icon).size(28),
            column![
                text(skill.name)
                    .font(Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(14)
                    .style(move |_: &iced::Theme| style::text_primary(theme)),
                text(skill.description)
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme)),
                text(format!("ID: {}", skill.id))
                    .font(CJK_FONT)
                    .size(10)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(3),
        ]
        .spacing(14)
        .align_y(Alignment::Center)
        .width(Length::Fill);

        row_items.push(
            container(card_content)
                .style(move |_: &iced::Theme| style::card_flat(theme))
                .padding(Padding::from(16.0))
                .width(Length::Fill)
                .into(),
        );
    }

    // Arrange in pairs
    let mut grid_rows: Vec<Element<Message>> = Vec::new();
    let mut iter = row_items.into_iter();
    while let Some(first) = iter.next() {
        if let Some(second) = iter.next() {
            grid_rows.push(
                row![first, second]
                    .spacing(12)
                    .width(Length::Fill)
                    .into(),
            );
        } else {
            grid_rows.push(first);
        }
        grid_rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
    }
    items.extend(grid_rows);

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
