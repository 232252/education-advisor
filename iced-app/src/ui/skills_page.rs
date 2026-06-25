//! Skills page — list of AI tools/skills as a 2-col grid.
//!
//! Mirrors `iced-app/preview/index.html#page-skills`:
//! * 6 skills rendered in a `grid-template-columns:repeat(2,1fr)` layout
//!   (Wide) that collapses to 1-col on Compact
//! * each card has a gradient header strip (skill code + name + c1/c2
//!   gradient), a 2-column 触发器 / 工具 mapping, a 频次 / 编辑 / 测试
//!   footer
//!
//! Responsive breakpoints:
//! * `LayoutMode::Wide`     → 2 cols
//! * `LayoutMode::Medium`   → 2 cols (preview stays 2-col until the
//!                            window drops below ~900 px)
//! * `LayoutMode::Compact`  → 1 col
//!
//! New design tokens used:
//! * `style::card_flat` for the card surface (16 px radius, 1 px border)
//! * `style::card_shadow` for the lifted hover state
//! * `components::badge` for the trigger / tool pills (`Purple` / `Cyan`)
//! * `components::section_header` for the page intro strip

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::components::badge::{self, PillTone};
use crate::ui::components::section_header::section_header as sh_section_header;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;

struct SkillInfo {
    code: &'static str,
    name: &'static str,
    desc: &'static str,
    triggers: &'static [&'static str],
    tools: &'static [&'static str],
    freq: u32,
    c1: (u8, u8, u8),
    c2: (u8, u8, u8),
}

// Mirrors the 6 skills in `MOCK.skills` of `preview/index.html`.
const SKILLS: &[SkillInfo] = &[
    SkillInfo {
        code: "SK-001",
        name: "学生全周期管理",
        desc: "从入学到毕业的完整学生档案管理，包括基本信息、家庭关系、学业记录、奖惩情况",
        triggers: &["查询学生", "添加学生", "更新档案"],
        tools: &["lookup_student", "get_student", "search_students", "get_grades"],
        freq: 342,
        c1: (168, 85, 247),
        c2: (99, 102, 241),
    },
    SkillInfo {
        code: "SK-002",
        name: "风险预警响应",
        desc: "实时识别高风险学生，自动触发预警流程并通知相关人员",
        triggers: &["风险评估", "异常行为"],
        tools: &["list_risk_students", "dashboard_summary"],
        freq: 89,
        c1: (239, 68, 68),
        c2: (245, 158, 11),
    },
    SkillInfo {
        code: "SK-003",
        name: "教学周报生成",
        desc: "汇总本周教学数据、考勤、违纪、成绩等多维度信息生成周报",
        triggers: &["生成周报", "本周总结"],
        tools: &["dashboard_summary", "recent_grades"],
        freq: 28,
        c1: (16, 185, 129),
        c2: (6, 182, 212),
    },
    SkillInfo {
        code: "SK-004",
        name: "家长定向沟通",
        desc: "针对单个家长发送定制化消息，自动脱敏其他学生信息",
        triggers: &["联系家长", "发送通知"],
        tools: &["lookup_student", "search_students"],
        freq: 156,
        c1: (236, 72, 153),
        c2: (244, 114, 182),
    },
    SkillInfo {
        code: "SK-005",
        name: "学业趋势分析",
        desc: "对单个或群体学生进行多科目成绩趋势分析，生成可视化报告",
        triggers: &["成绩分析", "趋势报告"],
        tools: &["get_grades", "search_students"],
        freq: 67,
        c1: (6, 182, 212),
        c2: (34, 211, 238),
    },
    SkillInfo {
        code: "SK-006",
        name: "违规处理流程",
        desc: "登记违规事件、通知家长、跟踪处分结果、记录档案",
        triggers: &["处理违规", "记录处分"],
        tools: &["lookup_student", "get_student"],
        freq: 41,
        c1: (249, 115, 22),
        c2: (239, 68, 68),
    },
];

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = LayoutMode::from_width(app.window_size.width);

    let header = column![
        sh_section_header::<Message>("技能", Some(IconName::Sparkles)),
        text(format!(
            "{} 个技能 · 可被代理调用 · 触发器 / 工具映射齐全",
            SKILLS.len()
        ))
        .font(CJK_FONT)
        .size(12)
        .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(2);

    // 2-col (Wide/Medium) or 1-col (Compact) grid.
    let cols = match mode {
        LayoutMode::Compact => 1,
        _ => 2,
    };

    let card_elems: Vec<Element<Message>> = SKILLS.iter().map(|s| skill_card(theme, s)).collect();

    let mut grid_rows: Vec<Element<Message>> = Vec::new();
    let mut iter = card_elems.into_iter();
    while let Some(first) = iter.next() {
        let mut children = vec![first];
        for _ in 1..cols {
            if let Some(next) = iter.next() {
                children.push(next);
            } else {
                break;
            }
        }
        grid_rows.push(row(children).spacing(14).width(Length::Fill).into());
        grid_rows.push(Space::new().height(Length::Fixed(14.0)).into());
    }
    if !grid_rows.is_empty() {
        grid_rows.pop();
    }
    let grid = column(grid_rows).spacing(0).width(Length::Fill);

    let content = scrollable(grid).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().height(Length::Fixed(14.0)),
        container(content).width(Length::Fill).height(Length::Fill),
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

fn skill_card(theme: &crate::theme::Theme, s: &SkillInfo) -> Element<Message> {
    // Header strip with gradient background tinted by c1/c2.
    let (r1, g1, b1) = s.c1;
    let (r2, g2, b2) = s.c2;
    let c1 = iced::Color::from_rgba(r1 as f32 / 255.0, g1 as f32 / 255.0, b1 as f32 / 255.0, 0.13);
    let c2 = iced::Color::from_rgba(r2 as f32 / 255.0, g2 as f32 / 255.0, b2 as f32 / 255.0, 0.07);
    let icon_c1 = iced::Color::from_rgb(r1 as f32 / 255.0, g1 as f32 / 255.0, b1 as f32 / 255.0);
    let icon_c2 = iced::Color::from_rgb(r2 as f32 / 255.0, g2 as f32 / 255.0, b2 as f32 / 255.0);

    let header_strip = container(
        column![
            row![
                container(
                    iced::widget::Svg::new(icon(IconName::Sparkles))
                        .width(Length::Fixed(16.0))
                        .height(Length::Fixed(16.0)),
                )
                .padding(8.0)
                .style(move |_| iced::widget::container::Style {
                    background: Some(iced::Background::Gradient(iced::Gradient::Linear(
                        iced::gradient::Linear::new(iced::Degrees(135.0))
                            .add_stop(0.0, icon_c1)
                            .add_stop(1.0, icon_c2),
                    ))),
                    border: iced::Border {
                        color: iced::Color::TRANSPARENT,
                        width: 0.0,
                        radius: iced::border::Radius::from(9.0),
                    },
                    shadow: iced::Shadow::default(),
                    text_color: Some(iced::Color::WHITE),
                    snap: false,
                })
                .into(),
                text(s.name)
                    .font(Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(14)
                    .style(move |_: &iced::Theme| style::text_primary(theme)),
                Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
                badge::pill(s.code, PillTone::Zinc),
            ]
            .align_y(Alignment::Center)
            .spacing(8),
            Space::new().height(Length::Fixed(8.0)),
            text(s.desc)
                .font(CJK_FONT)
                .size(12.5)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(0)
    )
    .padding(iced::Padding { top: 18.0, bottom: 14.0, left: 20.0, right: 20.0 })
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Gradient(iced::Gradient::Linear(
            iced::gradient::Linear::new(iced::Degrees(135.0))
                .add_stop(0.0, c1)
                .add_stop(1.0, c2),
        ))),
        border: iced::Border {
            color: theme.border_soft,
            width: 0.0,
            radius: iced::border::Radius::from(0.0),
        },
        shadow: iced::Shadow::default(),
        text_color: None,
        snap: false,
    });

    // 2-column 触发器 / 工具 mapping.
    let trigger_pills: Vec<Element<Message>> = s
        .triggers
        .iter()
        .map(|t| badge::pill(t, PillTone::Purple))
        .collect();
    let tool_pills: Vec<Element<Message>> = s
        .tools
        .iter()
        .map(|t| badge::pill(t, PillTone::Cyan))
        .collect();

    let triggers_col = column![
        text("触发器")
            .font(CJK_FONT)
            .size(10.5)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        row(trigger_pills).spacing(5).wrap().align_y(Alignment::Center),
    ]
    .spacing(6);

    let tools_col = column![
        text("可用工具")
            .font(CJK_FONT)
            .size(10.5)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        row(tool_pills).spacing(5).wrap().align_y(Alignment::Center),
    ]
    .spacing(6);

    // Footer: 本月调用 + 编辑/测试 button pair.
    let edit_btn = button_inline(theme, IconName::Edit, "编辑");
    let test_btn = button_inline(theme, IconName::Play, "测试");

    let freq_text = row![
        iced::widget::Svg::new(icon(IconName::Activity))
            .width(Length::Fixed(12.0))
            .height(Length::Fixed(12.0)),
        text("本月调用 ")
            .font(CJK_FONT)
            .size(11.5)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        text(s.freq.to_string())
            .font(CJK_FONT)
            .size(11.5)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        text(" 次")
            .font(CJK_FONT)
            .size(11.5)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(4)
    .align_y(Alignment::Center);

    let body = column![
        row![triggers_col, tools_col].spacing(14).width(Length::Fill),
        Space::new().height(Length::Fixed(12.0)),
        row![
            freq_text,
            Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
            edit_btn,
            test_btn,
        ]
        .align_y(Alignment::Center)
        .width(Length::Fill),
    ]
    .padding(iced::Padding { top: 14.0, bottom: 14.0, left: 20.0, right: 20.0 })
    .spacing(0)
    .width(Length::Fill);

    let card = column![header_strip, body]
        .width(Length::Fill);

    container(card)
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .width(Length::Fill)
        .into()
}

fn button_inline(theme: &crate::theme::Theme, ic: IconName, label: &str) -> Element<Message> {
    iced::widget::button(
        row![
            iced::widget::Svg::new(icon(ic))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            text(label)
                .font(CJK_FONT)
                .size(11.5)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(4)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([4.0, 9.0])
    .into()
}
