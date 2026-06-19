//! Sidebar navigation with elastic collapse.

use eframe::egui::{self, Align, Align2, FontId, Layout, Sense, Ui, Vec2};

use crate::app::{App, Page};

pub fn show(app: &mut App, ui: &mut Ui) {
    // animate collapse target
    app.sidebar_anim.set_target(
        if app.sidebar_collapsed { 0.0 } else { 1.0 },
        300,
    );
    let expanded = app.sidebar_anim.value();

    ui.vertical(|ui| {
        ui.add_space(12.0);

        // collapse toggle
        ui.horizontal(|ui| {
            let icon = if app.sidebar_collapsed { "»" } else { "«" };
            if nav_button(ui, &app.theme, icon, "折叠", expanded, true) {
                app.sidebar_collapsed = !app.sidebar_collapsed;
            }
        });

        ui.add_space(8.0);
        ui.separator();
        ui.add_space(8.0);

        for page in Page::ALL {
            let active = app.page == page;
            if nav_button(ui, &app.theme, page.icon(), page.label(), expanded, active) {
                app.navigate(page);
            }
            ui.add_space(2.0);
        }

        // spacer pushes footer down
        ui.with_layout(Layout::top_down(Align::LEFT).with_main_align(Align::LEFT), |ui| {
            ui.allocate_space(Vec2::new(0.0, ui.available_height().max(0.0) - 60.0));
        });

        ui.separator();
        ui.add_space(8.0);
        // footer agent count
        let count = crate::agents::all_agents().len();
        let label = if expanded > 0.5 {
            format!("{count} 个 AI 代理就绪")
        } else {
            format!("{count}")
        };
        ui.horizontal(|ui| {
            ui.add_space(12.0);
            ui.label(
                egui::RichText::new("🤖")
                    .font(FontId::proportional(14.0)),
            );
            if expanded > 0.5 {
                ui.label(
                    egui::RichText::new(label)
                        .font(FontId::proportional(11.0))
                        .color(app.theme.text_faint),
                );
            }
        });
    });
}

fn nav_button(ui: &mut Ui, theme: &crate::theme::Theme, icon: &str, label: &str, expanded: f32, active: bool) -> bool {
    let height = 42.0;
    let width = ui.available_width().max(48.0);
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    let hover = resp.hovered() || active;

    let bg = if active {
        theme.accent_dim
    } else if hover {
        theme.surface
    } else {
        egui::Color32::TRANSPARENT
    };
    ui.painter().rect_filled(rect, egui::Rounding::same(10.0), bg);

    // active accent bar
    if active {
        let bar = egui::Rect::from_min_size(rect.min, Vec2::new(3.0, rect.height()));
        ui.painter().rect_filled(bar, egui::Rounding::same(2.0), theme.accent);
    }

    let icon_x = rect.min.x + 16.0;
    let center_y = rect.center().y;
    ui.painter().text(
        egui::pos2(icon_x, center_y),
        Align2::CENTER_CENTER,
        icon,
        FontId::proportional(16.0),
        if active { theme.accent } else { theme.text_dim },
    );

    if expanded > 0.05 {
        let alpha = expanded.clamp(0.0, 1.0);
        let color = if active { theme.text } else { theme.text_dim };
        let mut c = color;
        c = egui::Color32::from_rgba_premultiplied(
            (f32::from(c.r()) * alpha) as u8,
            (f32::from(c.g()) * alpha) as u8,
            (f32::from(c.b()) * alpha) as u8,
            (f32::from(c.a()) * alpha) as u8,
        );
        ui.painter().text(
            egui::pos2(icon_x + 26.0, center_y),
            Align2::CENTER_CENTER,
            label,
            FontId::proportional(13.0),
            c,
        );
    }

    resp.clicked()
}
