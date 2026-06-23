//! Settings page — theme, AI behavior, providers.

use iced::widget::{column, container, pick_list, row, scrollable, slider, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::models::{ProviderKind, ThemeMode};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let header = widgets::page_header(theme, "设置", "应用偏好与 AI 行为配置");

    let mut items: Vec<Element<Message>> = Vec::new();

    // Appearance
    items.push(widgets::section_title(theme, "外观").into());
    let theme_row = row![
        text("主题模式")
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
        iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        iced::widget::button(
            text(if app.settings.theme == ThemeMode::Dark { "🌙 深色 (当前)" } else { "🌙 深色" })
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| {
            if app.settings.theme == ThemeMode::Dark {
                style::primary_button(theme, status)
            } else {
                style::secondary_button(theme, status)
            }
        })
        .padding([8.0, 12.0])
        .on_press(Message::SettingsThemeChanged(ThemeMode::Dark)),
        iced::widget::button(
            text(if app.settings.theme == ThemeMode::Light { "☀ 浅色 (当前)" } else { "☀ 浅色" })
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| {
            if app.settings.theme == ThemeMode::Light {
                style::primary_button(theme, status)
            } else {
                style::secondary_button(theme, status)
            }
        })
        .padding([8.0, 12.0])
        .on_press(Message::SettingsThemeChanged(ThemeMode::Light)),
    ]
    .spacing(8)
    .align_y(Alignment::Center);
    items.push(
        container(theme_row)
            .style(move |_: &iced::Theme| style::card_flat(theme))
            .padding(Padding::from(14.0))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    // AI behavior
    items.push(widgets::section_title(theme, "AI 行为").into());

    // Temperature
    let temp_row = row![
        text(format!("温度: {:.1}", app.settings.temperature))
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .width(Length::Fixed(100.0)),
        slider(0.0..=2.0, app.settings.temperature, |v| {
            Message::SettingsTemperatureChanged(v)
        })
        .step(0.1),
    ]
    .spacing(12)
    .align_y(Alignment::Center);
    items.push(
        container(temp_row)
            .style(move |_: &iced::Theme| style::card_flat(theme))
            .padding(Padding::from(14.0))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    // Max iterations
    let iter_row = row![
        text(format!("最大工具迭代: {}", app.settings.max_tool_iterations))
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .width(Length::Fixed(160.0)),
        slider(1..=20, app.settings.max_tool_iterations, |v| {
            Message::SettingsMaxIterChanged(v)
        }),
    ]
    .spacing(12)
    .align_y(Alignment::Center);
    items.push(
        container(iter_row)
            .style(move |_: &iced::Theme| style::card_flat(theme))
            .padding(Padding::from(14.0))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    // Active provider
    let providers = app.providers.read().clone();
    let provider_ids: Vec<String> = providers.iter().map(|p| p.name.clone()).collect();
    let active_name = app
        .settings
        .active_provider_id
        .as_ref()
        .and_then(|id| providers.iter().find(|p| &p.id == id).map(|p| p.name.clone()))
        .unwrap_or_default();
    let provider_row = row![
        text("当前提供商")
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
        iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        pick_list(
            provider_ids.clone(),
            if active_name.is_empty() { None } else { Some(active_name) },
            move |name| {
                let id = providers
                    .iter()
                    .find(|p| p.name == name)
                    .map(|p| p.id.clone())
                    .unwrap_or(name);
                Message::SettingsActiveProviderChanged(id)
            },
        )
        .font(CJK_FONT)
        .text_size(13)
        .padding([8.0, 10.0])
        .style(move |_, status| style::pick_list_style(theme, status)),
    ]
    .spacing(12)
    .align_y(Alignment::Center);
    items.push(
        container(provider_row)
            .style(move |_: &iced::Theme| style::card_flat(theme))
            .padding(Padding::from(14.0))
            .width(Length::Fill)
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    // Save button
    items.push(widgets::primary_button(theme, "💾 保存设置", Message::SaveSettings));

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
