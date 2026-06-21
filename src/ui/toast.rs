//! Toast overlay with slide-in/out animation.

use std::time::Instant;

use eframe::egui::{self, FontId, Pos2, Rect, Vec2};

use crate::app::App;
use crate::runtime::ToastKind;
use crate::ui::icons;

pub fn show(app: &mut App, ctx: &egui::Context) {
    if app.toasts.is_empty() {
        return;
    }
    egui::Area::new(egui::Id::new("toasts"))
        .order(egui::Order::Foreground)
        .fixed_pos(Pos2::new(ctx.screen_rect().right() - 320.0, 70.0))
        .show(ctx, |ui| {
            ui.set_max_width(300.0);
            ui.vertical(|ui| {
                let now = Instant::now();
                for toast in &app.toasts {
                    let age = now.duration_since(toast.born).as_secs_f32();
                    let ttl = toast.ttl.as_secs_f32();
                    let progress = (age / ttl).clamp(0.0, 1.0);
                    // slide in then fade out
                    let slide = if age < 0.25 {
                        crate::util::ease::out_back((age / 0.25).clamp(0.0, 1.0))
                    } else if progress > 0.8 {
                        1.0 - ((progress - 0.8) / 0.2).clamp(0.0, 1.0)
                    } else {
                        1.0
                    };
                    let alpha = slide.clamp(0.0, 1.0);
                    let color = match toast.kind {
                        ToastKind::Info => app.theme.info,
                        ToastKind::Success => app.theme.success,
                        ToastKind::Warning => app.theme.warning,
                        ToastKind::Error => app.theme.danger,
                    };
                    let frame = egui::Frame::none()
                        .fill(egui::Color32::from_rgba_premultiplied(
                            app.theme.bg_elevated.r(),
                            app.theme.bg_elevated.g(),
                            app.theme.bg_elevated.b(),
                            (240.0 * alpha) as u8,
                        ))
                        .stroke(egui::Stroke::new(1.0, color))
                        .rounding(egui::Rounding::same(12.0))
                        .inner_margin(egui::Margin::same(12.0))
                        .shadow(egui::epaint::Shadow {
                            offset: Vec2::new(0.0, 4.0),
                            blur: 16.0,
                            spread: 0.0,
                            color: app.theme.shadow,
                        });
                    let mut content_color = app.theme.text;
                    content_color = egui::Color32::from_rgba_premultiplied(
                        content_color.r(),
                        content_color.g(),
                        content_color.b(),
                        (255.0 * alpha) as u8,
                    );
                    frame.show(ui, |ui| {
                        ui.horizontal_top(|ui| {
                            let icon_rect = Rect::from_min_size(
                                Pos2::new(ui.cursor().left(), ui.cursor().center().y - 7.0),
                                Vec2::splat(14.0),
                            );
                            match toast.kind {
                                ToastKind::Info => {
                                    ui.painter().circle_stroke(
                                        icon_rect.center(),
                                        6.0,
                                        egui::Stroke::new(1.5, color),
                                    );
                                    ui.painter().circle_filled(
                                        Pos2::new(icon_rect.center().x, icon_rect.center().y - 2.0),
                                        1.5,
                                        color,
                                    );
                                    ui.painter().line_segment(
                                        [
                                            Pos2::new(
                                                icon_rect.center().x,
                                                icon_rect.center().y + 1.0,
                                            ),
                                            Pos2::new(
                                                icon_rect.center().x,
                                                icon_rect.center().y + 4.0,
                                            ),
                                        ],
                                        egui::Stroke::new(1.5, color),
                                    );
                                }
                                ToastKind::Success => icons::check(ui.painter(), icon_rect, color),
                                ToastKind::Warning => {
                                    ui.painter().circle_stroke(
                                        icon_rect.center(),
                                        6.0,
                                        egui::Stroke::new(1.5, color),
                                    );
                                    ui.painter().circle_filled(
                                        Pos2::new(icon_rect.center().x, icon_rect.center().y + 2.0),
                                        1.5,
                                        color,
                                    );
                                    ui.painter().line_segment(
                                        [
                                            Pos2::new(
                                                icon_rect.center().x,
                                                icon_rect.center().y - 4.0,
                                            ),
                                            Pos2::new(
                                                icon_rect.center().x,
                                                icon_rect.center().y + 0.0,
                                            ),
                                        ],
                                        egui::Stroke::new(1.5, color),
                                    );
                                }
                                ToastKind::Error => icons::cross(ui.painter(), icon_rect, color),
                            }
                            ui.add_space(18.0);
                            ui.label(
                                egui::RichText::new(&toast.msg)
                                    .font(FontId::proportional(13.0))
                                    .color(content_color),
                            );
                        });
                        // progress bar
                        let (r, _) = ui.allocate_exact_size(
                            Vec2::new(ui.available_width(), 3.0),
                            egui::Sense::hover(),
                        );
                        let mut bar_color = color;
                        bar_color = egui::Color32::from_rgba_premultiplied(
                            bar_color.r(),
                            bar_color.g(),
                            bar_color.b(),
                            (200.0 * alpha) as u8,
                        );
                        let w = r.width() * (1.0 - progress);
                        ui.painter().rect_filled(
                            egui::Rect::from_min_size(r.min, Vec2::new(w, r.height())),
                            egui::Rounding::same(2.0),
                            bar_color,
                        );
                    });
                    ui.add_space(6.0);
                }
            });
        });
}
