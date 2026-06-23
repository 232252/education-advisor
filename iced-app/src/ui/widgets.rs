//! Reusable styled widget helpers for building pages.

use iced::widget::{button, column, container, row, text, Space};
use iced::{Background, Border, Color, Element, Font, Length, Padding, Shadow, Vector};

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
        .padding(Padding::from(20.0))
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
    let bar = container(Space::new().width(Length::Fixed(3.0)).height(Length::Fixed(16.0)))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(Background::Color(theme.accent)),
            border: Border {
                color: Color::TRANSPARENT,
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
            .size(24)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        text(subtitle)
            .font(CJK_FONT)
            .size(13)
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
pub fn badge<'a, M: 'a>(theme: &'a Theme, color: Color, label: String) -> Element<'a, M> {
    container(
        text(label)
            .size(11)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(color),
            }),
    )
    .style(move |_: &iced::Theme| style::badge(theme, color))
    .padding([4.0, 10.0])
    .into()
}

/// A KPI stat card: icon top-right, big number + label.
pub fn stat_card<'a, M: 'a + Clone>(
    theme: &'a Theme,
    icon: &'a str,
    value: String,
    label: &'a str,
    accent: Color,
) -> Element<'a, M> {
    let body = column![
        text(value)
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(32)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(accent),
            }),
        text(label)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(4);

    let content = row![body, Space::new().width(Length::Fill), text(icon).size(28)]
        .align_y(iced::Alignment::Start);

    container(content)
        .style(move |_: &iced::Theme| style::card(theme))
        .padding(Padding::from(24.0))
        .width(Length::Fill)
        .into()
}

/// A KPI card: icon top-left, big number below, accent bar at bottom.
pub fn kpi_card<'a, M: 'a + Clone>(
    theme: &'a Theme,
    icon: &'a str,
    value: String,
    label: &'a str,
    accent_color: Color,
) -> Element<'a, M> {
    let bottom_bar = container(Space::new().width(Length::Fill).height(Length::Fixed(3.0)))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(Background::Color(accent_color)),
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(2.0),
            },
            ..Default::default()
        });

    let content = column![
        text(icon).size(24),
        text(value)
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(32)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(accent_color),
            }),
        text(label)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        bottom_bar,
    ]
    .spacing(8);

    container(content)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(Background::Color(theme.surface_glass)),
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(16.0),
            },
            shadow: Shadow {
                color: theme.shadow,
                offset: Vector::new(0.0, 4.0),
                blur_radius: 20.0,
            },
            ..Default::default()
        })
        .padding(Padding::from(20.0))
        .width(Length::Fill)
        .into()
}

/// A feature card: left accent line + icon + title + description.
pub fn feature_card<'a, M: 'a + Clone>(
    theme: &'a Theme,
    icon: &'a str,
    title: &'a str,
    description: &'a str,
    accent_color: Color,
) -> Element<'a, M> {
    let left_bar = container(Space::new().width(Length::Fixed(3.0)).height(Length::Fill))
        .height(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(Background::Color(accent_color)),
            border: Border {
                color: Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(2.0),
            },
            ..Default::default()
        });

    let body = column![
        row![
            text(icon).size(20),
            text(title)
                .font(Font {
                    family: CJK_FONT.family,
                    weight: iced::font::Weight::Bold,
                    ..Default::default()
                })
                .size(15)
                .style(move |_: &iced::Theme| style::text_primary(theme)),
        ]
        .spacing(8)
        .align_y(iced::Alignment::Center),
        text(description)
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    ]
    .spacing(6);

    container(
        row![left_bar, body]
            .spacing(12)
            .align_y(iced::Alignment::Center),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(Background::Color(theme.surface_glass)),
        border: Border {
            color: Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(16.0),
        },
        shadow: Shadow {
            color: theme.shadow,
            offset: Vector::new(0.0, 4.0),
            blur_radius: 20.0,
        },
        ..Default::default()
    })
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
pub fn empty_state<'a, M: 'a + Clone>(
    theme: &'a Theme,
    icon: &'a str,
    msg: &'a str,
) -> Element<'a, M> {
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

/// An empty-state placeholder with a CTA button.
pub fn empty_state_with_cta<'a>(
    theme: &'a Theme,
    icon: &'a str,
    msg: &'a str,
    cta_label: &'a str,
    on_press: Message,
) -> Element<'a, Message> {
    let content = column![
        text(icon).size(64),
        text(msg)
            .font(CJK_FONT)
            .size(15)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        primary_button(theme, cta_label, on_press),
    ]
    .spacing(16)
    .align_x(iced::alignment::Horizontal::Center);

    container(content)
        .padding(Padding::from(40.0))
        .width(Length::Fill)
        .into()
}
