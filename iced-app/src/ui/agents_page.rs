//! AI Agents page — list of 18 specialized agents, grouped by function.

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Color, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

/// Functional group for agent categorization.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum AgentGroup {
    /// 教学组 — purple
    Teaching,
    /// 安全组 — warning/orange
    Safety,
    /// 行政组 — cyan/info
    Admin,
    /// 其他组 — accent
    Other,
}

impl AgentGroup {
    fn display_name(&self) -> &'static str {
        match self {
            Self::Teaching => "教学组",
            Self::Safety => "安全组",
            Self::Admin => "行政组",
            Self::Other => "其他",
        }
    }

    fn accent_color(&self, theme: &crate::theme::Theme) -> Color {
        match self {
            // purple
            Self::Teaching => Color::from_rgb(0.55, 0.35, 0.95),
            // orange/warning
            Self::Safety => Color::from_rgb(1.0, 0.6, 0.2),
            // cyan/info
            Self::Admin => Color::from_rgb(0.2, 0.8, 0.9),
            // accent
            Self::Other => theme.accent,
        }
    }

    fn pill_label(&self) -> &'static str {
        match self {
            Self::Teaching => "教学",
            Self::Safety => "安全",
            Self::Admin => "行政",
            Self::Other => "其他",
        }
    }
}

/// Classify an agent into a functional group by its id.
fn classify_agent(id: &str) -> AgentGroup {
    if id.contains("counsel") || id.contains("tutor") || id.contains("curriculum")
        || id.contains("assessment")
    {
        AgentGroup::Teaching
    } else if id.contains("discipline") || id.contains("safety") || id.contains("risk") {
        AgentGroup::Safety
    } else if id.contains("enrollment")
        || id.contains("scheduling")
        || id.contains("reporting")
        || id.contains("parent_comm")
    {
        AgentGroup::Admin
    } else {
        AgentGroup::Other
    }
}

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let agents = crate::agents::all_agents();

    let header =
        widgets::page_header(theme, "AI 代理", "18 个专业化 AI 代理，覆盖教育管理全场景");

    // Classify agents into groups
    let mut groups: std::collections::BTreeMap<AgentGroup, Vec<&crate::agents::AgentDef>> =
        std::collections::BTreeMap::new();
    for agent in agents {
        let g = classify_agent(agent.id);
        groups.entry(g).or_default().push(agent);
    }

    // Build sections for each group in display order
    let display_order = [
        AgentGroup::Teaching,
        AgentGroup::Safety,
        AgentGroup::Admin,
        AgentGroup::Other,
    ];

    let mut sections: Vec<Element<Message>> = Vec::new();
    for group in &display_order {
        if let Some(members) = groups.get(group) {
            let count = members.len();

            // ── Group header: colored vertical bar (3px) + name + count badge ──
            let group_color = group.accent_color(theme);
            let name = group.display_name();
            sections.push(
                row![
                    container(
                        Space::new()
                            .width(Length::Fixed(3.0))
                            .height(Length::Fixed(20.0))
                    )
                    .style(move |_: &iced::Theme| iced::widget::container::Style {
                        background: Some(iced::Background::Color(group_color)),
                        border: iced::Border {
                            radius: iced::border::Radius::from(2.0),
                            ..Default::default()
                        },
                        ..Default::default()
                    }),
                    text(name)
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(15)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    widgets::badge(
                        theme,
                        theme.text_faint,
                        format!("{} 个代理", count),
                    ),
                ]
                .align_y(Alignment::Center)
                .spacing(10)
                .into(),
            );

            // ── Cards in two-column grid ──
            let mut cards: Vec<Element<Message>> = Vec::new();
            for agent in members.iter() {
                let active = app.active_agent == agent.id;
                let icon_char = agent.name.chars().next().unwrap_or('◆');
                let gc = *group;
                let group_color = gc.accent_color(theme);
                let pill_text = gc.pill_label();

                let top_row = row![
                    text(icon_char.to_string())
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(28)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(theme.accent),
                        }),
                    Space::new()
                        .width(Length::Fill)
                        .height(Length::Fixed(0.0)),
                    widgets::badge(
                        theme,
                        Color { a: 0.5, ..group_color },
                        pill_text.to_string(),
                    ),
                    if active {
                        widgets::badge(theme, theme.success, "当前".to_string())
                    } else {
                        Space::new()
                            .width(Length::Fixed(0.0))
                            .height(Length::Fixed(0.0))
                            .into()
                    },
                ]
                .align_y(Alignment::Center)
                .spacing(6);

                let name_id = column![
                    text(agent.name.clone())
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(16)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    text(agent.id.clone())
                        .font(CJK_FONT)
                        .size(11)
                        .style(move |_: &iced::Theme| style::text_faint(theme)),
                ]
                .spacing(2);

                let card_content = column![
                    top_row,
                    Space::new()
                        .width(Length::Fixed(0.0))
                        .height(Length::Fixed(10.0)),
                    name_id,
                    Space::new()
                        .width(Length::Fixed(0.0))
                        .height(Length::Fixed(8.0)),
                    text(agent.description.clone())
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| style::text_dim(theme)),
                ]
                .spacing(0)
                .width(Length::Fill);

                cards.push(
                    iced::widget::button(card_content)
                        .style(move |_, status| style::secondary_button(theme, status))
                        .padding(Padding::from(20.0))
                        .width(Length::Fill)
                        .on_press(Message::SetActiveAgent(agent.id.to_string()))
                        .into(),
                );
            }

            // Arrange cards into two-column grid rows
            let mut grid_rows: Vec<Element<Message>> = Vec::new();
            let mut iter = cards.into_iter();
            while let Some(first) = iter.next() {
                if let Some(second) = iter.next() {
                    grid_rows.push(
                        row![first, second]
                            .spacing(14)
                            .width(Length::Fill)
                            .into(),
                    );
                } else {
                    grid_rows.push(first);
                }
                grid_rows.push(
                    Space::new()
                        .width(Length::Fixed(0.0))
                        .height(Length::Fixed(14.0))
                        .into(),
                );
            }
            // Remove trailing spacer inside grid
            if !grid_rows.is_empty() {
                let last_is_spacer = true; // we always push spacer after each row/card
                if last_is_spacer {
                    grid_rows.pop();
                }
            }

            let grid = column(grid_rows).spacing(0).width(Length::Fill);
            sections.push(grid.into());

            // Spacer between groups (24px)
            sections.push(
                Space::new()
                    .width(Length::Fixed(0.0))
                    .height(Length::Fixed(24.0))
                    .into(),
            );
        }
    }

    // Remove trailing group spacer
    if !sections.is_empty() {
        sections.pop(); // last element is always the inter-group spacer
    }

    let content = column(sections).spacing(0).width(Length::Fill);
    let scroll = scrollable(content).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new()
            .width(Length::Fixed(0.0))
            .height(Length::Fixed(14.0)),
        container(scroll).width(Length::Fill).height(Length::Fill),
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}
