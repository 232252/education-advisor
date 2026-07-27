//! Top bar with title, theme toggle, and quick actions.

use iced::widget::{button, container, row, text, Space};
use iced::{Alignment, Element, Font, Length};

use crate::app::{App, CJK_FONT, Message, Page};
use crate::ui::style;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let title = text(app.page.label())
        .font(Font {
            family: CJK_FONT.family,
            weight: iced::font::Weight::Bold,
            ..Default::default()
        })
        .size(18)
        .style(move |_: &iced::Theme| style::text_primary(theme));

    let collapse_btn = button(
        text(if app.sidebar_collapsed { "☰" } else { "✕" })
            .font(CJK_FONT)
            .size(14)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([8.0, 10.0])
    .on_press(Message::ToggleSidebar);

    let theme_btn = button(
        text(if theme.dark { "☀" } else { "🌙" })
            .size(16)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([8.0, 10.0])
    .on_press(Message::ToggleTheme);

    let chat_btn = button(
        row![
            text("+").size(14).style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
            text("新对话")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        ]
        .spacing(6)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::grad_button(theme, status))
    .padding([8.0, 14.0])
    .on_press(Message::Navigate(Page::Chat));

    let content = row![
        collapse_btn,
        title,
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        chat_btn,
        theme_btn,
    ]
    .align_y(Alignment::Center)
    .spacing(10)
    .padding([10.0, 20.0]);

    container(content)
        .style(move |_: &iced::Theme| style::topbar_bg(theme))
        .width(Length::Fill)
        .into()
}
