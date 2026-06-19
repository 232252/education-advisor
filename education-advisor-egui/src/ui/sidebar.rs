//! Sidebar navigation with elastic collapse and a refined hand-painted look.

use eframe::egui::{self, Align, Align2, Color32, FontId, Layout, Pos2, Sense, Ui, Vec2};

use crate::app::{App, Page};
use crate::ui::widgets::{icon_button, nav_item, status_pill};

pub fn show(app: &mut App, ui: &mut Ui) {
    app.sidebar_anim.set_target(
        if app.sidebar_collapsed { 0.0 } else { 1.0 },
        280,
    );
    let expanded = app.sidebar_anim.value();

    let inner_margin = if expanded > 0.5 { 12.0 } else { 8.0 };
    ui.set_min_width(if expanded > 0.5 { 200.0 } else { 64.0 });

    ui.vertical(|ui| {
        ui.add_space(14.0);

        // logo area
        ui.horizontal(|ui| {
            ui.add_space(inner_margin);
            let logo_size = if expanded > 0.5 { 36.0 } else { 40.0 };
            let (logo_rect, _) = ui.allocate_exact_size(Vec2::splat(logo_size), Sense::hover());
            // gradient orb behind letters
            ui.painter().circle_filled(logo_rect.center(), logo_size / 2.0, app.theme.accent_dim);
            ui.painter().circle_filled(logo_rect.center(), logo_size / 2.0 - 3.0, app.theme.accent);
            ui.painter().text(
                logo_rect.center(),
                Align2::CENTER_CENTER,
                "EA",
                FontId::proportional(if expanded > 0.5 { 13.0 } else { 14.0 }),
                Color32::WHITE,
            );
            if expanded > 0.5 {
                ui.vertical(|ui| {
                    ui.label(
                        egui::RichText::new("Education Advisor")
                            .font(FontId::proportional(12.0))
                            .strong()
                            .color(app.theme.text),
                    );
                    ui.label(
                        egui::RichText::new("智能教育管理")
                            .font(FontId::proportional(10.0))
                            .color(app.theme.text_faint),
                    );
                });
            }
        });

        ui.add_space(20.0);

        // main navigation
        ui.horizontal(|ui| {
            ui.add_space(inner_margin);
            ui.vertical(|ui| {
                ui.set_width(ui.available_width() - inner_margin);
                for page in Page::ALL {
                    let active = app.page == page;
                    let badge = page_badge(app, page);
                    if nav_item(ui, &app.theme, page.icon(), page.label(), active, expanded, badge.as_deref()).clicked() {
                        app.navigate(page);
                        if app.sidebar_collapsed {
                            app.sidebar_collapsed = false;
                        }
                    }
                    ui.add_space(3.0);
                }
            });
        });

        ui.add_space(8.0);

        // agent status mini-list
        if expanded > 0.5 {
            ui.horizontal(|ui| {
                ui.add_space(inner_margin);
                ui.label(
                    egui::RichText::new("AI 代理")
                        .font(FontId::proportional(10.0))
                        .strong()
                        .color(app.theme.text_faint),
                );
            });
            ui.add_space(4.0);
            ui.horizontal(|ui| {
                ui.add_space(inner_margin);
                ui.vertical(|ui| {
                    ui.set_width(ui.available_width() - inner_margin);
                    for agent in crate::agents::all_agents().iter().take(5) {
                        agent_row(ui, &app.theme, agent.icon, agent.name);
                        ui.add_space(2.0);
                    }
                });
            });
        }

        // spacer pushes footer down
        ui.with_layout(Layout::top_down(Align::LEFT).with_main_align(Align::LEFT), |ui| {
            ui.allocate_space(Vec2::new(0.0, ui.available_height().max(0.0) - 86.0));
        });

        // footer: privacy + collapse + agent count
        ui.horizontal(|ui| {
            ui.add_space(inner_margin);
            ui.vertical(|ui| {
                ui.set_width(ui.available_width() - inner_margin);

                // privacy pill
                let privacy_color = if app.settings.privacy_enabled { app.theme.success } else { app.theme.warning };
                let privacy_label = if app.settings.privacy_enabled { "隐私开启" } else { "隐私关闭" };
                let _ = status_pill(ui, &app.theme, "●", privacy_label, privacy_color);

                ui.add_space(8.0);

                // collapse toggle + agent count
                ui.horizontal(|ui| {
                    if icon_button(ui, &app.theme, if app.sidebar_collapsed { "»" } else { "«" }, 32.0).clicked() {
                        app.sidebar_collapsed = !app.sidebar_collapsed;
                    }
                    if expanded > 0.5 {
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            let count = crate::agents::all_agents().len();
                            ui.label(
                                egui::RichText::new(format!("{count} 个代理就绪"))
                                    .font(FontId::proportional(11.0))
                                    .color(app.theme.text_faint),
                            );
                        });
                    }
                });
            });
        });
        ui.add_space(12.0);
    });
}

fn page_badge(app: &App, page: Page) -> Option<String> {
    match page {
        Page::Students => {
            let n = app.students.read().len();
            if n > 0 { Some(n.to_string()) } else { None }
        }
        Page::Chat => {
            let n = app.conversations.read().len();
            if n > 0 { Some(n.to_string()) } else { None }
        }
        Page::Agents => Some(crate::agents::all_agents().len().to_string()),
        _ => None,
    }
}

fn agent_row(ui: &mut Ui, theme: &crate::theme::Theme, icon: &str, name: &str) {
    let height = 28.0;
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
    if resp.hovered() {
        ui.painter().rect_filled(rect, egui::Rounding::same(8.0), theme.surface_hover);
    }
    ui.painter().text(
        Pos2::new(rect.min.x + 18.0, rect.center().y),
        Align2::CENTER_CENTER,
        icon,
        FontId::proportional(13.0),
        theme.text_dim,
    );
    ui.painter().text(
        Pos2::new(rect.min.x + 36.0, rect.center().y),
        Align2::LEFT_CENTER,
        name,
        FontId::proportional(11.0),
        theme.text_dim,
    );
}
