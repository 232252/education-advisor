//! Models page — LLM provider list + presets.

use iced::widget::{column, container, row, scrollable, text, text_input, pick_list, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::ProviderKind;
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let header = widgets::page_header(theme, "模型", "配置 LLM 提供商，支持 30+ 模型");

    // If editing, show edit form
    if let Some(editing) = app.ui_state.editing_provider.clone() {
        return column![
            header,
            Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)),
            provider_edit_form(app, editing)
        ]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into();
    }

    let providers = app.providers.read().clone();
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

            let actions = row![
                iced::widget::button(
                    text("✎ 编辑")
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| style::text_dim(theme)),
                )
                .style(move |_, status| style::secondary_button(theme, status))
                .padding([6.0, 10.0])
                .on_press(Message::EditProvider(Some(p.clone()))),
                iced::widget::button(
                    text(if active { "✓ 已激活" } else { "设为当前" })
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(if active { theme.success } else { iced::Color::WHITE }),
                        }),
                )
                .style(move |_, status| {
                    if active {
                        style::secondary_button(theme, status)
                    } else {
                        style::primary_button(theme, status)
                    }
                })
                .padding([6.0, 10.0])
                .on_press(Message::SettingsActiveProviderChanged(p.id.clone())),
                iced::widget::button(
                    text("✕ 删除")
                        .font(CJK_FONT)
                        .size(12)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(iced::Color::WHITE),
                        }),
                )
                .style(move |_, status| style::danger_button(theme, status))
                .padding([6.0, 10.0])
                .on_press(Message::DeleteProvider(p.id.clone())),
            ]
            .spacing(8);

            let full = column![
                container(card_content)
                    .style(move |_: &iced::Theme| style::card_flat(theme))
                    .padding(Padding::from(14.0))
                    .width(Length::Fill),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)),
                actions,
            ]
            .spacing(0)
            .width(Length::Fill);

            items.push(full.into());
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

fn provider_edit_form(app: &App, provider: crate::models::LlmProvider) -> Element<Message> {
    let theme = &app.theme;
    let mut items: Vec<Element<Message>> = Vec::new();

    items.push(
        text(if provider.name.is_empty() { "新增提供商" } else { "编辑提供商" })
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(20)
            .style(move |_: &iced::Theme| style::text_primary(theme))
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    let p = provider.clone();

    // Name
    items.push(
        column![
            text("名称")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("例如: OpenAI", &p.name)
                .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::Name(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Kind picker
    let kind_options = vec![
        (ProviderKind::OpenAi, "OpenAI"),
        (ProviderKind::Anthropic, "Anthropic"),
        (ProviderKind::Gemini, "Gemini"),
        (ProviderKind::OpenRouter, "OpenRouter"),
        (ProviderKind::Ollama, "Ollama"),
        (ProviderKind::Custom, "自定义"),
    ];
    let kind_labels: Vec<String> = kind_options.iter().map(|(_, l)| l.to_string()).collect();
    let current_kind_label = kind_options.iter().find(|(k, _)| *k == p.kind).map(|(_, l)| l.to_string()).unwrap_or_else(|| "OpenAI".to_string());

    items.push(
        column![
            text("类型")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            pick_list(
                kind_labels,
                Some(current_kind_label),
                move |label| {
                    let kind = kind_options.iter().find(|(_, l)| *l == label).map(|(k, _)| *k).unwrap_or(ProviderKind::OpenAi);
                    Message::ProviderFieldChanged(crate::app::ProviderField::Kind(kind))
                },
            )
            .font(CJK_FONT)
            .text_size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::pick_list_style(theme, status))
            .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Base URL
    items.push(
        column![
            text("API 地址")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("例如: https://api.openai.com/v1", &p.base_url)
                .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::BaseUrl(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // API Key
    items.push(
        column![
            text("API 密钥")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("输入 API 密钥 (可选)", &p.api_key.clone().unwrap_or_default())
                .secure(true)
                .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::ApiKey(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Model
    items.push(
        column![
            text("模型")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("例如: gpt-4o-mini", &p.model)
                .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::Model(v)))
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Enabled toggle
    let enabled_options = vec!["启用".to_string(), "禁用".to_string()];
    let current_enabled = if p.enabled { "启用".to_string() } else { "禁用".to_string() };

    items.push(
        column![
            text("状态")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            pick_list(
                enabled_options,
                Some(current_enabled),
                move |label| Message::ProviderFieldChanged(crate::app::ProviderField::Enabled(label == "启用")),
            )
            .font(CJK_FONT)
            .text_size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::pick_list_style(theme, status))
            .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    // Actions
    let actions = row![
        iced::widget::button(
            text("保存")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::SaveProvider),
        iced::widget::button(
            text("取消")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::EditProvider(None)),
    ]
    .spacing(12);
    items.push(actions.into());

    let content = column(items).spacing(0).width(Length::Fill);
    container(
        scrollable(content).style(move |_, _| style::scrollable(theme)),
    )
    .style(move |_: &iced::Theme| style::card_flat(theme))
    .padding(Padding::from(20.0))
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}
