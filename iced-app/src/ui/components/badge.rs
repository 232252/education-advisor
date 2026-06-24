//! Pill / badge: small label with semantic color and optional leading dot.

use iced::widget::{container, row, text, Container};
use iced::{Element, Length};

/// Semantic tones for [`pill`]. Each maps to a stable color pair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PillTone {
    Purple,
    Pink,
    Cyan,
    Amber,
    Emerald,
    Red,
    Zinc,
}

impl PillTone {
    /// (R, G, B) for the underlying brand color.
    pub const fn rgb(self) -> (u8, u8, u8) {
        match self {
            Self::Purple => (168, 85, 247),
            Self::Pink => (236, 72, 153),
            Self::Cyan => (6, 182, 212),
            Self::Amber => (245, 158, 11),
            Self::Emerald => (16, 185, 129),
            Self::Red => (239, 68, 68),
            Self::Zinc => (148, 163, 184),
        }
    }
}

/// Build a pill label.
pub fn pill<'a, Message: 'a>(label: &'a str, tone: PillTone) -> Element<'a, Message> {
    pill_with_dot(label, tone, true)
}

/// Build a pill label, optionally with a leading colored dot.
pub fn pill_with_dot<'a, Message: 'a>(
    label: &'a str,
    tone: PillTone,
    with_dot: bool,
) -> Element<'a, Message> {
    let (r, g, b) = tone.rgb();
    let bg = iced::Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 0.14);
    let border = iced::Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 0.3);
    let fg = iced::Color::from_rgb(r as f32 / 255.0 * 0.88, g as f32 / 255.0 * 0.88, b as f32 / 255.0 * 0.88);

    let mut children: Vec<Element<'a, Message>> = Vec::new();
    if with_dot {
        children.push(
            container(iced::widget::Space::new())
                .width(Length::Fixed(5.0))
                .height(Length::Fixed(5.0))
                .style(move |_| iced::widget::container::Style {
                    background: Some(iced::Background::Color(fg)),
                    border: iced::Border {
                        color: iced::Color::TRANSPARENT,
                        width: 0.0,
                        radius: iced::border::Radius::from(999.0),
                    },
                    shadow: iced::Shadow::default(),
                    text_color: None,
                    snap: false,
                })
                .into(),
        );
        children.push(iced::widget::Space::new().width(5).height(0).into());
    }
    children.push(text(label.to_string()).size(11).color(fg).into());

    let content = row(children)
        .align_y(iced::Alignment::Center)
        .padding(iced::Padding { top: 2.0, bottom: 2.0, left: 9.0, right: 9.0 });

    container(content)
        .style(move |_| iced::widget::container::Style {
            background: Some(iced::Background::Color(bg)),
            border: iced::Border { color: border, width: 1.0, radius: iced::border::Radius::from(999.0) },
            shadow: iced::Shadow::default(),
            text_color: Some(fg),
            snap: false,
        })
        .into()
}

/// Shorthand constructors for the common tones.
pub fn purple<'a, M: 'a>(s: &'a str) -> Element<'a, M> { pill(s, PillTone::Purple) }
pub fn pink<'a, M: 'a>(s: &'a str) -> Element<'a, M> { pill(s, PillTone::Pink) }
pub fn cyan<'a, M: 'a>(s: &'a str) -> Element<'a, M> { pill(s, PillTone::Cyan) }
pub fn amber<'a, M: 'a>(s: &'a str) -> Element<'a, M> { pill(s, PillTone::Amber) }
pub fn emerald<'a, M: 'a>(s: &'a str) -> Element<'a, M> { pill(s, PillTone::Emerald) }
pub fn red<'a, M: 'a>(s: &'a str) -> Element<'a, M> { pill(s, PillTone::Red) }
pub fn zinc<'a, M: 'a>(s: &'a str) -> Element<'a, M> { pill(s, PillTone::Zinc) }

