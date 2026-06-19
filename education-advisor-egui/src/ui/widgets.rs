//! Reusable glassmorphic widgets.

use eframe::egui::{self, Align2, Color32, FontId, Pos2, Rounding, Sense, Stroke, Ui, Vec2};

use crate::theme::Theme;

/// A frosted-glass card with a soft shadow.
pub fn card(ui: &mut Ui, theme: &Theme, add: impl FnOnce(&mut Ui)) {
    let frame = egui::Frame::none()
        .fill(theme.surface_glass)
        .stroke(Stroke::new(1.0, theme.border))
        .rounding(Rounding::same(14.0))
        .inner_margin(egui::Margin::same(14.0))
        .shadow(egui::epaint::Shadow {
            offset: Vec2::new(0.0, 4.0),
            blur: 18.0,
            spread: 0.0,
            color: theme.shadow,
        });
    frame.show(ui, add);
}

/// A section title with an accent bar.
pub fn section_title(ui: &mut Ui, theme: &Theme, text: &str) {
    ui.horizontal(|ui| {
        let (rect, _) = ui.allocate_exact_size(Vec2::new(4.0, 18.0), Sense::hover());
        ui.painter().rect_filled(rect, Rounding::same(2.0), theme.accent);
        ui.label(egui::RichText::new(text).font(FontId::proportional(16.0)).strong().color(theme.text));
    });
}

/// A pill badge.
pub fn badge(ui: &mut Ui, text: &str, color: Color32) {
    let galley = ui.painter().layout(text.to_string(), FontId::proportional(11.0), color, 100.0);
    let pad = 8.0;
    let size = Vec2::new(galley.size().x + pad * 2.0, galley.size().y + 4.0);
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    let bg = Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 40);
    ui.painter().rect_filled(rect, Rounding::same(10.0), bg);
    ui.painter().rect_stroke(rect, Rounding::same(10.0), Stroke::new(1.0, color));
    ui.painter().galley(
        Pos2::new(rect.center().x - galley.size().x / 2.0, rect.center().y - galley.size().y / 2.0),
        galley,
        color,
    );
}

/// A primary accent button with hover lift.
pub fn primary_button(ui: &mut Ui, theme: &Theme, text: &str) -> bool {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(96.0, 32.0), Sense::click());
    let hover = resp.hovered();
    let clicked = resp.clicked();
    let bg = if hover { theme.accent_hover } else { theme.accent };
    let lift = if hover { 1.0 } else { 0.0 };
    let r = rect.translate(Vec2::new(0.0, -lift));
    ui.painter().rect_filled(r, Rounding::same(9.0), bg);
    ui.painter().text(
        r.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::proportional(13.0),
        Color32::WHITE,
    );
    clicked
}

/// A ghost/secondary button.
pub fn ghost_button(ui: &mut Ui, theme: &Theme, text: &str) -> bool {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(96.0, 32.0), Sense::click());
    let hover = resp.hovered();
    let clicked = resp.clicked();
    let bg = if hover { theme.accent_dim } else { Color32::TRANSPARENT };
    ui.painter().rect_filled(rect, Rounding::same(9.0), bg);
    ui.painter().rect_stroke(rect, Rounding::same(9.0), Stroke::new(1.0, theme.border));
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::proportional(13.0),
        theme.text,
    );
    clicked
}

/// A KPI stat card.
pub fn stat_card(ui: &mut Ui, theme: &Theme, label: &str, value: &str, accent: Color32, icon: &str) {
    card(ui, theme, |ui| {
        ui.horizontal_top(|ui| {
            ui.label(egui::RichText::new(icon).font(FontId::proportional(22.0)));
            ui.vertical(|ui| {
                ui.label(egui::RichText::new(value).font(FontId::proportional(24.0)).strong().color(accent));
                ui.label(egui::RichText::new(label).font(FontId::proportional(12.0)).color(theme.text_dim));
            });
        });
    });
}

/// A circular progress ring.
#[allow(dead_code)]
pub fn progress_ring(ui: &mut Ui, theme: &Theme, frac: f32, size: f32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
    let center = rect.center();
    let radius = size / 2.0 - 3.0;
    let stroke_bg = Stroke::new(4.0, theme.border);
    let stroke_fg = Stroke::new(4.0, theme.accent);
    ui.painter().circle_stroke(center, radius, stroke_bg);
    let frac = frac.clamp(0.0, 1.0);
    let start = std::f32::consts::FRAC_PI_2;
    let end = start + frac * std::f32::consts::TAU;
    let n = ((frac * 64.0) as usize).max(1);
    let pts: Vec<Pos2> = (0..=n)
        .map(|i| {
            let t = (end - start).mul_add(i as f32 / n as f32, start);
            Pos2::new(center.x + radius * t.cos(), center.y + radius * t.sin())
        })
        .collect();
    if pts.len() > 1 {
        ui.painter().add(egui::Shape::line(pts, stroke_fg));
    }
}

/// Empty-state placeholder.
pub fn empty_state(ui: &mut Ui, theme: &Theme, icon: &str, text: &str) {
    ui.vertical_centered(|ui| {
        ui.add_space(40.0);
        ui.label(egui::RichText::new(icon).font(FontId::proportional(40.0)));
        ui.add_space(8.0);
        ui.label(egui::RichText::new(text).font(FontId::proportional(14.0)).color(theme.text_faint));
        ui.add_space(40.0);
    });
}
