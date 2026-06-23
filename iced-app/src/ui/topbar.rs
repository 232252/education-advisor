//! Top bar with title, theme toggle, and quick actions.

use iced::widget::{button, container, row, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message, Page};
use crate::theme::Theme;
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
        text(if app.sidebar_collapsed { "☰" } else { "☰" })
            .font(CJK_FONT)
            .size(16)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([8.0, 12.0])
    .on_press(Message::ToggleSidebar);

    let theme_btn = button(
        text(if theme.dark { "☀" } else { "🌙" })
            .size(16)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([8.0, 12.0])
    .on_press(Message::ToggleTheme);

    let chat_btn = button(
        text("新对话")
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
    )
    .style(move |_, status| style::primary_button(theme, status))
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
    .spacing(12)
    .padding([12.0, 20.0]);

    container(content)
        .style(move |_: &iced::Theme| style::topbar_bg(theme))
        .width(Length::Fill)
        .into()
}
