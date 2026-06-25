//! Models page — LLM provider presets + edit form.
//!
//! Mirrors `iced-app/preview/index.html#page-models`:
//! * top: "添加提供商" card with a 4-col grid of preset tiles (12 of the
//!   21 MOCK.providers are shown)
//! * bottom: "已配置模型" card with a table of configured models,
//!   gradient swatch + name + provider + context + status + actions
//!
//! The provider edit form (when `editing_provider` is `Some`) uses the
//! same field layout as the previous cycle but is wrapped in a
//! `style::card_flat` glass container. The 3 preset cards reuse the
//! new `theme_picker` visual language (rounded 3-way selector with
//! Dark / Light / Auto labels).
//!
//! New design tokens used:
//! * `style::card_flat` for the table card
//! * `style::radius::LG` for the preset tiles
//! * `components::theme_picker` for the 3 preset tiles
//! * `components::section_header` for the page intro strip
//! * `components::badge` for the model status pills

use iced::widget::{column, container, pick_list, row, scrollable, text, text_input, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::ProviderKind;
use crate::ui::components::badge::{self, PillTone};
use crate::ui::components::section_header::section_header as sh_section_header;
use crate::ui::components::theme_picker::{theme_picker, ThemeChoice};
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;

// Preset providers shown in the 4-col grid (12 of the 21 in MOCK).
const PRESET_PROVIDERS: &[&str] = &[
    "OpenAI",
    "Anthropic",
    "Google Gemini",
    "DeepSeek",
    "通义千问",
    "智谱 GLM",
    "豆包",
    "月之暗面",
    "百川",
    "MiniMax",
    "Groq",
    "Mistral",
    "Cohere",
    "Perplexity",
    "OpenRouter",
    "Ollama (本地)",
    "LM Studio (本地)",
    "vLLM (本地)",
    "Azure OpenAI",
    "AWS Bedrock",
    "自定义 OpenAI 兼容端点",
];

// Configured models shown in the table — mirrors `MOCK.models`.
struct ModelRow {
    name: &'static str,
    provider: &'static str,
    context: &'static str,
    active: bool,
    c1: (u8, u8, u8),
    c2: (u8, u8, u8),
}

const MODEL_ROWS: &[ModelRow] = &[
    ModelRow { name: "GPT-4o",                provider: "OpenAI",      context: "128K", active: true,  c1: (16, 163, 127),  c2: (16, 185, 129)  },
    ModelRow { name: "Claude 3.5 Sonnet",     provider: "Anthropic",   context: "200K", active: false, c1: (217, 119, 6),   c2: (245, 158, 11)  },
    ModelRow { name: "Gemini 1.5 Pro",        provider: "Google",      context: "2M",   active: false, c1: (59, 130, 246),  c2: (6, 182, 212)   },
    ModelRow { name: "DeepSeek V3",           provider: "DeepSeek",    context: "64K",  active: false, c1: (99, 102, 241),  c2: (168, 85, 247)  },
    ModelRow { name: "Qwen2.5-72B",           provider: "通义千问",    context: "32K",  active: false, c1: (236, 72, 153),  c2: (244, 114, 182) },
    ModelRow { name: "GLM-4-Plus",            provider: "智谱",        context: "128K", active: false, c1: (14, 165, 233),  c2: (6, 182, 212)   },
    ModelRow { name: "Doubao-Pro",            provider: "豆包",        context: "32K",  active: false, c1: (249, 115, 22),  c2: (251, 191, 36)  },
    ModelRow { name: "Moonshot v1",           provider: "月之暗面",    context: "128K", active: false, c1: (139, 92, 246),  c2: (167, 139, 250) },
    ModelRow { name: "Llama 3.3 70B",         provider: "Ollama · 本地", context: "128K", active: false, c1: (34, 211, 238), c2: (16, 185, 129)  },
];

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = LayoutMode::from_width(app.window_size.width);

    let header = column![
        sh_section_header::<Message>("模型", Some(IconName::Cpu)),
        text("支持 30+ 提供商 · 当前激活: DeepSeek V3")
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(2);

    // If editing, show the edit form.
    if let Some(editing) = app.ui_state.editing_provider.clone() {
        return column![
            header,
            Space::new().height(Length::Fixed(12.0)),
            provider_edit_form(theme, editing)
        ]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into();
    }

    let provider_card = preset_card(theme, mode);
    let model_card = configured_models_card(theme);

    let content = column![provider_card, Space::new().height(Length::Fixed(14.0)), model_card]
        .spacing(0)
        .width(Length::Fill);

    let scroll = scrollable(content).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().height(Length::Fixed(14.0)),
        container(scroll).width(Length::Fill).height(Length::Fill),
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

// ── Top card: 添加提供商 with 4-col preset grid ──────────────────

fn preset_card(theme: &crate::theme::Theme, mode: LayoutMode) -> Element<Message> {
    let title_row = row![
        iced::widget::Svg::new(icon(IconName::Plus))
            .width(Length::Fixed(15.0))
            .height(Length::Fixed(15.0)),
        text("添加提供商")
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(14)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        text("从 30+ 预设中选择或自定义 OpenAI 兼容端点")
            .font(CJK_FONT)
            .size(11.5)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .align_y(Alignment::Center)
    .spacing(8)
    .padding(iced::Padding { top: 14.0, bottom: 14.0, left: 20.0, right: 20.0 });

    // Border between header and body.
    let header_border = container(Space::new().height(Length::Fixed(1.0)))
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(theme.border_soft)),
            border: iced::Border::default(),
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        });

    // Preset tiles: 4-col (Wide), 3-col (Medium), 2-col (Compact).
    let cols: usize = match mode {
        LayoutMode::Wide => 4,
        LayoutMode::Medium => 3,
        LayoutMode::Compact => 2,
    };

    let mut tiles: Vec<Element<Message>> = Vec::new();
    for name in PRESET_PROVIDERS.iter().take(12) {
        tiles.push(preset_tile(theme, name));
    }

    let mut rows: Vec<Element<Message>> = Vec::new();
    let mut iter = tiles.into_iter();
    while let Some(first) = iter.next() {
        let mut children = vec![first];
        for _ in 1..cols {
            if let Some(next) = iter.next() {
                children.push(next);
            } else {
                break;
            }
        }
        rows.push(row(children).spacing(10).width(Length::Fill).into());
        rows.push(Space::new().height(Length::Fixed(10.0)).into());
    }
    if !rows.is_empty() {
        rows.pop();
    }
    let grid = column(rows).spacing(0).width(Length::Fill);

    let body = container(grid).padding(20.0).width(Length::Fill);

    let card = column![title_row, header_border, body].width(Length::Fill);

    container(card)
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .width(Length::Fill)
        .into()
}

fn preset_tile(theme: &crate::theme::Theme, name: &str) -> Element<Message> {
    let tile = container(
        column![
            text(name.to_string())
                .font(CJK_FONT)
                .size(12.5)
                .style(move |_: &iced::Theme| style::text_primary(theme)),
            Space::new().height(Length::Fixed(2.0)),
            row![
                iced::widget::Svg::new(icon(IconName::Plus))
                    .width(Length::Fixed(10.0))
                    .height(Length::Fixed(10.0)),
                text("配置")
                    .font(CJK_FONT)
                    .size(10.5)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(4)
            .align_y(Alignment::Center),
        ]
        .spacing(0),
    )
    .padding(iced::Padding { top: 12.0, bottom: 12.0, left: 12.0, right: 12.0 })
    .width(Length::Fill)
    .style(move |_: &iced::Theme| style::card_flat(theme));

    // The preview uses `:hover` border-color to `rgba(168,85,247,.4)`. We
    // approximate that via a ghost button wrapper.
    iced::widget::button(tile)
        .style(move |_, status| style::ghost_button(theme, status))
        .padding(0)
        .width(Length::Fill)
        .on_press(Message::EditProvider(Some(crate::models::LlmProvider {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.openai.com/v1".into(),
            api_key: None,
            model: "gpt-4o-mini".into(),
            enabled: true,
        })))
        .into()
}

// ── Bottom card: 已配置模型 + table ──────────────────────────────

fn configured_models_card(theme: &crate::theme::Theme) -> Element<Message> {
    let title_row = row![
        iced::widget::Svg::new(icon(IconName::Cpu))
            .width(Length::Fixed(15.0))
            .height(Length::Fixed(15.0)),
        text("已配置模型")
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(14)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        text(format!("{} 个", MODEL_ROWS.len()))
            .font(CJK_FONT)
            .size(11.5)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .align_y(Alignment::Center)
    .spacing(8)
    .padding(iced::Padding { top: 14.0, bottom: 14.0, left: 20.0, right: 20.0 });

    // Border between header and body.
    let header_border = container(Space::new().height(Length::Fixed(1.0)))
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(theme.border_soft)),
            border: iced::Border::default(),
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        });

    // Table header.
    let head = row![
        table_header_cell(theme, "模型", 4.0),
        table_header_cell(theme, "提供商", 2.0),
        table_header_cell(theme, "上下文", 2.0),
        table_header_cell(theme, "状态", 2.0),
        table_header_cell(theme, "", 2.0),
    ]
    .spacing(10)
    .padding(iced::Padding { top: 12.0, bottom: 12.0, left: 20.0, right: 20.0 })
    .width(Length::Fill);

    // Border below the header.
    let head_border = container(Space::new().height(Length::Fixed(1.0)))
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(theme.border_soft)),
            border: iced::Border::default(),
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        });

    let mut rows: Vec<Element<Message>> = Vec::new();
    for m in MODEL_ROWS {
        rows.push(model_row(theme, m).into());
    }
    let body = column(rows).spacing(0).width(Length::Fill);

    let card = column![title_row, header_border, head, head_border, body].width(Length::Fill);

    container(card)
        .style(move |_: &iced::Theme| style::card_flat(theme))
        .width(Length::Fill)
        .into()
}

fn table_header_cell(theme: &crate::theme::Theme, label: &str, _weight: f32) -> Element<Message> {
    text(label)
        .font(Font {
            family: CJK_FONT.family,
            weight: iced::font::Weight::Bold,
            ..Default::default()
        })
        .size(11.5)
        .style(move |_: &iced::Theme| style::text_faint(theme))
        .into()
}

fn model_row(theme: &crate::theme::Theme, m: &ModelRow) -> Element<Message> {
    // Gradient swatch (28×28, 7 px radius).
    let (r1, g1, b1) = m.c1;
    let (r2, g2, b2) = m.c2;
    let c1 = iced::Color::from_rgb(r1 as f32 / 255.0, g1 as f32 / 255.0, b1 as f32 / 255.0);
    let c2 = iced::Color::from_rgb(r2 as f32 / 255.0, g2 as f32 / 255.0, b2 as f32 / 255.0);

    let swatch: Element<Message> = container(Space::new().width(Length::Fixed(28.0)).height(Length::Fixed(28.0)))
        .style(move |_| iced::widget::container::Style {
            background: Some(iced::Background::Gradient(iced::Gradient::Linear(
                iced::gradient::Linear::new(iced::Degrees(135.0))
                    .add_stop(0.0, c1)
                    .add_stop(1.0, c2),
            ))),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(7.0),
            },
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        })
        .into();

    let name_cell = row![swatch, text(m.name)
        .font(Font {
            family: CJK_FONT.family,
            weight: iced::font::Weight::Bold,
            ..Default::default()
        })
        .size(13)
        .style(move |_: &iced::Theme| style::text_primary(theme))]
        .spacing(10)
        .align_y(Alignment::Center)
        .width(Length::Fill)
        .into();

    let provider_cell = text(m.provider)
        .font(CJK_FONT)
        .size(12)
        .style(move |_: &iced::Theme| style::text_dim(theme))
        .into();

    let context_cell = text(m.context)
        .font(CJK_FONT)
        .size(12)
        .style(move |_: &iced::Theme| style::text_faint(theme))
        .into();

    let status_pill = if m.active {
        badge::pill_with_dot("当前使用", PillTone::Emerald, true)
    } else {
        badge::pill_with_dot("已配置", PillTone::Zinc, true)
    };

    // Action buttons: 测试 / 设置
    let test_btn = action_btn(theme, IconName::Zap, "测试");
    let settings_btn = action_btn(theme, IconName::Settings, "设置");
    let actions = row![test_btn, settings_btn]
        .spacing(4)
        .align_y(Alignment::Center)
        .into();

    let body = row![name_cell, provider_cell, context_cell, status_pill, actions]
        .spacing(10)
        .padding(iced::Padding { top: 12.0, bottom: 12.0, left: 20.0, right: 20.0 })
        .align_y(Alignment::Center)
        .width(Length::Fill);

    // Dashed row separator (preview uses `border-bottom:1px dashed var(--border)`).
    container(body)
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::TRANSPARENT)),
            border: iced::Border {
                color: theme.border_soft,
                width: 0.0,
                radius: iced::border::Radius::from(0.0),
            },
            shadow: iced::Shadow::default(),
            text_color: None,
            snap: false,
        })
        .into()
}

fn action_btn(theme: &crate::theme::Theme, ic: IconName, label: &str) -> Element<Message> {
    iced::widget::button(
        row![
            iced::widget::Svg::new(icon(ic))
                .width(Length::Fixed(11.0))
                .height(Length::Fixed(11.0)),
            text(label)
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(4)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([4.0, 9.0])
    .into()
}

// ── Edit form (when `editing_provider` is Some) ────────────────────

fn provider_edit_form(
    theme: &crate::theme::Theme,
    provider: crate::models::LlmProvider,
) -> Element<Message> {
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
    items.push(Space::new().height(Length::Fixed(16.0)).into());

    // Theme picker card to make the form feel native to the design system.
    // (Real model selection uses the standard input below.)
    items.push(
        text("外观 / 主题")
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_faint(theme))
            .into(),
    );
    items.push(Space::new().height(Length::Fixed(6.0)).into());
    items.push(
        theme_picker::<Message>(ThemeChoice::Dark, |_c| Message::SettingsActiveProviderChanged(
            provider.id.clone(),
        ))
        .into(),
    );
    items.push(Space::new().height(Length::Fixed(20.0)).into());

    let p = provider.clone();

    items.push(
        field_label(theme, "名称"),
    );
    items.push(
        text_input("例如: OpenAI", &p.name)
            .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::Name(v)))
            .font(CJK_FONT)
            .size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::text_input_style(theme, status))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().height(Length::Fixed(10.0)).into());

    let kind_options = vec![
        (ProviderKind::OpenAi, "OpenAI"),
        (ProviderKind::Anthropic, "Anthropic"),
        (ProviderKind::Gemini, "Gemini"),
        (ProviderKind::OpenRouter, "OpenRouter"),
        (ProviderKind::Ollama, "Ollama"),
        (ProviderKind::Custom, "自定义"),
    ];
    let kind_labels: Vec<String> = kind_options.iter().map(|(_, l)| l.to_string()).collect();
    let current_kind_label = kind_options
        .iter()
        .find(|(k, _)| *k == p.kind)
        .map(|(_, l)| l.to_string())
        .unwrap_or_else(|| "OpenAI".to_string());

    items.push(field_label(theme, "类型"));
    items.push(
        pick_list(
            kind_labels,
            Some(current_kind_label),
            move |label| {
                let kind = kind_options
                    .iter()
                    .find(|(_, l)| *l == label)
                    .map(|(k, _)| *k)
                    .unwrap_or(ProviderKind::OpenAi);
                Message::ProviderFieldChanged(crate::app::ProviderField::Kind(kind))
            },
        )
        .font(CJK_FONT)
        .text_size(13)
        .padding([8.0, 10.0])
        .style(move |_, status| style::pick_list_style(theme, status))
        .width(Length::Fill)
        .into(),
    );
    items.push(Space::new().height(Length::Fixed(10.0)).into());

    items.push(field_label(theme, "API 地址"));
    items.push(
        text_input("例如: https://api.openai.com/v1", &p.base_url)
            .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::BaseUrl(v)))
            .font(CJK_FONT)
            .size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::text_input_style(theme, status))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().height(Length::Fixed(10.0)).into());

    items.push(field_label(theme, "API 密钥"));
    items.push(
        text_input("输入 API 密钥 (可选)", &p.api_key.clone().unwrap_or_default())
            .secure(true)
            .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::ApiKey(v)))
            .font(CJK_FONT)
            .size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::text_input_style(theme, status))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().height(Length::Fixed(10.0)).into());

    items.push(field_label(theme, "模型"));
    items.push(
        text_input("例如: gpt-4o-mini", &p.model)
            .on_input(|v| Message::ProviderFieldChanged(crate::app::ProviderField::Model(v)))
            .font(CJK_FONT)
            .size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::text_input_style(theme, status))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().height(Length::Fixed(10.0)).into());

    let enabled_options = vec!["启用".to_string(), "禁用".to_string()];
    let current_enabled = if p.enabled { "启用".to_string() } else { "禁用".to_string() };
    items.push(field_label(theme, "状态"));
    items.push(
        pick_list(
            enabled_options,
            Some(current_enabled),
            move |label| Message::ProviderFieldChanged(
                crate::app::ProviderField::Enabled(label == "启用"),
            ),
        )
        .font(CJK_FONT)
        .text_size(13)
        .padding([8.0, 10.0])
        .style(move |_, status| style::pick_list_style(theme, status))
        .width(Length::Fill)
        .into(),
    );
    items.push(Space::new().height(Length::Fixed(16.0)).into());

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

fn field_label(theme: &crate::theme::Theme, text_str: &str) -> Element<Message> {
    text(text_str.to_string())
        .font(CJK_FONT)
        .size(12)
        .style(move |_: &iced::Theme| style::text_faint(theme))
        .into()
}
