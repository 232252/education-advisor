//! Toast notification overlay.

use iced::widget::{column, container, row, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};
use std::time::Instant;

use crate::app::{App, CJK_FONT, Toast};
use crate::runtime::ToastKind;
use crate::theme::Theme;

pub fn view(app: &App) -> Element<'_, crate::app::Message> {
    if app.toasts.is_empty() {
        return Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(0.0)).into();
    }

    let theme = &app.theme;
    let now = Instant::now();

    let items: Vec<Element<crate::app::Message>> = app
        .toasts
        .iter()
        .map(|t| {
            // Left accent bar color by kind.
            let bar_color = match t.kind {
                ToastKind::Info => theme.accent,
                ToastKind::Success => theme.success,
                ToastKind::Warning => theme.warning,
                ToastKind::Error => theme.danger,
            };
            // Entrance (fade-in + slide-in) → steady → fade-out animation.
            let age = now.duration_since(t.born).as_secs_f32();
            let ttl = t.ttl.as_secs_f32();
            let enter_dur = 0.3;
            let opacity = if age < enter_dur {
                // Fade in over first 0.3 s.
                age / enter_dur
            } else {
                // Steady then fade out.
                (1.0 - (age - enter_dur) / ttl).clamp(0.0, 1.0)
            };

            // Slide-from-right: extra padding-right shrinks from 30 px → 10 px.
            let slide_right = if age < enter_dur {
                30.0 - (20.0 * (age / enter_dur))
            } else {
                10.0
            };

            // Left 3px colored vertical bar.
            let bar = container(Space::new())
                .width(Length::Fixed(3.0))
                .height(Length::Fill)
                .style(move |_: &iced::Theme| iced::widget::container::Style {
                    background: Some(iced::Background::Color(iced::Color {
                        a: opacity,
                        ..bar_color
                    })),
                    border: iced::Border {
                        color: iced::Color::TRANSPARENT,
                        width: 0.0,
                        radius: iced::border::Radius::from(2.0),
                    },
                    ..Default::default()
                });

            let content = row![bar, text(t.msg.clone())
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color { a: opacity, ..theme.text }),
                })]
            .align_y(Alignment::Center)
            .spacing(10);

            container(content)
                .style(move |_: &iced::Theme| iced::widget::container::Style {
                    background: Some(iced::Background::Color(iced::Color {
                        a: theme.surface_glass.a * opacity,
                        ..theme.surface_glass
                    })),
                    border: iced::Border {
                        color: iced::Color::TRANSPARENT,
                        width: 0.0,
                        radius: iced::border::Radius::from(12.0),
                    },
                    shadow: iced::Shadow {
                        color: iced::Color { a: 0.18 * opacity, ..theme.shadow },
                        offset: iced::Vector::new(0.0, 4.0),
                        blur_radius: 16.0,
                    },
                    text_color: None,
                    snap: false,
                })
                .padding([10.0, slide_right])
                .width(Length::Fixed(360.0))
                .into()
        })
        .collect();

    // Stack toasts vertically, right-aligned, anchored to the top-right corner.
    let col = column(items).spacing(8).align_x(Alignment::End);

    container(col)
        .width(Length::Fill)
        .align_x(iced::alignment::Horizontal::Right)
        .padding(Padding {
            top: 20.0,
            right: 20.0,
            bottom: 0.0,
            left: 0.0,
        })
        .into()
}
