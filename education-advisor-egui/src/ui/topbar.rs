//! Top bar: app title, theme toggle, quick actions.

use eframe::egui::{self, Align2, Align, FontId, Layout, Ui, Vec2};

use crate::app::App;
use crate::theme::Theme;

pub fn show(app: &mut App, ctx: &egui::Context) {
    egui::TopBottomPanel::top("topbar")
        .exact_height(56.0)
        .frame(
            egui::Frame::none()
                .fill(app.theme.bg_elevated)
                .inner_margin(egui::Margin::symmetric(16.0, 0.0)),
        )
        .show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.add_space(2.0);
                ui.label(
                    egui::RichText::new("◆")
                        .font(FontId::proportional(20.0))
                        .color(app.theme.accent),
                );
                ui.label(
                    egui::RichText::new("Education Advisor")
                        .font(FontId::proportional(16.0))
                        .strong()
                        .color(app.theme.text),
                );
                ui.label(
                    egui::RichText::new("v1.0")
                        .font(FontId::proportional(11.0))
                        .color(app.theme.text_faint),
                );

                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    // theme toggle
                    let theme_icon = if app.theme.dark { "☀️" } else { "🌙" };
                    if icon_button(ui, &app.theme, theme_icon, 32.0) {
                        app.toggle_theme(ctx);
                    }
                    ui.separator();
                    // status dot
                    let providers = app.providers.read();
                    let (dot, label) = if providers.iter().any(|p| p.enabled) {
                        (app.theme.success, "在线")
                    } else {
                        (app.theme.danger, "未配置模型")
                    };
                    let (r, _) = ui.allocate_exact_size(Vec2::new(8.0, 8.0), egui::Sense::hover());
                    ui.painter().circle_filled(r.center(), 4.0, dot);
                    ui.label(
                        egui::RichText::new(label)
                            .font(FontId::proportional(12.0))
                            .color(app.theme.text_dim),
                    );
                });
            });
        });
}

fn icon_button(ui: &mut Ui, theme: &Theme, icon: &str, size: f32) -> bool {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(size), egui::Sense::click());
    let hover = resp.hovered();
    if hover {
        ui.painter().rect_filled(rect, egui::Rounding::same(8.0), theme.accent_dim);
    }
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        icon,
        FontId::proportional(16.0),
        theme.text,
    );
    resp.clicked()
}
