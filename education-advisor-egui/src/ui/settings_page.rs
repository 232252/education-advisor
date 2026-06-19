//! Settings page: LLM providers, privacy, theme, about.

use eframe::egui::{self, Align, FontId, Layout, Ui, Vec2};

use crate::app::App;
use crate::models::{ThemeMode, LlmProvider, ProviderKind};
use crate::ui::widgets::{card, ghost_button, primary_button, section_title};

pub fn show(app: &mut App, ui: &mut Ui) {
    section_title(ui, &app.theme, "设置");

    let theme = app.theme.clone();
    egui::ScrollArea::vertical().show(ui, |ui| {
        // appearance
        card(ui, &theme, |ui| {
            section_title(ui, &app.theme, "外观");
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("主题").font(FontId::proportional(13.0)).color(app.theme.text_dim));
                let mut mode = app.settings.theme;
                egui::ComboBox::from_id_source("theme_combo")
                    .selected_text(match mode {
                        ThemeMode::Dark => "深色",
                        ThemeMode::Light => "浅色",
                    })
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut mode, ThemeMode::Dark, "深色");
                        ui.selectable_value(&mut mode, ThemeMode::Light, "浅色");
                    });
                if mode != app.settings.theme {
                    app.settings.theme = mode;
                    app.theme = match mode {
                        ThemeMode::Dark => crate::theme::Theme::dark(),
                        ThemeMode::Light => crate::theme::Theme::light(),
                    };
                    app.apply_theme(ui.ctx());
                }
            });
            ui.horizontal(|ui| {
                ui.label(egui::RichText::new("侧边栏").font(FontId::proportional(13.0)).color(app.theme.text_dim));
                if ui.checkbox(&mut app.sidebar_collapsed, "折叠").changed() {
                    app.settings.sidebar_collapsed = app.sidebar_collapsed;
                }
            });
        });

        ui.add_space(8.0);

        // privacy
        card(ui, &app.theme, |ui| {
            section_title(ui, &app.theme, "隐私与安全");
            ui.checkbox(&mut app.settings.privacy_enabled, "启用 PII 脱敏（发送前）");
            ui.label(
                egui::RichText::new("• 敏感字段（监护人电话、API Key）使用 AES-256-GCM 加密落盘")
                    .font(FontId::proportional(11.0))
                    .color(app.theme.text_dim),
            );
            ui.label(
                egui::RichText::new("• 手机号 / 身份证 / 邮箱在进入 LLM 前自动掩码")
                    .font(FontId::proportional(11.0))
                    .color(app.theme.text_dim),
            );
        });

        ui.add_space(8.0);

        // providers
        card(ui, &app.theme, |ui| {
            ui.horizontal(|ui| {
                section_title(ui, &app.theme, "LLM 提供商");
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if primary_button(ui, &app.theme, "新增") {
                        app.ui_state.editing_provider = Some(LlmProvider {
                            id: uuid::Uuid::new_v4().to_string(),
                            name: String::new(),
                            kind: ProviderKind::OpenAi,
                            base_url: "https://api.openai.com".into(),
                            api_key: None,
                            model: "gpt-4o-mini".into(),
                            enabled: true,
                        });
                    }
                });
            });
            ui.separator();
            let providers = app.providers.read().clone();
            if providers.is_empty() {
                ui.label(
                    egui::RichText::new("尚未配置提供商。支持 OpenAI / Anthropic / Gemini / OpenRouter / Ollama / 自定义（OpenAI 兼容）。")
                        .font(FontId::proportional(12.0))
                        .color(app.theme.text_faint),
                );
            }
            for p in &providers {
                ui.horizontal(|ui| {
                    let dot = if p.enabled { app.theme.success } else { app.theme.text_faint };
                    let (r, _) = ui.allocate_exact_size(Vec2::new(8.0, 8.0), egui::Sense::hover());
                    ui.painter().circle_filled(r.center(), 4.0, dot);
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new(&p.name).font(FontId::proportional(13.0)).color(app.theme.text));
                        ui.label(
                            egui::RichText::new(format!("{:?} · {} · {}", p.kind, p.model, p.base_url))
                                .font(FontId::proportional(10.0))
                                .color(app.theme.text_faint),
                        );
                    });
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ghost_button(ui, &app.theme, "编辑") {
                            app.ui_state.editing_provider = Some(p.clone());
                        }
                        if ghost_button(ui, &app.theme, "删除") {
                            let _ = app.runtime.tx.send(crate::runtime::Command::DeleteProvider(p.id.clone()));
                        }
                    });
                });
                ui.separator();
            }
        });

        ui.add_space(8.0);

        // about
        card(ui, &app.theme, |ui| {
            section_title(ui, &app.theme, "关于");
            ui.label(egui::RichText::new("Education Advisor v1.0").font(FontId::proportional(13.0)).color(app.theme.text));
            ui.label(
                egui::RichText::new("纯 Rust + egui 商业级教育管理桌面应用 · 18 AI 代理 · AES-256-GCM 隐私引擎")
                    .font(FontId::proportional(11.0))
                    .color(app.theme.text_dim),
            );
            ui.label(
                egui::RichText::new(format!("数据目录: {}", data_dir_display()))
                    .font(FontId::proportional(10.0))
                    .color(app.theme.text_faint),
            );
        });
    });

    if app.ui_state.editing_provider.is_some() {
        provider_dialog(app, ui);
    }
}

fn provider_dialog(app: &mut App, ui: &mut Ui) {
    let mut open = true;
    let mut to_save: Option<LlmProvider> = None;
    egui::Window::new("编辑提供商")
        .open(&mut open)
        .resizable(false)
        .show(ui.ctx(), |ui| {
            let p = app.ui_state.editing_provider.as_mut().unwrap();
            egui::Grid::new("prov_grid").num_columns(2).spacing(Vec2::new(8.0, 6.0)).show(ui, |ui| {
                ui.label("名称");
                ui.text_edit_singleline(&mut p.name);
                ui.end_row();
                ui.label("类型");
                let mut kind = p.kind;
                egui::ComboBox::from_id_source("prov_kind")
                    .selected_text(format!("{kind:?}"))
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut kind, ProviderKind::OpenAi, "OpenAI");
                        ui.selectable_value(&mut kind, ProviderKind::Anthropic, "Anthropic");
                        ui.selectable_value(&mut kind, ProviderKind::Gemini, "Gemini");
                        ui.selectable_value(&mut kind, ProviderKind::OpenRouter, "OpenRouter");
                        ui.selectable_value(&mut kind, ProviderKind::Ollama, "Ollama");
                        ui.selectable_value(&mut kind, ProviderKind::Custom, "自定义");
                    });
                p.kind = kind;
                ui.end_row();
                ui.label("Base URL");
                ui.text_edit_singleline(&mut p.base_url);
                ui.end_row();
                ui.label("模型");
                ui.text_edit_singleline(&mut p.model);
                ui.end_row();
                ui.label("API Key");
                let mut key = p.api_key.clone().unwrap_or_default();
                ui.add(egui::TextEdit::singleline(&mut key).password(true));
                p.api_key = if key.is_empty() { None } else { Some(key) };
                ui.end_row();
                ui.label("启用");
                ui.checkbox(&mut p.enabled, "");
                ui.end_row();
            });
            ui.horizontal(|ui| {
                if primary_button(ui, &app.theme, "保存") {
                    to_save = Some(app.ui_state.editing_provider.take().unwrap());
                }
                if ghost_button(ui, &app.theme, "取消") {
                    app.ui_state.editing_provider = None;
                }
            });
        });
    if let Some(p) = to_save {
        let _ = app.runtime.tx.send(crate::runtime::Command::SaveProvider(p));
    }
    if !open {
        app.ui_state.editing_provider = None;
    }
}

fn data_dir_display() -> String {
    dirs::data_dir().map_or_else(|| ".".into(), |d| d.join("education-advisor").display().to_string())
}
