//! PII Shield dialogs (iced port).
//!
//! The Privacy page exposes two entry points into the PII Shield engine:
//!
//! 1. "初始化 / 解锁" — open [`PiiDialogState::open_unlock`] which lets the
//!    user either initialize a brand-new engine with a fresh password, or
//!    unlock an existing encrypted mapping file with the password it was
//!    created with.
//! 2. "查看映射" — open [`PiiDialogState::open_mappings`] which lists every
//!    `(entity_type, alias, real_name)` triple currently in memory.
//!
//! Both dialogs read/write through `App::pii`, which holds the shared
//! `parking_lot::Mutex<PrivacyEngine>`.

#![allow(dead_code)]

use iced::widget::{button, column, container, row, scrollable, text, text_input, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::theme::Theme;
use crate::ui::style;

/// State for the two PII Shield dialogs.
#[derive(Default)]
pub struct PiiDialogState {
    pub show_unlock: bool,
    pub show_mappings: bool,
    /// Password input for initialize / unlock.
    pub password: String,
    /// Path to the data dir the user is initializing. Defaults to
    /// `dirs::data_dir()/education-advisor` and is filled in lazily.
    pub data_dir: Option<std::path::PathBuf>,
    pub last_error: Option<String>,
    pub last_info: Option<String>,
}

impl PiiDialogState {
    pub fn open_unlock(&mut self) {
        self.show_unlock = true;
        self.password.clear();
        self.last_error = None;
        self.last_info = None;
    }
    pub fn open_mappings(&mut self) {
        self.show_mappings = true;
    }
    pub fn close(&mut self) {
        self.show_unlock = false;
        self.show_mappings = false;
    }
}

fn data_dir_default() -> std::path::PathBuf {
    let mut p = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    p.push("education-advisor");
    p
}

/// Render the unlock / mappings overlay if either dialog is open.
/// Returns `None` when no dialog is visible so the caller can skip
/// the overlay entirely.
pub fn view<'a>(app: &'a App) -> Option<Element<'a, Message>> {
    if app.ui_state.pii_dialog.show_unlock {
        Some(unlock_dialog_view(app))
    } else if app.ui_state.pii_dialog.show_mappings {
        Some(mappings_view(app))
    } else {
        None
    }
}

fn unlock_dialog_view<'a>(app: &'a App) -> Element<'a, Message> {
    let theme = &app.theme;
    let cached_dir = app
        .ui_state
        .pii_dialog
        .data_dir
        .clone()
        .unwrap_or_else(data_dir_default);
    let pii_exists = cached_dir.join("privacy").join("mapping.enc").exists();

    let header_text = if pii_exists {
        "检测到已存在的加密映射表：输入密码解锁。"
    } else {
        "首次使用：设置一个密码以创建加密映射表（密码丢失不可恢复）。"
    };

    let mut col: Vec<Element<Message>> = Vec::new();

    col.push(
        text("PII Shield 初始化 / 解锁")
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(18)
            .style(move |_: &iced::Theme| style::text_primary(theme))
            .into(),
    );
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
    col.push(
        text(header_text)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .into(),
    );
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // data dir row
    col.push(
        row![
            text("数据目录")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
            text(cached_dir.display().to_string())
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_primary(theme)),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
        .into(),
    );
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    // password input
    col.push(
        text("密码")
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .into(),
    );
    col.push(
        text_input("输入密码", &app.ui_state.pii_dialog.password)
            .secure(true)
            .on_input(|s| Message::PiiPasswordChanged(s))
            .font(CJK_FONT)
            .size(14)
            .padding([10.0, 12.0])
            .style(move |_, status| style::text_input_style(theme, status))
            .into(),
    );
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    if let Some(err) = &app.ui_state.pii_dialog.last_error {
        col.push(
            text(format!("❌ {err}"))
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(theme.danger),
                })
                .into(),
        );
    }
    if let Some(info) = &app.ui_state.pii_dialog.last_info {
        col.push(
            text(format!("✓ {info}"))
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(theme.success),
                })
                .into(),
        );
    }

    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    let action_label = if pii_exists { "解锁" } else { "初始化" };
    let action_msg = if pii_exists {
        Message::PiiUnlock(app.ui_state.pii_dialog.password.clone())
    } else {
        Message::PiiInit(app.ui_state.pii_dialog.password.clone())
    };

    let buttons = row![
        button(
            text(action_label)
                .font(CJK_FONT)
                .size(13)
                .align_x(iced::alignment::Horizontal::Center)
                .align_y(iced::alignment::Vertical::Center),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([10.0, 16.0])
        .on_press(action_msg),
        button(
            text("取消")
                .font(CJK_FONT)
                .size(13)
                .align_x(iced::alignment::Horizontal::Center)
                .align_y(iced::alignment::Vertical::Center),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([10.0, 16.0])
        .on_press(Message::PiiDialogClose),
    ]
    .spacing(8);
    col.push(buttons.into());

    let content = column(col).spacing(0).width(Length::Fill);

    container(content)
        .style(move |_: &iced::Theme| style::elevated(theme))
        .padding(Padding::from(24.0))
        .width(Length::Fixed(440.0))
        .into()
}

fn mappings_view(app: &App) -> Element<'_, Message> {
    let theme = &app.theme;
    let pii = app.pii.lock();
    let entries = pii.list_mappings();
    let enabled = pii.enabled;
    let count = pii.mapping_count();
    drop(pii);

    let mut col: Vec<Element<Message>> = Vec::new();

    col.push(
        text("PII Shield 映射表")
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(18)
            .style(move |_: &iced::Theme| style::text_primary(theme))
            .into(),
    );
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    let status_color = if enabled { theme.success } else { theme.warning };
    let status_text = if enabled { "● 引擎已启用" } else { "○ 引擎未启用" };

    col.push(
        row![
            text(status_text)
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(status_color),
                }),
            Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
            text(format!("共 {count} 条"))
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .align_y(Alignment::Center)
        .into(),
    );
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // header row
    col.push(
        row![
            text("类型")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_dim(theme))
                .width(Length::Fixed(80.0)),
            text("化名")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_dim(theme))
                .width(Length::Fixed(100.0)),
            text("真名")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(12)
        .into(),
    );
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)).into());

    let mut rows: Vec<Element<Message>> = Vec::new();
    for e in &entries {
        rows.push(
            row![
                text(e.entity_type.clone())
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme))
                    .width(Length::Fixed(80.0)),
                text(e.alias.clone())
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_accent(theme))
                    .width(Length::Fixed(100.0)),
                text(e.real_name.clone())
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_primary(theme)),
            ]
            .spacing(12)
            .into(),
        );
    }

    let list = scrollable(column(rows).spacing(4).width(Length::Fill))
        .height(Length::Fixed(320.0))
        .style(move |_, _| style::scrollable(theme));

    col.push(list.into());
    col.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    col.push(
        button(
            text("关闭")
                .font(CJK_FONT)
                .size(13)
                .align_x(iced::alignment::Horizontal::Center)
                .align_y(iced::alignment::Vertical::Center),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([10.0, 16.0])
        .on_press(Message::PiiDialogClose)
        .into(),
    );

    let content = column(col).spacing(0).width(Length::Fill);

    container(content)
        .style(move |_: &iced::Theme| style::elevated(theme))
        .padding(Padding::from(24.0))
        .width(Length::Fixed(520.0))
        .into()
}
