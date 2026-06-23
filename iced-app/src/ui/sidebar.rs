//! Navigation sidebar.

use iced::widget::{column, container, row, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

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
            .spacing(12)
            .into()
        };

        let nav_btn = iced::widget::button(btn_content)
            .style(move |_, status| style::nav_button(theme, active, status))
            .padding([10.0, 16.0])
            .width(Length::Fill)
            .on_press(Message::Navigate(*page));

        nav_items.push(nav_btn.into());
        if i < Page::ALL.len() - 1 {
            nav_items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)).into());
        }
    }

    let nav_col = column(nav_items).width(Length::Fill);

    // Brand header
    let brand = if collapsed {
        row![text("EA").font(CJK_FONT).size(20).style(
            move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(theme.accent),
            },
        )]
        .align_y(Alignment::Center)
    } else {
        row![
            text("🎓").size(22),
            column![
                text("Education")
                    .font(Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(15)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.text),
                    }),
                text("Advisor")
                    .font(CJK_FONT)
                    .size(11)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.text_faint),
                    }),
            ]
            .spacing(0)
        ]
        .align_y(Alignment::Center)
        .spacing(10)
    };

    let sidebar_width = if collapsed { 64.0 } else { 220.0 };

    let content = column![
        container(brand)
            .padding([16.0, 16.0])
            .width(Length::Fill),
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)),
        nav_col,
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
    ]
    .width(Length::Fill)
    .height(Length::Fill);

    container(content)
        .style(move |_: &iced::Theme| style::sidebar_bg(theme))
        .width(Length::Fixed(sidebar_width))
        .height(Length::Fill)
        .into()
}
