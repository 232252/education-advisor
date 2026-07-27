//! Navigation sidebar.

use iced::widget::{button, column, container, row, text, Space};
use iced::{Alignment, Element, Font, Length};

use crate::app::{App, CJK_FONT, Message, Page};
use crate::ui::style;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let collapsed = app.sidebar_collapsed;

    let mut nav_items: Vec<Element<Message>> = Vec::new();
    for (i, page) in Page::ALL.iter().enumerate() {
        let active = app.page == *page;
        let icon = page.icon();
        let label = page.label();

        let icon_text = text(icon)
            .font(CJK_FONT)
            .size(18)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(if active { theme.accent_hover } else { theme.text_dim }),
            });

        let btn_content: Element<Message> = if collapsed {
            row![icon_text].align_y(Alignment::Center).into()
        } else {
            row![
                icon_text,
                text(label)
                    .font(CJK_FONT)
                    .size(14)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(if active {
                            theme.accent_hover
                        } else {
                            theme.text_dim
                        }),
                    }),
            ]
            .align_y(Alignment::Center)
            .spacing(10)
            .into()
        };

        let nav_btn = button(btn_content)
            .style(move |_, status| style::nav_button(theme, active, status))
            .padding([12.0, 14.0])
            .width(Length::Fill)
            .on_press(Message::Navigate(*page));

        // Active indicator bar: 3px wide, 36px tall, 2px radius
        let indicator = container(Space::new().width(Length::Fixed(3.0)).height(Length::Fixed(36.0)))
            .style(move |_: &iced::Theme| iced::widget::container::Style {
                background: Some(iced::Background::Color(if active {
                    theme.accent
                } else {
                    iced::Color::TRANSPARENT
                })),
                border: iced::Border {
                    radius: iced::border::Radius::from(2.0),
                    ..Default::default()
                },
                ..Default::default()
            })
            .center_y(Length::Fixed(36.0));

        let item_row = row![indicator.width(Length::Fixed(3.0)), nav_btn]
            .spacing(0)
            .align_y(Alignment::Center)
            .width(Length::Fill);

        nav_items.push(item_row.into());
        if i < Page::ALL.len() - 1 {
            nav_items.push(
                Space::new()
                    .width(Length::Fixed(0.0))
                    .height(Length::Fixed(6.0))
                    .into(),
            );
        }
    }

    let nav_col = column(nav_items).width(Length::Fill);

    // Brand header - compact: 🎓 + "Education Advisor"
    let brand = if collapsed {
        row![text("🎓").size(22).style(move |_: &iced::Theme| iced::widget::text::Style {
            color: Some(theme.accent),
        })]
        .align_y(Alignment::Center)
    } else {
        row![
            text("🎓").size(20),
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
        ]
        .align_y(Alignment::Center)
        .spacing(8)
    };

    // Bottom collapse button (fixed at bottom)
    let collapse_icon = if collapsed { "→" } else { "←" };
    let collapse_btn = button(
        text(collapse_icon)
            .font(CJK_FONT)
            .size(14)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([10.0, 14.0])
    .width(Length::Fill)
    .on_press(Message::ToggleSidebar);

    let sidebar_width = if collapsed { 60.0 } else { 200.0 };

    let content = column![
        container(brand)
            .padding([14.0, 14.0])
            .width(Length::Fill),
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)),
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
        .into()
}
