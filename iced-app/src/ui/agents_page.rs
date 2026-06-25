//! AI Agents page — 18 specialised agents rendered as a 3-col grid.
//!
//! Mirrors `iced-app/preview/index.html#page-agents`:
//! * 3 functional groups (教学 / 安全 / 行政), each shown under a
//!   colored group header with icon + count
//! * `.agent-grid` is `repeat(3, 1fr)` on Wide, `repeat(2, 1fr)` on
//!   Medium, `1fr` on Compact — driven by
//!   `LayoutMode::agent_columns()`
//! * each card is a glass surface (16 px radius, 1 px border) with a
//!   gradient icon box, name, role, description, tag pills, status pill
//!   and a `⚡ N 个工具` footer line
//!
//! New design tokens used:
//! * `style::card_flat` for the group container
//! * `style::card_shadow` / `style::radius::XL` for the agent cards
//! * `components::agent_card` for the per-agent card body
//! * `components::badge::pill_with_dot` for the online / idle pill
//! * `components::section_header` for the page intro strip

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Color, Element, Font, Length};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::components::agent_card::{agent_card, AgentCardSpec};
use crate::ui::components::badge::{self, PillTone};
use crate::ui::components::section_header::section_header as sh_section_header;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;

/// Functional group for agent categorisation. Mirrors the preview's
/// `groups = [{id:'teach'}, {id:'safety'}, {id:'admin'}]` array.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum AgentGroup {
    /// 教学 — purple
    Teaching,
    /// 安全 — warning / orange
    Safety,
    /// 行政 — cyan / info
    Admin,
}

impl AgentGroup {
    fn display_name(&self) -> &'static str {
        match self {
            Self::Teaching => "教学组",
            Self::Safety => "安全组",
            Self::Admin => "行政组",
        }
    }

    fn id(&self) -> &'static str {
        match self {
            Self::Teaching => "teach",
            Self::Safety => "safety",
            Self::Admin => "admin",
        }
    }

    fn group_icon(&self) -> IconName {
        match self {
            Self::Teaching => IconName::GraduationCap,
            Self::Safety => IconName::Shield,
            Self::Admin => IconName::Briefcase,
        }
    }

    fn accent(&self) -> (u8, u8, u8) {
        match self {
            Self::Teaching => (168, 85, 247), // #a855f7
            Self::Safety => (249, 115, 22),   // #f97316
            Self::Admin => (6, 182, 212),     // #06b6d4
        }
    }
}

/// Classify an agent into a functional group by its id.
fn classify_agent(id: &str) -> AgentGroup {
    if id.contains("academic")
        || id.contains("curriculum")
        || id.contains("assessment")
        || id.contains("tutor")
        || id.contains("class-monitor")
        || id.contains("supervisor")
    {
        AgentGroup::Teaching
    } else if id.contains("psychology")
        || id.contains("counselor")
        || id.contains("discipline")
        || id.contains("safety")
        || id.contains("risk")
        || id.contains("attendance")
        || id.contains("home_school")
        || id.contains("student-care")
    {
        AgentGroup::Safety
    } else {
        AgentGroup::Admin
    }
}

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = LayoutMode::from_width(app.window_size.width);
    let agents = crate::agents::all_agents();

    // Page intro (uses `section_header` component for the title strip).
    let header = column![
        sh_section_header::<Message>("AI 代理", Some(IconName::Bot)),
        text("18 个专业代理 · 共享 ReAct 编排循环 · 全部遵循 SMALL_MODEL_RULES")
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(2);

    // Classify agents into groups
    let mut groups: std::collections::BTreeMap<AgentGroup, Vec<&crate::agents::AgentDef>> =
        std::collections::BTreeMap::new();
    for agent in agents {
        let g = classify_agent(agent.id);
        groups.entry(g).or_default().push(agent);
    }

    let display_order = [AgentGroup::Teaching, AgentGroup::Safety, AgentGroup::Admin];

    let mut sections: Vec<Element<Message>> = Vec::new();
    for group in &display_order {
        if let Some(members) = groups.get(group) {
            sections.push(group_header(theme, *group, members.len()));
            sections.push(agent_grid(app, theme, mode, members));
            sections.push(Space::new().height(Length::Fixed(24.0)).into());
        }
    }
    if !sections.is_empty() {
        sections.pop(); // drop trailing spacer
    }

    let content = column(sections).spacing(0).width(Length::Fill);
    let scroll = scrollable(content).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().height(Length::Fixed(14.0)),
        container(scroll).width(Length::Fill).height(Length::Fill),
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

/// Group header: colored icon chip + group name + count + online pill.
fn group_header(theme: &crate::theme::Theme, group: AgentGroup, count: usize) -> Element<Message> {
    let (r, g, b) = group.accent();
    let accent = Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 1.0);
    let accent_bg = Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 0.18);
    let accent_border = Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 0.30);

    let icon_box: Element<Message> = container(
        iced::widget::Svg::new(icon(group.group_icon()))
            .width(Length::Fixed(15.0))
            .height(Length::Fixed(15.0)),
    )
    .padding(8.0)
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Color(accent_bg)),
        border: iced::Border {
            color: accent_border,
            width: 1.0,
            radius: iced::border::Radius::from(8.0),
        },
        shadow: iced::Shadow::default(),
        text_color: Some(accent),
        snap: false,
    })
    .into();

    let title = text(group.display_name())
        .font(Font {
            family: CJK_FONT.family,
            weight: iced::font::Weight::Bold,
            ..Default::default()
        })
        .size(13)
        .style(move |_: &iced::Theme| iced::widget::text::Style {
            color: Some(accent),
        });

    let count_chip: Element<Message> = container(
        text(count.to_string())
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    )
    .padding(iced::Padding { top: 2.0, bottom: 2.0, left: 7.0, right: 7.0 })
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(theme.surface_glass)),
        border: iced::Border {
            color: theme.border,
            width: 1.0,
            radius: iced::border::Radius::from(5.0),
        },
        shadow: iced::Shadow::default(),
        text_color: None,
        snap: false,
    })
    .into();

    // Preview: `<span class="pill pill-zinc">N 在线</span>` — approximate via a
    // `badge::pill_with_dot` using `PillTone::Emerald`.
    let online_pill = badge::pill_with_dot("在线", PillTone::Emerald, true);

    row![
        icon_box,
        title,
        count_chip,
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        online_pill,
    ]
    .align_y(Alignment::Center)
    .spacing(10)
    .width(Length::Fill)
    .into()
}

/// 3-col / 2-col / 1-col grid of `components::agent_card` items, each
/// wrapped in a clickable button (SetActiveAgent).
fn agent_grid<'a>(
    app: &'a App,
    theme: &crate::theme::Theme,
    mode: LayoutMode,
    members: &[&'a crate::agents::AgentDef],
) -> Element<'a, Message> {
    let cols = mode.agent_columns() as usize;
    let mut card_elems: Vec<Element<'a, Message>> = Vec::new();

    for agent in members {
        let active = app.active_agent == agent.id;
        let c1 = group_color_for_agent(agent.id);
        let c2 = secondary_color_for_agent(agent.id);
        let spec = AgentCardSpec {
            name: agent.name.to_string(),
            role: agent.id.to_string(),
            desc: agent.description.to_string(),
            tags: vec![category_label(agent.id).to_string()],
            status: if active { "当前".to_string() } else { "在线".to_string() },
            status_online: true,
            tools: 5,
            icon: pick_agent_icon(agent.id),
            c1,
            c2,
        };

        let card_body = agent_card::<Message>(&spec);
        let card_btn = iced::widget::button(card_body)
            .style(move |_, status| style::secondary_button(theme, status))
            .padding(0)
            .width(Length::Fill)
            .on_press(Message::SetActiveAgent(agent.id.to_string()));
        card_elems.push(card_btn.into());
    }

    // Arrange into rows of `cols` cards.
    let mut rows: Vec<Element<'a, Message>> = Vec::new();
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
        rows.push(row(children).spacing(14).width(Length::Fill).into());
        rows.push(Space::new().height(Length::Fixed(14.0)).into());
    }
    if !rows.is_empty() {
        rows.pop(); // drop trailing spacer
    }
    column(rows).spacing(0).width(Length::Fill).into()
}

fn category_label(id: &str) -> &'static str {
    if id.contains("psychology") || id.contains("counselor") {
        "心理"
    } else if id.contains("discipline") {
        "纪律"
    } else if id.contains("safety") {
        "安全"
    } else if id.contains("risk") {
        "风控"
    } else if id.contains("academic") {
        "学业"
    } else if id.contains("home_school") {
        "家校"
    } else if id.contains("data") || id.contains("analyst") {
        "数据"
    } else if id.contains("weekly") {
        "周报"
    } else if id.contains("research") {
        "研究"
    } else if id.contains("scheduler") {
        "排课"
    } else if id.contains("enrollment") {
        "招生"
    } else {
        "代理"
    }
}

fn pick_agent_icon(id: &str) -> IconName {
    if id.contains("psychology") {
        IconName::Sparkles
    } else if id.contains("counselor") {
        IconName::Heart
    } else if id.contains("discipline") {
        IconName::AlertTriangle
    } else if id.contains("safety") {
        IconName::Shield
    } else if id.contains("risk") {
        IconName::AlertTriangle
    } else if id.contains("academic") {
        IconName::TrendingUp
    } else if id.contains("home_school") {
        IconName::Message
    } else if id.contains("data") || id.contains("analyst") {
        IconName::BarChart
    } else if id.contains("weekly") {
        IconName::Activity
    } else if id.contains("research") {
        IconName::Book
    } else if id.contains("scheduler") {
        IconName::Clock
    } else if id.contains("enrollment") {
        IconName::Plus
    } else if id.contains("supervisor") {
        IconName::Briefcase
    } else if id.contains("governor") {
        IconName::Shield
    } else if id.contains("validator") {
        IconName::Check
    } else if id.contains("executor") {
        IconName::Play
    } else if id.contains("main") {
        IconName::Bot
    } else if id.contains("class-monitor") {
        IconName::Users
    } else if id.contains("student-care") {
        IconName::Sparkles
    } else {
        IconName::Bot
    }
}

fn group_color_for_agent(id: &str) -> (u8, u8, u8) {
    match classify_agent(id) {
        AgentGroup::Teaching => (168, 85, 247),
        AgentGroup::Safety => (249, 115, 22),
        AgentGroup::Admin => (6, 182, 212),
    }
}

fn secondary_color_for_agent(id: &str) -> (u8, u8, u8) {
    let base = group_color_for_agent(id);
    if id.contains("psychology") {
        (236, 72, 153)
    } else if id.contains("discipline") {
        (239, 68, 68)
    } else if id.contains("risk") {
        (245, 158, 11)
    } else if id.contains("home_school") {
        (251, 113, 133)
    } else if id.contains("weekly") {
        (16, 185, 129)
    } else {
        let (r, g, b) = base;
        ((r + 60).min(255), (g + 60).min(255), (b + 60).min(255))
    }
}
