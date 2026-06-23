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
            let (color, icon) = match t.kind {
                ToastKind::Success => (theme.success, "✓"),
                ToastKind::Error => (theme.danger, "✕"),
                ToastKind::Warning => (theme.warning, "⚠"),
                ToastKind::Info => (theme.info, "ℹ"),
            };
            let age = now.duration_since(t.born).as_secs_f32();
            let ttl = t.ttl.as_secs_f32();
            let alpha = ((1.0 - age / ttl) * 2.0).min(1.0).max(0.0) as f32;

            let content = row![
                text(icon)
                    .size(16)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(color),
                    }),
                text(t.msg.clone())
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(theme.text),
                    }),
            ]
            .align_y(Alignment::Center)
            .spacing(10);

            container(content)
                .style(move |_: &iced::Theme| iced::widget::container::Style {
                    background: Some(iced::Background::Color(iced::Color {
                        a: 0.95 * alpha,
                        ..theme.elevated
                    })),
                    border: iced::Border {
                        color: iced::Color { a: alpha, ..color },
                        width: 1.0,
                        radius: iced::border::Radius::from(10.0),
                    },
                    shadow: iced::Shadow {
                        color: iced::Color { a: 0.3 * alpha, ..theme.shadow },
                        ..Default::default()
                    },
                    text_color: None,
                    snap: false,
                })
                .padding([10.0, 16.0])
                .width(Length::Fixed(360.0))
                .into()
        })
        .collect();

    let col = column(items).spacing(8).align_x(Alignment::End);

    container(col)
        .width(Length::Fill)
        .padding(Padding {
            top: 0.0,
            right: 20.0,
            bottom: 20.0,
            left: 0.0,
        })
        .into()
}
