//! Models page — LLM provider list + presets.

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::ProviderKind;
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let providers = app.providers.read().clone();

    let header = widgets::page_header(theme, "模型", "配置 LLM 提供商，支持 30+ 模型");

    let mut items: Vec<Element<Message>> = Vec::new();

    // Add button
    items.push(
        iced::widget::button(
            row![
                text("✚").size(14).style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
                text("新增提供商")
                    .font(CJK_FONT)
                    .size(13)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(iced::Color::WHITE),
                    }),
            ]
            .spacing(8)
            .align_y(Alignment::Center),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::EditProvider(Some(crate::models::LlmProvider {
            id: uuid::Uuid::new_v4().to_string(),
            name: String::new(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.openai.com/v1".into(),
            api_key: None,
            model: "gpt-4o-mini".into(),
            enabled: true,
        })))
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    if providers.is_empty() {
        items.push(
            widgets::empty_state(theme, "◆", "还没有配置提供商，点击上方按钮新增")
                .into(),
        );
    } else {
        for p in &providers {
            let active = app.settings.active_provider_id.as_deref() == Some(&p.id);
            let kind_label = match p.kind {
                ProviderKind::OpenAi => "OpenAI",
                ProviderKind::Anthropic => "Anthropic",
                ProviderKind::Gemini => "Gemini",
                ProviderKind::OpenRouter => "OpenRouter",
                ProviderKind::Ollama => "Ollama",
                ProviderKind::Custom => "自定义",
            };

            let card_content = column![
                row![
                    text(p.name.clone())
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(15)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
                    if active {
                        widgets::badge(theme, theme.success, "当前".to_string())
                    } else if !p.enabled {
                        widgets::badge(theme, theme.text_faint, "未启用".to_string())
                    } else {
                        widgets::badge(theme, theme.accent, kind_label.to_string())
                    },
                ]
                .align_y(Alignment::Center),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)),
                text(format!("{} · {}", p.base_url, p.model))
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(0)
            .width(Length::Fill);

            let btn = iced::widget::button(card_content)
                .style(move |_, status| style::secondary_button(theme, status))
                .padding(Padding::from(14.0))
                .width(Length::Fill)
                .on_press(Message::EditProvider(Some(p.clone())));

            items.push(btn.into());
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
        }
    }

    let grid = column(items).spacing(0).width(Length::Fill);
    let content = scrollable(grid).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)),
        container(content).width(Length::Fill).height(Length::Fill)
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}
