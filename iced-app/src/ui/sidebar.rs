//! Navigation sidebar — uses inline SVG icons (lucide-style) to match
//! the preview design 1:1. Active item gets the gradient pill + left
//! accent bar; collapsed mode shows icon-only.

use iced::widget::{button, column, container, row, text, Space};
use iced::{Alignment, Degrees, Element, Font, Gradient, Length};
use iced::gradient;

use crate::app::{App, CJK_FONT, Message, Page};
use crate::ui::components::sidebar_item::{nav_item, nav_item_compact, NavItemSpec};
use crate::ui::icons::IconName;
use crate::ui::style;

/// Map a top-level page to its lucide-style SVG icon.
fn page_icon(page: Page) -> IconName {
    match page {
        Page::Dashboard => IconName::Home,
        Page::Chat => IconName::Message,
        Page::Students => IconName::Users,
        Page::Agents => IconName::Bot,
        Page::AgentHistory => IconName::History,
        Page::Models => IconName::Cpu,
        Page::Skills => IconName::Sparkles,
        Page::Scheduler => IconName::Clock,
        Page::Rag => IconName::Database,
        Page::Privacy => IconName::Shield,
        Page::Settings => IconName::Settings,
    }
}

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let collapsed = app.sidebar_collapsed;

    let mut nav_items: Vec<Element<Message>> = Vec::new();
    for page in Page::ALL.iter() {
        let active = app.page == *page;
        let spec = NavItemSpec {
            label: page.label().to_string(),
            icon: page_icon(*page),
            active,
            badge: None,
        };
        let item: Element<Message> = if collapsed {
            nav_item_compact(spec, Message::Navigate(*page))
        } else {
            nav_item(spec, Message::Navigate(*page))
        };
        nav_items.push(item);
        nav_items.push(
            Space::new()
                .width(Length::Fixed(0.0))
                .height(Length::Fixed(4.0))
                .into(),
        );
    }

    let nav_col = column(nav_items).width(Length::Fill);

    // Brand header — gradient logo square + name + version chip, matching
    // the preview's conic-gradient logo block.
    let brand = if collapsed {
        row![brand_logo(theme)]
            .align_y(Alignment::Center)
            .padding(iced::Padding {
                top: 4.0,
                bottom: 4.0,
                left: 0.0,
                right: 0.0,
            })
    } else {
        row![
            brand_logo(theme),
            column![
                text("Education Advisor")
                    .font(Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(14)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.text),
                    }),
                text("AI 教育管理")
                    .font(CJK_FONT)
                    .size(10.0)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.text_dim),
                    }),
            ]
            .spacing(1),
        ]
        .align_y(Alignment::Center)
        .spacing(10)
    };

    // Bottom collapse button.
    let collapse_icon = if collapsed { "→" } else { "←" };
    let collapse_btn = button(
        row![
            text(collapse_icon).font(CJK_FONT).size(14),
            if collapsed {
                Element::<Message>::from(Space::new().width(0.0).height(0.0))
            } else {
                Element::<Message>::from(
                    text("收起侧栏")
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| style::text_dim(theme)),
                )
            }
        ]
        .spacing(8)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([10.0, 14.0])
    .width(Length::Fill)
    .on_press(Message::ToggleSidebar);

    let sidebar_width = if collapsed { 64.0 } else { 220.0 };

    let content = column![
        container(brand)
            .padding(iced::Padding {
                top: 14.0,
                bottom: 14.0,
                left: 10.0,
                right: 10.0,
            })
            .width(Length::Fill)
            .style(move |_: &iced::Theme| iced::widget::container::Style {
                border: iced::Border {
                    color: iced::Color { a: if theme.dark { 0.07 } else { 0.07 }, ..iced::Color::TRANSPARENT },
                    width: 0.0,
                    radius: iced::border::Radius::from(0.0),
                },
                ..Default::default()
            }),
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)),
        nav_col,
        Space::new().width(Length::Fill).height(Length::Fill),
        collapse_btn,
    ]
    .width(Length::Fill)
    .height(Length::Fill);

    container(content)
        .style(move |_: &iced::Theme| style::sidebar_bg(theme))
        .width(Length::Fixed(sidebar_width))
        .height(Length::Fill)
        .padding(iced::Padding {
            top: 14.0,
            bottom: 14.0,
            left: 12.0,
            right: 12.0,
        })
        .into()
}

/// The conic-gradient brand logo square (matches preview `.brand-logo`).
fn brand_logo(theme: &crate::theme::Theme) -> Element<'static, Message> {
    // Capture colors by value so the closure is `'static`.
    let c0 = theme.accent;
    let c1 = theme.purple;
    let c2 = theme.pink;
    container(Space::new().width(Length::Fixed(32.0)).height(Length::Fixed(32.0)))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Gradient(Gradient::Linear(
                iced::gradient::Linear::new(Degrees(135.0))
                    .add_stop(0.0, c0)
                    .add_stop(0.5, c1)
                    .add_stop(1.0, c2),
            ))),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(10.0),
            },
            shadow: iced::Shadow {
                color: iced::Color::from_rgba(0.66, 0.33, 0.97, 0.45),
                offset: iced::Vector::new(0.0, 0.0),
                blur_radius: 12.0,
            },
            ..Default::default()
        })
        .into()
}
