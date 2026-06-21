//! Top bar: app title, breadcrumb, theme toggle, quick actions and live status.

use eframe::egui::{self, Align, FontId, Layout, Ui, Vec2};

use crate::app::App;
use crate::theme::Theme;
use crate::ui::icons;
use crate::ui::widgets::{icon_button, status_pill};

pub fn show(app: &mut App, ctx: &egui::Context) {
    egui::TopBottomPanel::top("topbar")
        .exact_height(60.0)
        .frame(
            egui::Frame::none()
                .fill(app.theme.bg_elevated)
                .stroke(egui::Stroke::new(1.0, app.theme.border))
                .inner_margin(egui::Margin::symmetric(18.0, 0.0)),
        )
        .show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.add_space(4.0);

                // app title + breadcrumb
                let (logo_rect, _) =
                    ui.allocate_exact_size(Vec2::splat(28.0), egui::Sense::hover());
                icons::dashboard(ui.painter(), logo_rect, &app.theme);
                ui.add_space(10.0);
                ui.vertical(|ui| {
                    ui.label(
                        egui::RichText::new("Education Advisor")
                            .font(FontId::proportional(15.0))
                            .strong()
                            .color(app.theme.text),
                    );
                    ui.label(
                        egui::RichText::new(format!(
                            "{} / v{}",
                            app.page.label(),
                            env!("CARGO_PKG_VERSION")
                        ))
                        .font(FontId::proportional(10.0))
                        .color(app.theme.text_faint),
                    );
                });

                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    // theme toggle
                    let theme_icon = if app.theme.dark {
                        icons::sun
                    } else {
                        icons::moon
                    };
                    if icon_button(ui, &app.theme, theme_icon, 34.0).clicked() {
                        app.toggle_theme(ctx);
                    }
                    ui.add_space(4.0);

                    // notifications
                    if icon_button(ui, &app.theme, icons::bell, 34.0).clicked() {
                        app.push_toast(crate::runtime::ToastKind::Info, "暂无新通知");
                    }
                    ui.add_space(4.0);

                    // model status
                    let providers = app.providers.read();
                    let (label, color) = if providers.iter().any(|p| p.enabled) {
                        ("模型在线", app.theme.success)
                    } else {
                        ("未配置模型", app.theme.danger)
                    };
                    let _ = status_pill(ui, &app.theme, label, color);
                    ui.add_space(4.0);

                    // privacy status
                    let (p_label, p_color) = if app.settings.privacy_enabled {
                        ("隐私保护", app.theme.info)
                    } else {
                        ("隐私关闭", app.theme.text_faint)
                    };
                    let _ = status_pill(ui, &app.theme, p_label, p_color);
                });
            });
        });
}

#[allow(dead_code)]
fn separator_dot(ui: &mut Ui, theme: &Theme) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(4.0), egui::Sense::hover());
    ui.painter()
        .circle_filled(rect.center(), 2.0, theme.text_faint);
}
