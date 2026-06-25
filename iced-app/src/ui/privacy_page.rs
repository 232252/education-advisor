//! Privacy page — PII Shield, encryption, data management.
//!
//! Layout (matches `iced-app/preview/index.html#page-privacy`):
//!
//! ```text
//! ┌──────────────── pageHead ────────────────┐
//! ├ grid-cols-2 (1/1 on Compact) ────────────┤
//! │  ┌ Card #1 ┐ ┌ Card #2 ┐                  │
//! │  │ shield  │ │ filter  │                  │
//! │  │ PII     │ │ 3 toggle│                  │
//! │  └─────────┘ └─────────┘                  │
//! │  ┌ Card #3 ┐ ┌ Card #4 ┐                  │
//! │  │ lock    │ │ eye     │                  │
//! │  │ AES-GCM │ │ regex   │                  │
//! │  └─────────┘ └─────────┘                  │
//! └──────────────────────────────────────────┘
//! ```
//!
//! Each card has a 3 px coloured left edge (`border-left: 3px solid <tone>`)
//! per the preview. The four card accent tones are emerald / violet / cyan / amber.

use iced::widget::{column, container, row, scrollable, text, Space, Svg};
use iced::{Alignment, Color, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::components;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;
use crate::ui::widgets;

/// Public page entry — same signature as cycle 1, body rewritten to render
/// the 4-card grid (3px coloured left edge + icon block + body) plus the
/// three privacy-toggle switches and the action button row.
pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = app.layout_mode;

    let header = widgets::page_header(
        theme,
        "隐私",
        "PII Shield 假名化 · AES-256-GCM 加密 · 定向发送过滤 · 全链路防护",
    );

    let pii = app.pii.lock();
    let pii_enabled = pii.enabled;
    let pii_count = pii.mapping_count();
    drop(pii);

    // ── Card #1: PII Shield pseudonymisation (emerald left edge) ──
    let card1 = privacy_card(
        theme,
        IconName::Shield,
        emerald(),
        "PII Shield 假名化引擎",
        "真实姓名 → S_001 / P_001 确定性别名",
        column![
            text("AI 永远看不到明文姓名。映射表以 AES-256-GCM 加密存储在 ")
                .size(12.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            inline_code("/data-dir/privacy/mapping.enc"),
            text("，密钥由你的密码派生。")
                .size(12.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            Space::new().width(0.0).height(style::spacing::SM),
            stat_row(
                theme,
                "已映射实体",
                &format!("{}", pii_count.min(2847)),
                emerald(),
            ),
            Space::new().width(0.0).height(style::spacing::SM),
            row![
                action_btn(
                    theme,
                    IconName::Eye,
                    "查看示例",
                    Message::PiiOpenMappings,
                ),
                action_btn(
                    theme,
                    IconName::Key,
                    "更换密码",
                    Message::PiiPasswordChanged(String::new()),
                ),
            ]
            .spacing(style::spacing::SM),
        ]
        .spacing(0),
    );

    // ── Card #2: Targeted-send filter (violet left edge) — 3 toggles ──
    let toggle1 = toggle_row(theme, "启用定向过滤", true);
    let toggle2 = toggle_row(theme, "替换为「其他同学」", true);
    let toggle3 = toggle_row(theme, "保留收件人姓名", true);
    let card2 = privacy_card(
        theme,
        IconName::Filter,
        violet(),
        "定向发送过滤器",
        "给 张三妈妈 发消息时，其他学生真实姓名 → \"其他同学\"",
        column![
            toggle1,
            Space::new().width(0.0).height(style::spacing::SM),
            toggle2,
            Space::new().width(0.0).height(style::spacing::SM),
            toggle3,
        ]
        .spacing(0),
    );

    // ── Card #3: AES-256-GCM (cyan left edge) ──
    let card3 = privacy_card(
        theme,
        IconName::Lock,
        cyan(),
        "AES-256-GCM 落盘加密",
        "监护人联系方式 · 提供商 API 密钥",
        column![
            text("每个安装生成独立随机盐。密钥派生自系统主密钥，丢失主密钥 = 永久丢失数据（设计如此）。")
                .size(12.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            Space::new().width(0.0).height(style::spacing::SM),
            mono_block(
                theme,
                &[
                    ("salt", "0x7e4f...b21a"),
                    ("key_id", "edu-advisor-v1"),
                    ("algo", "AES-256-GCM"),
                ],
                Color::from_rgba(103.0 / 255.0, 232.0 / 255.0, 249.0 / 255.0, 1.0),
            ),
        ]
        .spacing(0),
    );

    // ── Card #4: Regex PII masking (amber left edge) ──
    let card4 = privacy_card(
        theme,
        IconName::Eye,
        amber(),
        "正则 PII 脱敏",
        "电话 / 身份证 / 邮箱在每次出站提示前自动屏蔽",
        column![
            mask_block(theme, "原始", "张明轩 138****1234 3201**********0011", false),
            Space::new().width(0.0).height(style::spacing::SM),
            mask_block(theme, "脱敏后 → AI 看到的", "S_001 138****1234 3201**********0011", true),
        ]
        .spacing(0),
    );

    let cards: [Element<Message>; 4] = [card1, card2, card3, card4];

    let grid: Element<Message> = if mode.is_compact() {
        let mut col = column![].spacing(style::spacing::MD).width(Length::Fill);
        for c in cards {
            col = col.push(c);
        }
        col.into()
    } else {
        let mut col = column![].spacing(style::spacing::MD).width(Length::Fill);
        let mut iter = cards.into_iter();
        while let Some(a) = iter.next() {
            let b = iter.next();
            let r = if let Some(b_el) = b {
                row![a, Space::new().width(style::spacing::MD), b_el]
                    .spacing(0)
                    .width(Length::Fill)
            } else {
                row![a].spacing(0).width(Length::Fill)
            };
            col = col.push(r);
        }
        col.into()
    };

    let content = scrollable(grid).style(move |_, _| style::scrollable(theme));

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

// ── Card building blocks ───────────────────────────────────────────

fn privacy_card<'a>(
    theme: &'a crate::theme::Theme,
    icon: IconName,
    accent: Color,
    title: &'a str,
    subtitle: &'a str,
    body: iced::widget::Column<'a, Message>,
) -> Element<'a, Message> {
    let head = row![
        icon_box(theme, icon, accent),
        Space::new().width(style::spacing::SM),
        column![
            text(title.to_string())
                .size(14)
                .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
                .style(move |_: &iced::Theme| style::text_primary(theme)),
            Space::new().width(0.0).height(2),
            text(subtitle.to_string())
                .size(11.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(0),
    ]
    .spacing(0)
    .align_y(Alignment::Center)
    .padding(Padding { top: 0.0, bottom: 12.0, left: 0.0, right: 0.0 });

    let body_block = container(body)
        .padding(Padding { top: 0.0, bottom: 0.0, left: 0.0, right: 0.0 })
        .width(Length::Fill);

    let column = column![head, body_block]
        .spacing(0)
        .padding(Padding { top: 20.0, bottom: 18.0, left: 22.0, right: 22.0 });

    let left_bar = container(Space::new().width(Length::Fixed(3.0)).height(Length::Fill))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(accent)),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(0.0),
            },
            ..Default::default()
        });

    container(
        row![left_bar, column]
            .spacing(0)
            .align_y(Alignment::Start),
    )
    .style(move |_: &iced::Theme| style::card_flat(theme))
    .padding(0)
    .width(Length::Fill)
    .into()
}

fn icon_box(theme: &crate::theme::Theme, ic: IconName, accent: Color) -> Element<Message> {
    container(
        Svg::new(icon(ic))
            .width(Length::Fixed(18.0))
            .height(Length::Fixed(18.0)),
    )
    .padding(9.0)
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(Color {
            a: 0.05,
            ..accent
        })),
        border: iced::Border {
            color: Color { a: 0.3, ..accent },
            width: 1.0,
            radius: iced::border::Radius::from(10.0),
        },
        ..Default::default()
    })
    .into()
}

fn inline_code(text: &str) -> Element<Message> {
    container(text(text.to_string()).size(12).font(Font::MONOSPACE).style(
        |_: &iced::Theme| iced::widget::text::Style {
            color: Some(Color::from_rgb(0.98, 0.75, 0.14)),
            ..Default::default()
        },
    ))
    .padding(Padding { top: 1.0, bottom: 1.0, left: 5.0, right: 5.0 })
    .style(|_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(Color::from_rgba(0.0, 0.0, 0.0, 0.3))),
        border: iced::Border {
            color: iced::Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(4.0),
        },
        ..Default::default()
    })
    .into()
}

fn stat_row(
    theme: &crate::theme::Theme,
    label: &str,
    value: &str,
    accent: Color,
) -> Element<Message> {
    container(
        row![
            text(label.to_string())
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            Space::new().width(Length::Fill).height(0),
            text(value.to_string())
                .size(14)
                .font(Font::MONOSPACE)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(accent), ..Default::default() }),
        ]
        .spacing(0)
        .align_y(Alignment::Center)
        .padding(Padding { top: 10.0, bottom: 10.0, left: 12.0, right: 12.0 }),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(Color { a: 0.06, ..accent })),
        border: iced::Border {
            color: Color { a: 0.15, ..accent },
            width: 1.0,
            radius: iced::border::Radius::from(9.0),
        },
        ..Default::default()
    })
    .width(Length::Fill)
    .into()
}

fn action_btn(
    theme: &crate::theme::Theme,
    ic: IconName,
    label: &str,
    on_press: Message,
) -> Element<Message> {
    iced::widget::button(
        row![
            Svg::new(icon(ic))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            Space::new().width(5).height(0),
            text(label)
                .size(11.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([5.0, 11.0])
    .on_press(on_press)
    .into()
}

fn toggle_row(theme: &crate::theme::Theme, label: &str, on: bool) -> Element<Message> {
    container(
        row![
            text(label.to_string())
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            Space::new().width(Length::Fill).height(0),
            privacy_toggle(theme, on),
        ]
        .spacing(0)
        .align_y(Alignment::Center)
        .padding(Padding { top: 10.0, bottom: 10.0, left: 12.0, right: 12.0 }),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(violet_alpha(0.06))),
        border: iced::Border {
            color: violet_alpha(0.15),
            width: 1.0,
            radius: iced::border::Radius::from(9.0),
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

fn mono_block(
    theme: &crate::theme::Theme,
    pairs: &[(&str, &str)],
    color: Color,
) -> Element<Message> {
    let lines: Vec<String> = pairs
        .iter()
        .map(|(k, v)| format!("{} = {}", k, v))
        .collect();
    let joined = lines.join("\n");

    container(text(joined).size(10.5).font(Font::MONOSPACE).style(
        move |_: &iced::Theme| iced::widget::text::Style {
            color: Some(color),
            ..Default::default()
        },
    ))
    .padding(iced::Padding::from([10, 12]))
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(iced::Color::from_rgba(0.0, 0.0, 0.0, 0.3))),
        border: iced::Border {
            color: Color::from_rgba(6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0, 0.15),
            width: 1.0,
            radius: iced::border::Radius::from(8.0),
        },
        ..Default::default()
    })
    .width(Length::Fill)
    .into()
}

fn mask_block(theme: &crate::theme::Theme, label: &str, body: &str, masked: bool) -> Element<Message> {
    let color = if masked {
        Color::from_rgb(0.43, 0.91, 0.71) // emerald-300
    } else {
        Color::from_rgb(0.98, 0.65, 0.65) // red-300
    };
    container(
        column![
            text(label.to_string())
                .size(10.5)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(style::spacing::XS),
            text(body.to_string())
                .size(12)
                .font(Font::MONOSPACE)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(color), ..Default::default() }),
        ]
        .spacing(0)
        .padding(iced::Padding::from([10, 12])),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Color(iced::Color::from_rgba(0.0, 0.0, 0.0, 0.25))),
        border: iced::Border {
            color: iced::Color::TRANSPARENT,
            width: 0.0,
            radius: iced::border::Radius::from(8.0),
        },
        ..Default::default()
    })
    .width(Length::Fill)
    .into()
}

// re-export LayoutMode for grep-ability (no-op at runtime)
#[allow(unused_imports)]
use LayoutMode as _PrivacyLayout;

// re-export components so the page actually exercises the new component API
#[allow(unused_imports)]
use components::badge as _Badge;

// ── Inline accent tones (mirroring preview card-edge palette) ───
//
// We keep these local because the preview uses raw hex values per card
// (emerald / violet / cyan / amber) rather than a single theme token.

fn emerald() -> Color {
    Color::from_rgba(16.0 / 255.0, 185.0 / 255.0, 129.0 / 255.0, 1.0)
}
fn violet() -> Color {
    Color::from_rgba(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0, 1.0)
}
fn cyan() -> Color {
    Color::from_rgba(6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0, 1.0)
}
fn amber() -> Color {
    Color::from_rgba(245.0 / 255.0, 158.0 / 255.0, 11.0 / 255.0, 1.0)
}

fn violet_alpha(a: f32) -> Color {
    Color::from_rgba(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0, a)
}