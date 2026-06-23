//! Reusable styled widget helpers for building pages.

use iced::widget::{button, column, container, row, text, Space};
use iced::{Element, Font, Length, Padding};

use crate::app::{CJK_FONT, Message};
use crate::theme::Theme;
use crate::ui::style;

/// A glass card container with accent top line.
pub fn card<'a, M: 'a>(
    theme: &'a Theme,
    content: impl Into<Element<'a, M>>,
) -> Element<'a, M> {
    container(content)
        .style(move |_: &iced::Theme| style::card(theme))
        .padding(Padding::from(16.0))
        .width(Length::Fill)
        .into()
}

/// A flat surface card.
pub fn card_flat<'a, M: 'a>(
    theme: &'a Theme,
    content: impl Into<Element<'a, M>>,
) -> Element<'a, M> {
    container(content)
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .padding(Padding::from(16.0))
        .width(Length::Fill)
        .into()
}

/// Section title with an accent bar.
pub fn section_title<'a, M: 'a + Clone>(theme: &'a Theme, title: &'a str) -> Element<'a, M> {
    let bar = container(Space::new().width(Length::Fixed(4.0)).height(Length::Fixed(20.0)))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(theme.accent)),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(2.0),
            },
            ..Default::default()
        });
    row![
        bar,
        text(title)
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(16)
            .style(move |_: &iced::Theme| style::text_primary(theme))
    ]
    .align_y(iced::Alignment::Center)
    .spacing(8)
    .into()
}

/// Page header with title + subtitle.
pub fn page_header<'a, M: 'a + Clone>(
    theme: &'a Theme,
    title: &'a str,
    subtitle: &'a str,
) -> Element<'a, M> {
    column![
        text(title)
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(22)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        text(subtitle)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(4)
    .into()
}

/// A primary accent button.
pub fn primary_button<'a>(
    theme: &'a Theme,
    label: &'a str,
    on_press: Message,
) -> Element<'a, Message> {
    button(
        text(label)
            .font(CJK_FONT)
            .size(14)
            .align_x(iced::alignment::Horizontal::Center)
            .align_y(iced::alignment::Vertical::Center),
    )
    .style(move |_, status| style::primary_button(theme, status))
    .padding([10.0, 16.0])
    .on_press(on_press)
    .into()
}

/// A secondary surface button.
pub fn secondary_button<'a>(
    theme: &'a Theme,
    label: &'a str,
    on_press: Message,
) -> Element<'a, Message> {
    button(
        text(label)
            .font(CJK_FONT)
            .size(14)
            .align_x(iced::alignment::Horizontal::Center)
            .align_y(iced::alignment::Vertical::Center),
    )
    .style(move |_, status| style::secondary_button(theme, status))
    .padding([10.0, 16.0])
    .on_press(on_press)
    .into()
}

/// A ghost (transparent) button.
pub fn ghost_button<'a>(
    theme: &'a Theme,
    label: &'a str,
    on_press: Message,
) -> Element<'a, Message> {
    button(
        text(label)
            .font(CJK_FONT)
            .size(13)
            .align_x(iced::alignment::Horizontal::Center)
            .align_y(iced::alignment::Vertical::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([8.0, 12.0])
    .on_press(on_press)
    .into()
}

/// A danger button.
pub fn danger_button<'a>(
    theme: &'a Theme,
    label: &'a str,
    on_press: Message,
) -> Element<'a, Message> {
    button(
        text(label)
            .font(CJK_FONT)
            .size(14)
            .align_x(iced::alignment::Horizontal::Center)
            .align_y(iced::alignment::Vertical::Center),
    )
    .style(move |_, status| style::danger_button(theme, status))
    .padding([10.0, 16.0])
    .on_press(on_press)
    .into()
}

/// A colored badge (small pill).
pub fn badge<'a, M: 'a>(theme: &'a Theme, color: iced::Color, label: String) -> Element<'a, M> {
    container(
        text(label)
            .size(11)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(color),
            }),
    )
    .style(move |_: &iced::Theme| style::badge(theme, color))
    .padding([3.0, 8.0])
    .into()
}

/// A stat card: big number + label + optional icon.
pub fn stat_card<'a, M: 'a + Clone>(
    theme: &'a Theme,
    value: String,
    label: &'a str,
    accent: iced::Color,
) -> Element<'a, M> {
    let content = column![
        text(value)
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(28)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(accent),
            }),
        text(label)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(4);

    container(content)
        .style(move |_: &iced::Theme| style::card(theme))
        .padding(Padding::from(20.0))
        .width(Length::Fill)
        .into()
}

/// A labelled text input field.
pub fn labeled_input<'a>(
    theme: &'a Theme,
    label: &'a str,
    value: &'a str,
    placeholder: &'a str,
    on_change: impl Fn(String) -> Message + 'a,
) -> Element<'a, Message> {
    column![
        text(label)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
        iced::widget::text_input(placeholder, value)
            .on_input(on_change)
            .font(CJK_FONT)
            .size(14)
            .padding([10.0, 12.0])
            .style(move |_, status| style::text_input_style(theme, status))
    ]
    .spacing(6)
    .into()
}

/// A labelled multiline text input.
pub fn labeled_textarea<'a>(
    theme: &'a Theme,
    label: &'a str,
    value: &'a str,
    placeholder: &'a str,
    on_change: impl Fn(String) -> Message + 'a,
) -> Element<'a, Message> {
    column![
        text(label)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
        iced::widget::text_input(placeholder, value)
            .on_input(on_change)
            .font(CJK_FONT)
            .size(14)
            .padding([10.0, 12.0])
            .style(move |_, status| style::text_input_style(theme, status))
    ]
    .spacing(6)
    .into()
}

/// An empty-state placeholder.
pub fn empty_state<'a, M: 'a + Clone>(theme: &'a Theme, icon: &'a str, msg: &'a str) -> Element<'a, M> {
    column![
        text(icon).size(48),
        text(msg)
            .font(CJK_FONT)
            .size(14)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(12)
    .align_x(iced::alignment::Horizontal::Center)
    .into()
}
