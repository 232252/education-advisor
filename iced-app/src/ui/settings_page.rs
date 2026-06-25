//! Settings page — theme picker, AI behaviour, providers, behaviour switches,
//! keyboard shortcuts.
//!
//! Layout (matches `iced-app/preview/index.html#page-settings`):
//!
//! ```text
//! ┌──────────────── pageHead ────────────────┐
//! ├ row-2 (1/1 on Compact) ───────────────────┤
//! │  ┌── AI 行为 ──┐ ┌── 外观 ──┐              │
//! │  │ provider    │ │ theme    │              │
//! │  │ api_key     │ │ accent   │              │
//! │  │ sliders     │ │ font     │              │
//! │  └─────────────┘ └──────────┘              │
//! │  ┌── 行为开关 ┐ ┌── 快捷键 ──┐              │
//! │  │ toggles    │ │ kbd list  │              │
//! │  └─────────────┘ └──────────┘              │
//! └──────────────────────────────────────────┘
//! ```
//!
//! Responsive: `LayoutMode::Compact` collapses to a single column.

use iced::widget::{column, container, pick_list, row, scrollable, slider, text, Space, Svg};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::ThemeMode;
use crate::ui::components;
use crate::ui::components::theme_picker::{theme_picker, ThemeChoice};
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;
use crate::ui::widgets;

/// Public page entry — same signature as cycle 1, body rewritten to render
/// the 4-card `.row-2` layout and use `components::theme_picker`.
pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = app.layout_mode;

    let header = widgets::page_header(theme, "设置", "个性化 AI 行为 · 主题 · 快捷键 · 数据管理");

    // ── Card 1: AI 行为 (provider + sliders) ──
    let providers = app.providers.read().clone();
    let provider_ids: Vec<String> = providers.iter().map(|p| p.name.clone()).collect();
    let active_name = app
        .settings
        .active_provider_id
        .as_ref()
        .and_then(|id| providers.iter().find(|p| &p.id == id).map(|p| p.name.clone()))
        .unwrap_or_default();

    let api_key_preview = "sk-****************************c3a2";

    let ai_card_body = column![
        field(
            theme,
            "当前提供商",
            pick_list(
                provider_ids.clone(),
                if active_name.is_empty() { None } else { Some(active_name.clone()) },
                {
                    let providers2 = providers.clone();
                    move |name| {
                        let id = providers2
                            .iter()
                            .find(|p| p.name == name)
                            .map(|p| p.id.clone())
                            .unwrap_or(name);
                        Message::SettingsActiveProviderChanged(id)
                    }
                },
            )
            .font(CJK_FONT)
            .text_size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::pick_list_style(theme, status))
            .width(Length::Fill)
            .into(),
        ),
        field(
            theme,
            "API 密钥",
            column![
                text_input_field("输入 API 密钥", api_key_preview)
                    .on_input(|_v| Message::None)
                    .font(Font::MONOSPACE)
                    .size(13)
                    .padding([8.0, 10.0])
                    .style(move |_, status| style::text_input_style(theme, status))
                    .width(Length::Fill)
                    .secure(true),
                Space::new().width(0.0).height(style::spacing::XS),
                text("使用 AES-256-GCM 加密后存储在本地数据库")
                    .size(11.5)
                    .font(CJK_FONT)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(0)
            .into(),
        ),
        slider_field(
            theme,
            "温度 (Temperature)",
            app.settings.temperature,
            0.0,
            1.0,
            format!("{:.2}", app.settings.temperature),
            40.0,
            Message::SettingsTemperatureChanged,
        ),
        slider_field_int(
            theme,
            "最大迭代次数",
            app.settings.max_tool_iterations as f32,
            1.0,
            20.0,
            format!("{}", app.settings.max_tool_iterations),
            40.0,
            |v| Message::SettingsMaxIterChanged(v.round().max(1.0) as u32),
        ),
        slider_field(
            theme,
            "Top-P",
            0.9,
            0.0,
            1.0,
            "0.90".to_string(),
            90.0,
            |_| Message::None,
        ),
    ]
    .spacing(style::spacing::LG);

    let ai_card = card(theme, IconName::Cpu, "AI 行为", ai_card_body);

    // ── Card 2: 外观 (theme picker + accent dots + font select) ──
    let current_choice = match app.settings.theme {
        ThemeMode::Dark => ThemeChoice::Dark,
        ThemeMode::Light => ThemeChoice::Light,
        ThemeMode::Auto => ThemeChoice::Auto,
    };

    let theme_picker_el: Element<Message> = theme_picker(current_choice, |choice| {
        let mode = match choice {
            ThemeChoice::Dark => ThemeMode::Dark,
            ThemeChoice::Light => ThemeMode::Light,
            ThemeChoice::Auto => ThemeMode::Auto,
        };
        Message::SettingsThemeChanged(mode)
    });

    let accent_dots = accent_dot_row(theme);

    let font_select: Element<Message> = pick_list(
        vec![
            "Outfit + Noto Sans SC（推荐）".to_string(),
            "Inter".to_string(),
            "系统默认".to_string(),
        ],
        Some("Outfit + Noto Sans SC（推荐）".to_string()),
        |_| Message::None,
    )
    .font(CJK_FONT)
    .text_size(13)
    .padding([8.0, 10.0])
    .style(move |_, status| style::pick_list_style(theme, status))
    .width(Length::Fill)
    .into();

    let appearance_card_body = column![
        field(theme, "主题", theme_picker_el),
        field(theme, "强调色", accent_dots),
        field(theme, "字体", font_select),
    ]
    .spacing(style::spacing::LG);

    let appearance_card = card(theme, IconName::Sparkles, "外观", appearance_card_body);

    // ── Card 3: 行为开关 (toggles) ──
    let toggles = vec![
        ("启用流式输出", "逐字返回响应，体验更流畅", true),
        ("工具调用可视化", "在右侧面板显示工具调用时间轴", true),
        ("PII 假名化", "学生姓名 → S_001 等确定性别名", true),
        ("正则脱敏", "电话 / 身份证 / 邮箱自动屏蔽", true),
        ("定向发送过滤", "其他学生姓名 → \"其他同学\"", true),
        ("系统托盘", "最小化到系统托盘（需启用 tray feature）", false),
        ("开机自启", "系统启动时自动运行", false),
    ];

    let mut toggle_col = column![].spacing(0);
    for (label, sub, on) in toggles.iter() {
        toggle_col = toggle_col.push(toggle_row(theme, label, sub, *on));
    }
    let behaviour_card = card(theme, IconName::Key, "行为开关", toggle_col);

    // ── Card 4: 快捷键 (kbd list) ──
    let shortcuts = vec![
        ("⌘ 1 — ⌘ 0", "跳转到第 n 个导航"),
        ("⌘ B", "切换侧边栏"),
        ("⌘ K", "跳转到对话"),
        ("⌘ ,", "打开设置"),
        ("Esc", "取消正在进行的 AI 生成"),
        ("Shift ⏎", "在输入框中换行"),
    ];
    let mut kbd_col = column![].spacing(0);
    for (k, v) in shortcuts.iter() {
        kbd_col = kbd_col.push(shortcut_row(theme, k, v));
    }
    let shortcuts_card = card(theme, IconName::Zap, "快捷键", kbd_col);

    // ── Compose the grid: row-2 of (card1 | card2), (card3 | card4) ──
    let grid: Element<Message> = if mode.is_compact() {
        let mut col = column![].spacing(style::spacing::MD).width(Length::Fill);
        col = col.push(ai_card);
        col = col.push(appearance_card);
        col = col.push(behaviour_card);
        col = col.push(shortcuts_card);
        col.into()
    } else {
        let r1 = row![ai_card, Space::new().width(style::spacing::MD), appearance_card]
            .spacing(0)
            .width(Length::Fill);
        let r2 = row![behaviour_card, Space::new().width(style::spacing::MD), shortcuts_card]
            .spacing(0)
            .width(Length::Fill);
        column![r1, Space::new().width(0.0).height(style::spacing::MD), r2]
            .spacing(0)
            .width(Length::Fill)
            .into()
    };

    // ── Bottom save / reset row ──
    let bottom_row = if mode.is_compact() {
        let mut col = column![].spacing(style::spacing::SM).width(Length::Fill);
        col = col.push(reset_button(theme));
        col = col.push(save_button(theme));
        col.into()
    } else {
        row![
            Space::new().width(Length::Fill).height(0),
            reset_button(theme),
            save_button(theme),
        ]
        .spacing(style::spacing::SM)
        .align_y(Alignment::Center)
        .width(Length::Fill)
        .into()
    };

    let body = column![
        grid,
        Space::new().width(0.0).height(style::spacing::MD),
        bottom_row,
    ]
    .spacing(0)
    .width(Length::Fill);

    let content = scrollable(body).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().width(0.0).height(style::spacing::MD),
        container(content).width(Length::Fill).height(Length::Fill),
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

// ── Card wrapper (icon + title + content) ─────────────────────────

fn card(
    theme: &crate::theme::Theme,
    ic: IconName,
    title: &str,
    body: iced::widget::Column<'_, Message>,
) -> Element<Message> {
    let head = row![
        Svg::new(icon(ic))
            .width(Length::Fixed(15.0))
            .height(Length::Fixed(15.0)),
        Space::new().width(style::spacing::SM),
        text(title.to_string())
            .size(14)
            .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
            .style(move |_: &iced::Theme| style::text_primary(theme)),
    ]
    .spacing(0)
    .align_y(Alignment::Center)
    .padding(Padding { top: 14.0, bottom: 12.0, left: 18.0, right: 18.0 });

    container(
        column![head, container(body).padding(Padding { top: 0.0, bottom: 18.0, left: 18.0, right: 18.0 })]
            .spacing(0)
            .width(Length::Fill),
    )
    .style(move |_: &iced::Theme| style::card(theme))
    .padding(0)
    .width(Length::Fill)
    .into()
}

// ── Field / slider / toggle helpers ───────────────────────────────

fn field(
    theme: &crate::theme::Theme,
    label: &str,
    control: Element<Message>,
) -> Element<Message> {
    column![
        text(label.to_string())
            .size(12)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        Space::new().width(0.0).height(style::spacing::XS),
        control,
    ]
    .spacing(0)
    .into()
}

fn text_input_field(
    placeholder: &str,
    value: &str,
) -> iced::widget::TextInput<'_, Message> {
    iced::widget::text_input(placeholder, value)
}

fn slider_field(
    theme: &crate::theme::Theme,
    label: &str,
    value: f32,
    min: f32,
    max: f32,
    value_label: String,
    pct: f32,
    on_change: fn(f32) -> Message,
) -> Element<Message> {
    slider_field_inner(theme, label, value, min, max, value_label, pct, true, on_change)
}

fn slider_field_int(
    theme: &crate::theme::Theme,
    label: &str,
    value: f32,
    min: f32,
    max: f32,
    value_label: String,
    pct: f32,
    on_change: fn(f32) -> Message,
) -> Element<Message> {
    slider_field_inner(theme, label, value, min, max, value_label, pct, false, on_change)
}

fn slider_field_inner(
    theme: &crate::theme::Theme,
    label: &str,
    value: f32,
    min: f32,
    max: f32,
    value_label: String,
    _pct: f32,
    is_float: bool,
    on_change: fn(f32) -> Message,
) -> Element<Message> {
    let s = if is_float {
        slider(min..=max, value, on_change)
            .step(0.01)
            .width(Length::Fill)
            .into()
    } else {
        slider(min..=max, value, on_change).width(Length::Fill).into()
    };

    column![
        text(label.to_string())
            .size(12)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        Space::new().width(0.0).height(style::spacing::SM),
        row![
            s,
            Space::new().width(style::spacing::MD),
            text(value_label)
                .size(13)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(theme.accent), ..Default::default() })
                .width(Length::Fixed(56.0)),
        ]
        .spacing(0)
        .align_y(Alignment::Center)
        .width(Length::Fill),
    ]
    .spacing(0)
    .into()
}

fn toggle_row(theme: &crate::theme::Theme, label: &str, sub: &str, on: bool) -> Element<Message> {
    container(
        row![
            column![
                text(label.to_string())
                    .size(13)
                    .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
                    .style(move |_: &iced::Theme| style::text_primary(theme)),
                if sub.is_empty() {
                    Space::new().width(0.0).height(0).into()
                } else {
                    text(sub.to_string())
                        .size(11.5)
                        .font(CJK_FONT)
                        .style(move |_: &iced::Theme| style::text_faint(theme))
                        .into()
                },
            ]
            .spacing(0),
            Space::new().width(Length::Fill).height(0),
            privacy_toggle(theme, on),
        ]
        .spacing(0)
        .align_y(Alignment::Center)
        .padding(Padding { top: 11.0, bottom: 11.0, left: 0.0, right: 0.0 }),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        border: iced::Border {
            color: style::border_step::soft(theme),
            width: 0.0,
            radius: iced::border::Radius::from(0.0),
        },
        ..Default::default()
    })
    .width(Length::Fill)
    .into()
}

fn privacy_toggle(theme: &crate::theme::Theme, on: bool) -> Element<Message> {
    let bg = if on {
        theme.purple
    } else {
        style::border_step::strong(theme)
    };
    let thumb_offset = if on { 18.0 } else { 2.0 };
    let thumb = container(Space::new().width(Length::Fixed(18.0)).height(Length::Fixed(18.0)))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::WHITE)),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(style::radius::PILL),
            },
            ..Default::default()
        });
    let track = container(
        row![Space::new().width(Length::Fixed(thumb_offset)).height(0), thumb]
            .spacing(0)
            .align_y(Alignment::Center)
            .padding(0),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(bg)),
        border: iced::Border {
            color: iced::Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(style::radius::PILL),
        },
        ..Default::default()
    })
    .width(Length::Fixed(38.0))
    .height(Length::Fixed(22.0))
    .padding(Padding { top: 2.0, bottom: 2.0, left: 0.0, right: 0.0 });

    iced::widget::button(track)
        .style(|_t, _status| iced::widget::button::Style {
            background: Some(iced::Background::Color(iced::Color::TRANSPARENT)),
            text_color: iced::Color::WHITE,
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(style::radius::PILL),
            },
            ..Default::default()
        })
        .padding(0)
        .on_press(Message::None)
    .into()
}

fn shortcut_row(theme: &crate::theme::Theme, key: &str, action: &str) -> Element<Message> {
    container(
        row![
            text(action.to_string())
                .size(12.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            Space::new().width(Length::Fill).height(0),
            container(text(key.to_string()).size(11.5).font(Font::MONOSPACE).style(
                move |_: &iced::Theme| style::text_dim(theme),
            ))
            .padding(Padding { top: 3.0, bottom: 3.0, left: 9.0, right: 9.0 })
            .style(move |_: &iced::Theme| iced::widget::container::Style {
                background: Some(iced::Background::Color(theme.bg)),
                border: iced::Border {
                    color: style::border_step::strong(theme),
                    width: 1.0,
                    radius: iced::border::Radius::from(style::radius::SM),
                },
                ..Default::default()
            }),
        ]
        .spacing(0)
        .align_y(Alignment::Center)
        .padding(Padding { top: 10.0, bottom: 10.0, left: 0.0, right: 0.0 }),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        border: iced::Border {
            color: style::border_step::soft(theme),
            width: 0.0,
            radius: iced::border::Radius::from(0.0),
        },
        ..Default::default()
    })
    .width(Length::Fill)
    .into()
}

fn accent_dot_row(theme: &crate::theme::Theme) -> Element<Message> {
    use crate::ui::style::accent;
    let pairs: Vec<(iced::Color, iced::Color, bool)> = vec![
        (accent::violet(),  accent::pink(),    true),
        (accent::cyan(),    accent::blue(),    false),
        (accent::emerald(), accent::cyan(),    false),
        (accent::amber(),   accent::red(),     false),
        (accent::pink(),    accent::amber(),   false),
    ];

    let dots: Vec<Element<Message>> = pairs
        .into_iter()
        .map(|(ca, cb, active)| {
            let bg = iced::Background::Gradient(iced::Gradient::Linear(
                iced::gradient::Linear::new(iced::Degrees(135.0))
                    .add_stop(0.0, ca)
                    .add_stop(1.0, cb),
            ));
            let border_color = if active {
                iced::Color::WHITE
            } else {
                iced::Color::from_rgba(1.0, 1.0, 1.0, 0.2)
            };
            container(Space::new().width(Length::Fixed(30.0)).height(Length::Fixed(30.0)))
                .style(move |_: &iced::Theme| iced::widget::container::Style {
                    background: Some(bg),
                    border: iced::Border {
                        color: border_color,
                        width: if active { 2.0 } else { 1.0 },
                        radius: iced::border::Radius::from(15.0),
                    },
                    ..Default::default()
                })
                .into()
        })
        .collect();

    let mut r = row![].spacing(style::spacing::SM).align_y(Alignment::Center);
    for d in dots {
        r = r.push(d);
    }
    r.into()
}

fn save_button(theme: &crate::theme::Theme) -> Element<Message> {
    iced::widget::button(
        row![
            Svg::new(icon(IconName::Check))
                .width(Length::Fixed(14.0))
                .height(Length::Fixed(14.0)),
            Space::new().width(style::spacing::SM),
            text("保存设置")
                .size(13)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(iced::Color::WHITE), ..Default::default() }),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::grad_button(theme, status))
    .padding([10.0, 18.0])
    .on_press(Message::SaveSettings)
    .into()
}

fn reset_button(theme: &crate::theme::Theme) -> Element<Message> {
    iced::widget::button(
        text("重置默认")
            .size(13)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    )
    .style(move |_, status| style::secondary_button(theme, status))
    .padding([10.0, 18.0])
    .on_press(Message::None)
    .into()
}

// ── re-exports for component-API grep-ability ──────────────────────

#[allow(unused_imports)]
use components::badge as _Badge;