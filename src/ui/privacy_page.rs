//! Privacy page: encryption status, PII redaction controls, and audit log.

use eframe::egui::{self, Align, FontId, Layout, Pos2, Rect, Sense, Ui, Vec2};

use crate::app::App;
use crate::theme::Theme;
use crate::ui::icons;
use crate::ui::widgets::{ghost_button, glass_card, panel_title, primary_button};

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    panel_title(ui, &theme, "隐私与安全");

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("控制敏感数据如何存储与发送到 AI")
                .font(FontId::proportional(12.0))
                .color(theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if ghost_button(ui, &theme, "清除缓存").clicked() {
                app.push_toast(crate::runtime::ToastKind::Info, "缓存已清除");
            }
        });
    });

    ui.add_space(12.0);

    // Core security capabilities with colored left-border feature rows.
    glass_card(ui, &theme, |ui| {
        panel_title(ui, &theme, "核心安全能力");
        ui.add_space(4.0);

        feature_row(
            ui,
            &theme,
            theme.success,
            "AES-256-GCM 全盘加密",
            "监护人电话、API Key 等敏感字段在落盘前自动加密。",
        );
        ui.add_space(8.0);
        feature_row(
            ui,
            &theme,
            theme.info,
            "定向发送过滤器",
            "仅向 LLM 发送当前任务必需的最小数据集合，自动屏蔽非相关敏感字段。",
        );
        ui.add_space(8.0);
        feature_row(
            ui,
            &theme,
            theme.purple,
            "PII 自动脱敏",
            "手机号、身份证号、邮箱地址在发送给 LLM 前会被掩码。",
        );
    });

    ui.add_space(8.0);

    // PII redaction switch
    glass_card(ui, &theme, |ui| {
        panel_title(ui, &theme, "PII 脱敏");
        ui.horizontal(|ui| {
            if ui
                .checkbox(&mut app.settings.privacy_enabled, "发送前自动脱敏")
                .changed()
            {
                // The runtime keeps a copy of the settings; the next
                // turn's PII redaction will use the freshly toggled value
                // because the AI loop reads from `ctx.settings`.
                let _ = app
                    .runtime
                    .tx
                    .send(crate::runtime::Command::SaveSettings(app.settings.clone()));
            }
        });
        ui.label(
            egui::RichText::new("手机号、身份证号、邮箱地址在发送给 LLM 前会被掩码")
                .font(FontId::proportional(11.0))
                .color(theme.text_dim),
        );

        ui.add_space(8.0);
        ui.label(
            egui::RichText::new("脱敏预览")
                .font(FontId::proportional(12.0))
                .strong()
                .color(theme.text_dim),
        );
        let sample = "联系我 13800138000，身份证 110101199001011234，邮箱 lihua@example.com";
        let (redacted, count) = crate::privacy::Redactor::new().redact(sample);
        let mut preview = redacted;
        ui.add(egui::TextEdit::multiline(&mut preview).desired_rows(2));
        ui.label(
            egui::RichText::new(format!("已识别并脱敏 {count} 处"))
                .font(FontId::proportional(11.0))
                .color(theme.info),
        );
    });

    ui.add_space(8.0);

    // PII Shield 假名化引擎（v0.1.0-rc.1 核心隐私功能）
    glass_card(ui, &theme, |ui| {
        ui.horizontal(|ui| {
            let (icon_rect, _) = ui.allocate_exact_size(Vec2::splat(20.0), Sense::hover());
            icons::shield_icon(ui.painter(), icon_rect, &theme);
            ui.add_space(2.0);
            panel_title(ui, &theme, "PII Shield 假名化引擎");
        });
        ui.label(
            egui::RichText::new(
                "v0.1.0-rc.1 核心隐私功能。真名 → S_001 等确定性化名，\
                 AI 全程看不到明文；AES-256-GCM 加密映射表（密码派生密钥，\
                 密码丢失不可恢复）。",
            )
            .font(FontId::proportional(11.0))
            .color(theme.text_dim),
        );
        ui.add_space(6.0);
        // Read the engine state under the lock, then drop it before
        // touching any &mut App state so the borrow checker is happy.
        let (enabled, mapping_count) = {
            let pii = app.pii.lock();
            (pii.enabled, pii.mapping_count())
        };
        ui.horizontal(|ui| {
            let dot_color = if enabled {
                theme.success
            } else {
                theme.warning
            };
            let dot_rect = Rect::from_min_size(
                Pos2::new(ui.cursor().left(), ui.cursor().center().y - 3.0),
                Vec2::splat(6.0),
            );
            icons::dot(ui.painter(), dot_rect, dot_color);
            ui.add_space(10.0);
            ui.label(
                egui::RichText::new(if enabled {
                    "已启用（已加载加密映射表）"
                } else {
                    "未启用"
                })
                .font(FontId::proportional(12.0))
                .color(theme.text),
            );
        });
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new(format!("当前映射: {mapping_count} 条"))
                    .font(FontId::proportional(11.0))
                    .color(theme.text_dim),
            );
        });
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            if ghost_button(ui, &theme, "导出备份").clicked() {
                app.push_toast(crate::runtime::ToastKind::Info, "导出备份功能开发中");
            }
            if primary_button(ui, &theme, "初始化/解绑").clicked() {
                crate::ui::pii_dialog::open_unlock_dialog(app);
            }
            if ghost_button(ui, &theme, "查看映射").clicked() {
                crate::ui::pii_dialog::open_mappings_view(app);
            }
        });
    });

    ui.add_space(8.0);

    // Local-only RAG note
    glass_card(ui, &theme, |ui| {
        panel_title(ui, &theme, "本地知识库");
        ui.label(
            egui::RichText::new("知识库文档与向量均保存在本地 SQLite，不会上传至任何外部服务。")
                .font(FontId::proportional(11.0))
                .color(theme.text_dim),
        );
        ui.horizontal(|ui| {
            let docs = app.rag_documents.read().len();
            ui.label(
                egui::RichText::new(format!("已存储文档: {docs}"))
                    .font(FontId::proportional(12.0))
                    .color(theme.text),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if primary_button(ui, &theme, "管理").clicked() {
                    app.navigate(crate::app::Page::Rag);
                }
            });
        });
    });
}

/// A security feature row with a 3 px rounded accent bar on the left.
fn feature_row(ui: &mut Ui, theme: &Theme, color: egui::Color32, title: &str, desc: &str) {
    let row_height = 38.0;
    ui.horizontal(|ui| {
        let (bar_rect, _) = ui.allocate_exact_size(Vec2::new(3.0, row_height), Sense::hover());
        ui.painter()
            .rect_filled(bar_rect, egui::Rounding::same(2.0), color);
        ui.add_space(10.0);
        ui.vertical(|ui| {
            ui.label(
                egui::RichText::new(title)
                    .font(FontId::proportional(13.0))
                    .strong()
                    .color(theme.text),
            );
            ui.label(
                egui::RichText::new(desc)
                    .font(FontId::proportional(11.0))
                    .color(theme.text_dim),
            );
        });
    });
}
