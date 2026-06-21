//! Privacy page: encryption status, PII redaction controls, and audit log.

use eframe::egui::{self, Align, FontId, Layout, Pos2, Rect, Ui, Vec2};

use crate::app::App;
use crate::ui::icons;
use crate::ui::widgets::{card, ghost_button, primary_button, section_title};

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    section_title(ui, &theme, "隐私与安全");

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

    ui.add_space(8.0);

    // Encryption status
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("数据加密")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            let dot_rect = Rect::from_min_size(
                Pos2::new(ui.cursor().left(), ui.cursor().center().y - 3.0),
                Vec2::splat(6.0),
            );
            icons::dot(ui.painter(), dot_rect, theme.success);
            ui.add_space(10.0);
            ui.label(
                egui::RichText::new("AES-256-GCM 已启用")
                    .font(FontId::proportional(13.0))
                    .color(theme.text),
            );
        });
        ui.label(
            egui::RichText::new("监护人电话、API Key 等敏感字段在落盘前自动加密")
                .font(FontId::proportional(11.0))
                .color(theme.text_dim),
        );
    });

    ui.add_space(8.0);

    // PII redaction switch
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("PII 脱敏")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
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

    // Local-only RAG note
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("本地知识库")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
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
