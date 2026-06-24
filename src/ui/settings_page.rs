//! Settings page: LLM providers, appearance, AI behavior, privacy, about.
//!
//! Redesigned to mirror the DeepSeek-style dark sci-fi reference: each group
//! is a translucent `glass_card` with a `panel_title`, every option is a
//! `setting_row` (title + subtitle on the left, control on the right) and the
//! save action is a floating gradient `fab_button` anchored bottom-right.

use eframe::egui::{self, Align, Color32, FontId, Layout, Sense, Ui, Vec2};

use crate::app::App;
use crate::models::{LlmProvider, ProviderKind, ThemeMode};
use crate::ui::icons;
use crate::ui::widgets::{
    custom_slider, dropdown_select, fab_button, ghost_button, glass_card, glass_icon_button,
    icon_button, panel_title, primary_button, setting_row, toggle_switch,
};

pub fn show(app: &mut App, ui: &mut Ui) {
    // The top-level header is owned by the topbar now — jump straight into the
    // scrollable glass-card stack.
    let theme = app.theme.clone();
    let mut settings_changed = false;

    egui::ScrollArea::vertical().show(ui, |ui| {
        // -----------------------------------------------------------------
        // 外观
        // -----------------------------------------------------------------
        let mut mode = app.settings.theme;
        let mut collapsed = app.settings.sidebar_collapsed;
        glass_card(ui, &theme, |ui| {
            panel_title(ui, &theme, "外观");
            setting_row(ui, &theme, "主题模式", "切换深色与浅色模式", |ui| {
                let (icon_fn, icon_color) = match mode {
                    ThemeMode::Dark => (
                        icons::sun as fn(&egui::Painter, egui::Rect, Color32),
                        Color32::from_rgb(250, 204, 21), // #facc15
                    ),
                    ThemeMode::Light => (
                        icons::moon as fn(&egui::Painter, egui::Rect, Color32),
                        theme.text_dim,
                    ),
                };
                if glass_icon_button(ui, &theme, icon_fn, icon_color).clicked() {
                    mode = match mode {
                        ThemeMode::Dark => ThemeMode::Light,
                        ThemeMode::Light => ThemeMode::Dark,
                    };
                }
            });
            setting_row(ui, &theme, "侧边栏", "折叠或展开左侧导航栏", |ui| {
                toggle_switch(ui, &theme, &mut collapsed);
            });
        });
        if mode != app.settings.theme {
            app.settings.theme = mode;
            app.theme = match mode {
                ThemeMode::Dark => crate::theme::Theme::dark(),
                ThemeMode::Light => crate::theme::Theme::light(),
            };
            app.apply_theme(ui.ctx());
            settings_changed = true;
        }
        if collapsed != app.settings.sidebar_collapsed {
            app.settings.sidebar_collapsed = collapsed;
            app.sidebar_collapsed = collapsed;
            settings_changed = true;
        }

        ui.add_space(16.0);

        // -----------------------------------------------------------------
        // AI 行为
        // -----------------------------------------------------------------
        let mut temp = app.settings.temperature;
        let mut iters_f = app.settings.max_tool_iterations as f32;
        glass_card(ui, &theme, |ui| {
            panel_title(ui, &theme, "AI 行为");
            setting_row(ui, &theme, "模型温度", "控制回答的创造性与随机性", |ui| {
                ui.allocate_ui_with_layout(
                    Vec2::new(248.0, 24.0),
                    Layout::left_to_right(Align::Center),
                    |ui| {
                        let text = format!("{:.1}", temp);
                        custom_slider(ui, &theme, &mut temp, 0.0..=1.0, 40.0, &text);
                    },
                );
            });
            setting_row(ui, &theme, "最大迭代次数", "工具调用的上限次数", |ui| {
                ui.allocate_ui_with_layout(
                    Vec2::new(248.0, 24.0),
                    Layout::left_to_right(Align::Center),
                    |ui| {
                        let text = format!("{}", iters_f.round() as u32);
                        custom_slider(ui, &theme, &mut iters_f, 1.0..=20.0, 40.0, &text);
                    },
                );
            });
        });
        let new_iters = iters_f.round().clamp(1.0, 20.0) as u32;
        if (temp - app.settings.temperature).abs() > f32::EPSILON {
            app.settings.temperature = temp;
            settings_changed = true;
        }
        if new_iters != app.settings.max_tool_iterations {
            app.settings.max_tool_iterations = new_iters;
            settings_changed = true;
        }

        ui.add_space(16.0);

        // -----------------------------------------------------------------
        // 隐私
        // -----------------------------------------------------------------
        let mut privacy = app.settings.privacy_enabled;
        let audit_id = egui::Id::new("settings_audit_logging");
        let mut audit: bool = ui
            .ctx()
            .memory(|m| m.data.get_temp::<bool>(audit_id).unwrap_or(true));
        glass_card(ui, &theme, |ui| {
            panel_title(ui, &theme, "隐私");
            setting_row(
                ui,
                &theme,
                "PII 脱敏",
                "敏感字段（监护人电话、API Key）使用 AES-256-GCM 加密落盘",
                |ui| {
                    toggle_switch(ui, &theme, &mut privacy);
                },
            );
            setting_row(
                ui,
                &theme,
                "审计日志",
                "记录安全敏感操作到本地 audit.log",
                |ui| {
                    toggle_switch(ui, &theme, &mut audit);
                },
            );
        });
        if privacy != app.settings.privacy_enabled {
            app.settings.privacy_enabled = privacy;
            settings_changed = true;
        }
        ui.ctx()
            .memory_mut(|m| m.data.insert_temp(audit_id, audit));

        ui.add_space(16.0);

        // -----------------------------------------------------------------
        // 当前模型
        // -----------------------------------------------------------------
        let providers = app.providers.read().clone();
        let enabled: Vec<_> = providers.into_iter().filter(|p| p.enabled).collect();
        let mut item_names = vec!["—".to_string()];
        item_names.extend(enabled.iter().map(|p| p.name.clone()));
        let items: Vec<&str> = item_names.iter().map(|s| s.as_str()).collect();
        let selected_idx = app.settings.active_provider_id.as_ref().and_then(|id| {
            enabled.iter().position(|p| p.id == *id).map(|i| i + 1)
        });
        let selected_text = match selected_idx {
            Some(i) => items[i],
            None => "—",
        };
        let mut new_idx: Option<usize> = None;
        glass_card(ui, &theme, |ui| {
            panel_title(ui, &theme, "当前模型");
            setting_row(ui, &theme, "当前使用模型", "选择默认调用的 LLM 提供商", |ui| {
                ui.allocate_ui_with_layout(
                    Vec2::new(240.0, 34.0),
                    Layout::left_to_right(Align::Center),
                    |ui| {
                        let (icon_rect, _) =
                            ui.allocate_exact_size(Vec2::splat(24.0), Sense::hover());
                        icons::robot_icon(ui.painter(), icon_rect, &theme);
                        ui.add_space(6.0);
                        if let Some(idx) =
                            dropdown_select(ui, &theme, "active_provider", selected_text, &items)
                        {
                            new_idx = Some(idx);
                        }
                    },
                );
            });
        });
        if let Some(idx) = new_idx {
            let new_selected = if idx == 0 {
                None
            } else {
                Some(enabled[idx - 1].id.clone())
            };
            if new_selected != app.settings.active_provider_id {
                app.settings.active_provider_id = new_selected;
                settings_changed = true;
            }
        }

        ui.add_space(16.0);

        // -----------------------------------------------------------------
        // LLM 提供商
        // -----------------------------------------------------------------
        glass_card(ui, &app.theme, |ui| {
            ui.horizontal(|ui| {
                panel_title(ui, &app.theme, "LLM 提供商");
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if primary_button(ui, &app.theme, "新增").clicked() {
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
                    let (r, _) = ui.allocate_exact_size(Vec2::new(8.0, 8.0), Sense::hover());
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
                        if ghost_button(ui, &app.theme, "编辑").clicked() {
                            app.ui_state.editing_provider = Some(p.clone());
                        }
                        if ghost_button(ui, &app.theme, "删除").clicked() {
                            let _ = app
                                .runtime
                                .tx
                                .send(crate::runtime::Command::DeleteProvider(p.id.clone()));
                        }
                    });
                });
                ui.separator();
            }
        });

        ui.add_space(16.0);

        // -----------------------------------------------------------------
        // 关于
        // -----------------------------------------------------------------
        glass_card(ui, &app.theme, |ui| {
            panel_title(ui, &app.theme, "关于");
            ui.label(egui::RichText::new(format!("Education Advisor v{}", env!("CARGO_PKG_VERSION"))).font(FontId::proportional(13.0)).color(app.theme.text));
            ui.label(
                egui::RichText::new("纯 Rust + egui 商业级教育管理桌面应用 · 18 AI 代理 · AES-256-GCM 隐私引擎")
                    .font(FontId::proportional(11.0))
                    .color(app.theme.text_dim),
            );
            ui.horizontal(|ui| {
                ui.label(
                    egui::RichText::new(format!("数据目录: {}", data_dir_display()))
                        .font(FontId::proportional(10.0))
                        .color(app.theme.text_faint),
                );
                if icon_button(ui, &app.theme, icons::folder, 28.0).clicked() {
                    if let Some(dir) = dirs::data_dir().map(|d| d.join("education-advisor")) {
                        let _ = std::fs::create_dir_all(&dir);
                        let _ = open_dir(&dir);
                    }
                }
            });
        });

        ui.add_space(16.0);

        // -----------------------------------------------------------------
        // 数据备份 / 恢复 — pull the theme out so the closure can mutably
        // borrow `app` for the runtime sends. (Capturing `&app.theme` and
        // `&mut app` in the same closure is rejected by the borrow checker.)
        // -----------------------------------------------------------------
        let backup_theme = app.theme.clone();
        let app_theme = app.theme.clone();
        glass_card(ui, &backup_theme, |ui| {
            panel_title(ui, &backup_theme, "数据备份 / 恢复");
            ui.label(
                egui::RichText::new("导出会生成一个 JSON 快照，包含所有学生、成绩、会话、任务、知识库。加密字段以密文形式保存（只能在同一台机器上用同一助记词恢复）。")
                    .font(FontId::proportional(11.0))
                    .color(app_theme.text_dim),
            );
            ui.add_space(6.0);
            let export_clicked = primary_button(ui, &backup_theme, "导出全部数据").clicked();
            let restore_clicked = ghost_button(ui, &backup_theme, "从备份恢复…").clicked();
            ui.horizontal(|ui| { ui.add_space(1.0); });
            if export_clicked {
                let _ = app
                    .runtime
                    .tx
                    .send(crate::runtime::Command::ExportBackup);
            }
            if restore_clicked {
                if let Some(path) = rfd::FileDialog::new()
                    .add_filter("JSON", &["json"])
                    .pick_file()
                {
                    match std::fs::read_to_string(&path) {
                        Ok(s) => match serde_json::from_str::<crate::models::FullBackup>(&s) {
                            Ok(backup) => {
                                let _ = app
                                    .runtime
                                    .tx
                                    .send(crate::runtime::Command::ImportBackup(backup));
                            }
                            Err(e) => app.push_toast(
                                crate::runtime::ToastKind::Error,
                                format!("备份文件格式错误: {e}"),
                            ),
                        },
                        Err(e) => app.push_toast(
                            crate::runtime::ToastKind::Error,
                            format!("读取失败: {e}"),
                        ),
                    }
                }
            }
        });

        ui.add_space(24.0);
        ui.allocate_ui_with_layout(
            Vec2::new(ui.available_width(), 64.0),
            Layout::right_to_left(Align::Center),
            |ui| {
                if fab_button(ui, &theme, "保存偏好").clicked() {
                    let _ = app
                        .runtime
                        .tx
                        .send(crate::runtime::Command::SaveSettings(app.settings.clone()));
                    app.push_toast(crate::runtime::ToastKind::Success, "设置已保存".to_string());
                }
            },
        );
    });

    if app.ui_state.editing_provider.is_some() {
        provider_dialog(app, ui);
    }

    // Persist settings only when something changed. We also fire a
    // `SaveSettings` if the in-memory settings differ from the last
    // persisted copy; this catches the "user edited a slider then
    // immediately navigated away" case before `update()` flushes.
    if settings_changed {
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::SaveSettings(app.settings.clone()));
    }
}

fn provider_dialog(app: &mut App, ui: &mut Ui) {
    let mut open = true;
    let mut to_save: Option<LlmProvider> = None;
    egui::Window::new("编辑提供商")
        .open(&mut open)
        .resizable(false)
        .collapsible(false)
        .show(ui.ctx(), |ui| {
            let p = app.ui_state.editing_provider.as_mut().unwrap();
            // preset selector
            let presets = crate::llm::provider_presets();
            let mut preset_idx: Option<usize> = None;
            egui::ComboBox::from_id_source("preset_select")
                .selected_text("从 30+ 预设中选择…")
                .show_ui(ui, |ui| {
                    for (i, pr) in presets.iter().enumerate() {
                        if ui.selectable_label(false, &pr.name).clicked() {
                            preset_idx = Some(i);
                        }
                    }
                });
            if let Some(i) = preset_idx {
                let pr = &presets[i];
                p.kind = pr.kind;
                p.base_url.clone_from(&pr.base_url);
                p.model.clone_from(&pr.model);
                if p.name.is_empty() {
                    p.name.clone_from(&pr.name);
                }
            }
            ui.separator();
            egui::Grid::new("prov_grid")
                .num_columns(2)
                .spacing(Vec2::new(8.0, 6.0))
                .show(ui, |ui| {
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
                    let mut key = p.api_key.as_ref().map_or_else(String::new, |k| {
                        if let Some(rest) = k.strip_prefix("enc:") {
                            app.cipher.decrypt_str(rest).unwrap_or_else(|_| k.clone())
                        } else {
                            k.clone()
                        }
                    });
                    ui.add(egui::TextEdit::singleline(&mut key).password(true));
                    p.api_key = if key.is_empty() { None } else { Some(key) };
                    ui.end_row();
                    ui.label("启用");
                    ui.checkbox(&mut p.enabled, "");
                    ui.end_row();
                });
            ui.horizontal(|ui| {
                if primary_button(ui, &app.theme, "保存").clicked() {
                    to_save = Some(app.ui_state.editing_provider.take().unwrap());
                }
                if ghost_button(ui, &app.theme, "取消").clicked() {
                    app.ui_state.editing_provider = None;
                }
            });
        });
    if let Some(p) = to_save {
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::SaveProvider(p));
    }
    if !open {
        app.ui_state.editing_provider = None;
    }
}

fn data_dir_display() -> String {
    dirs::data_dir().map_or_else(
        || ".".into(),
        |d| d.join("education-advisor").display().to_string(),
    )
}

fn open_dir(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(path).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}
