//! Models page: provider presets, active model status, and quick provider edits.

use eframe::egui::{self, Align, FontId, Layout, Ui};

use crate::app::App;
use crate::models::{LlmProvider, ProviderKind};
use crate::ui::widgets::{card, empty_state, ghost_button, primary_button, section_title};

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    section_title(ui, &theme, "模型管理");

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("管理 LLM 提供商与模型预设")
                .font(FontId::proportional(12.0))
                .color(theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if primary_button(ui, &theme, "新增提供商").clicked() {
                app.ui_state.editing_provider = Some(LlmProvider {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: String::new(),
                    kind: ProviderKind::OpenAi,
                    base_url: "https://api.openai.com".into(),
                    api_key: None,
                    model: "gpt-4o-mini".into(),
                    enabled: true,
                });
                app.navigate(crate::app::Page::Settings);
            }
        });
    });

    ui.add_space(8.0);

    // Active model card
    let providers = app.providers.read().clone();
    let active = app
        .settings
        .active_provider_id
        .as_ref()
        .and_then(|id| providers.iter().find(|p| p.id == *id).cloned());

    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("当前活跃模型")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        if let Some(p) = active {
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new("●")
                        .font(FontId::proportional(14.0))
                        .color(theme.success),
                );
                ui.vertical(|ui| {
                    ui.label(
                        egui::RichText::new(&p.name)
                            .font(FontId::proportional(15.0))
                            .strong()
                            .color(theme.text),
                    );
                    ui.label(
                        egui::RichText::new(format!("{:?} · {}", p.kind, p.model))
                            .font(FontId::proportional(11.0))
                            .color(theme.text_dim),
                    );
                });
            });
        } else {
            empty_state(ui, &theme, "🧠", "未设置活跃模型，请在设置中配置");
        }
    });

    ui.add_space(8.0);

    // Provider list
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("已配置提供商")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.separator();
        if providers.is_empty() {
            empty_state(ui, &theme, "📭", "暂无提供商");
        }
        for p in &providers {
            ui.horizontal(|ui| {
                let dot = if p.enabled { theme.success } else { theme.text_faint };
                ui.label(
                    egui::RichText::new("●")
                        .font(FontId::proportional(10.0))
                        .color(dot),
                );
                ui.vertical(|ui| {
                    ui.label(
                        egui::RichText::new(&p.name)
                            .font(FontId::proportional(13.0))
                            .strong()
                            .color(theme.text),
                    );
                    ui.label(
                        egui::RichText::new(format!("{} · {}", p.model, p.base_url))
                            .font(FontId::proportional(10.0))
                            .color(theme.text_faint),
                    );
                });
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let is_active = app.settings.active_provider_id.as_ref() == Some(&p.id);
                    if is_active {
                        ui.label(
                            egui::RichText::new("使用中")
                                .font(FontId::proportional(11.0))
                                .color(theme.accent),
                        );
                    } else if p.enabled && ghost_button(ui, &theme, "设为活跃").clicked() {
                        app.settings.active_provider_id = Some(p.id.clone());
                        let _ = app.runtime.tx.send(crate::runtime::Command::SaveSettings(app.settings.clone()));
                    }
                });
            });
            ui.separator();
        }
    });

    ui.add_space(8.0);

    // Preset quick reference
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("内置模型预设")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.separator();
        egui::ScrollArea::vertical().max_height(240.0).show(ui, |ui| {
            let presets = crate::llm::provider_presets();
            for pr in presets.iter().take(20) {
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new(&pr.name)
                            .font(FontId::proportional(12.0))
                            .color(theme.text),
                    );
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if ghost_button(ui, &theme, "添加").clicked() {
                            app.ui_state.editing_provider = Some(LlmProvider {
                                id: uuid::Uuid::new_v4().to_string(),
                                name: pr.name.clone(),
                                kind: pr.kind,
                                base_url: pr.base_url.clone(),
                                api_key: None,
                                model: pr.model.clone(),
                                enabled: true,
                            });
                            app.navigate(crate::app::Page::Settings);
                        }
                    });
                });
                ui.separator();
            }
        });
    });
}
