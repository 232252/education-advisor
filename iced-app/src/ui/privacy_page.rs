//! Privacy page — PII Shield, encryption, data management.

use iced::widget::{column, container, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let header = widgets::page_header(theme, "隐私", "PII Shield 假名化引擎与数据加密管理");

    let mut items: Vec<Element<Message>> = Vec::new();

    // PII Shield status
    let pii = app.pii.lock();
    let pii_enabled = pii.enabled;
    let pii_count = pii.mapping_count();
    drop(pii);

    let pii_card = column![
        row![
            text("🛡️").size(36),
            column![
                text("PII Shield 假名化引擎")
                    .font(Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(18)
                    .style(move |_: &iced::Theme| style::text_primary(theme)),
                text(if pii_enabled {
                    format!("已启用 · {} 条映射", pii_count)
                } else {
                    "未启用 — AI 将看到真实姓名".to_string()
                })
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(if pii_enabled { theme.success } else { theme.warning }),
                }),
            ]
            .spacing(4),
        ]
        .spacing(14)
        .align_y(Alignment::Center),
        iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)),
        text("PII Shield 将真实姓名替换为 S_001 / P_001 等假名，AI 永远看不到明文。映射文件使用 AES-256-GCM 加密，密钥由您的密码派生。")
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    ]
    .spacing(0)
    .width(Length::Fill);
    items.push(widgets::card(theme, pii_card));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // PII Shield action buttons
    let pii_actions = row![
        iced::widget::button(
            text("🔑 初始化 / 解锁")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::grad_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::PiiOpenUnlock),
        iced::widget::button(
            text("📋 查看映射")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::PiiOpenMappings),
        iced::widget::button(
            text("🔒 锁定")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| style::ghost_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::PiiLock),
    ]
    .spacing(10);
    items.push(
        container(pii_actions)
            .style(move |_: &iced::Theme| style::card_flat(theme))
            .padding(Padding::from(14.0))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // Privacy features
    items.push(widgets::section_title(theme, "隐私功能").into());

    let features = vec![
        ("🔐", "AES-256-GCM 加密", "监护人联系方式和 API 密钥在 SQLite 中加密存储", theme.success),
        ("🎭", "定向发送过滤器", "发送消息给特定家长时，其他学生姓名替换为「其他同学」", theme.info),
        ("📝", "正则 PII 脱敏", "手机号 / 身份证 / 邮箱在每次出站提示中自动掩码", theme.warning),
        ("🔑", "随机盐派生", "每次安装生成随机盐，防止数据库复制后重用密码", theme.purple),
    ];

    for (icon, title, desc, accent) in features {
        items.push(widgets::feature_card(theme, icon, title, desc, accent));
        items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
    }

    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // Data management
    items.push(widgets::section_title(theme, "数据管理").into());

    let backup_row = row![
        iced::widget::button(
            text("📤 导出备份")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::grad_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::ExportBackup),
        iced::widget::button(
            text("📥 导入备份")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::ImportBackup),
    ]
    .spacing(8);
    items.push(
        container(backup_row)
            .style(move |_: &iced::Theme| style::card_flat(theme))
            .padding(Padding::from(14.0))
            .width(Length::Fill)
            .into(),
    );

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
