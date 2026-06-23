//! Sidebar navigation with elastic collapse and a refined hand-painted look.

use eframe::egui::{self, Align, Align2, Color32, FontId, Layout, Pos2, Rect, Response, Rounding, Sense, Stroke, Ui, Vec2};

use crate::app::{App, Page};
use crate::ui::icons;
use crate::ui::widgets::{icon_button, nav_item, status_pill};

pub fn show(app: &mut App, ui: &mut Ui) {
    app.sidebar_anim
        .set_target(if app.sidebar_collapsed { 0.0 } else { 1.0 }, 280);
    let expanded = app.sidebar_anim.value();

    let inner_margin = if expanded > 0.5 { 12.0 } else { 8.0 };
    ui.set_min_width(if expanded > 0.5 { 180.0 } else { 56.0 });

    ui.vertical(|ui| {
        ui.add_space(14.0);

        // logo area
        ui.horizontal(|ui| {
            ui.add_space(inner_margin);
            let logo_size = if expanded > 0.5 { 36.0 } else { 40.0 };
            let (logo_rect, _) = ui.allocate_exact_size(Vec2::splat(logo_size), Sense::hover());
            // gradient orb behind letters
            ui.painter()
                .circle_filled(logo_rect.center(), logo_size / 2.0, app.theme.accent_dim);
            ui.painter()
                .circle_filled(logo_rect.center(), logo_size / 2.0 - 3.0, app.theme.accent);
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
                    if nav_item(
                        ui,
                        &app.theme,
                        page_icon(page),
                        page.label(),
                        active,
                        expanded,
                        badge.as_deref(),
                    )
                    .clicked()
                    {
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
                        let color = eframe::egui::Color32::from_rgb(
                            agent.color[0],
                            agent.color[1],
                            agent.color[2],
                        );
                        agent_row(ui, &app.theme, color, agent.name);
                        ui.add_space(2.0);
                    }
                });
            });
        }

        // spacer pushes footer down
        let footer_target = if expanded > 0.5 { 86.0 } else { 104.0 };
        ui.with_layout(
            Layout::top_down(Align::LEFT).with_main_align(Align::LEFT),
            |ui| {
                ui.allocate_space(Vec2::new(0.0, ui.available_height().max(0.0) - footer_target));
            },
        );

        // footer: privacy status + collapse toggle + user avatar/settings shortcut
        ui.horizontal(|ui| {
            ui.add_space(inner_margin);
            ui.vertical(|ui| {
                ui.set_width(ui.available_width() - inner_margin);

                if expanded > 0.5 {
                    // privacy pill
                    let privacy_color = if app.settings.privacy_enabled {
                        app.theme.success
                    } else {
                        app.theme.warning
                    };
                    let privacy_label = if app.settings.privacy_enabled {
                        "隐私开启"
                    } else {
                        "隐私关闭"
                    };
                    let _ = status_pill(ui, &app.theme, privacy_label, privacy_color);
                    ui.add_space(8.0);
                }

                if expanded > 0.5 {
                    ui.horizontal(|ui| {
                        sidebar_collapse_toggle(app, ui);
                        ui.add_space(6.0);
                        if avatar_button(ui, &app.theme, 32.0, "我", app.theme.accent).clicked() {
                            app.navigate(Page::Settings);
                        }
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            let count = crate::agents::all_agents().len();
                            ui.label(
                                egui::RichText::new(format!("{count} 个代理就绪"))
                                    .font(FontId::proportional(11.0))
                                    .color(app.theme.text_faint),
                            );
                        });
                    });
                } else {
                    ui.vertical(|ui| {
                        sidebar_collapse_toggle(app, ui);
                        ui.add_space(4.0);
                        if avatar_button(ui, &app.theme, 32.0, "我", app.theme.accent).clicked() {
                            app.navigate(Page::Settings);
                        }
                    });
                }
            });
        });
        ui.add_space(12.0);
    });
}

fn sidebar_collapse_toggle(app: &mut App, ui: &mut Ui) {
    let collapse_icon = if app.sidebar_collapsed {
        icons::chevron_right
    } else {
        icons::chevron_left
    };
    if icon_button(ui, &app.theme, collapse_icon, 32.0).clicked() {
        app.sidebar_collapsed = !app.sidebar_collapsed;
        // Keep the persisted setting in sync so the next
        // launch reflects the user's last choice.
        app.settings.sidebar_collapsed = app.sidebar_collapsed;
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::SaveSettings(app.settings.clone()));
    }
}

fn avatar_button(
    ui: &mut Ui,
    theme: &crate::theme::Theme,
    size: f32,
    label: &str,
    color: Color32,
) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(size), Sense::click());
    let hover = resp.hovered();
    let active = resp.is_pointer_button_down_on();
    let bg = if active {
        theme.accent_dim
    } else if hover {
        theme.surface_hover
    } else {
        Color32::TRANSPARENT
    };
    ui.painter().rect_filled(rect, Rounding::same(size / 2.0), bg);
    let stroke = if hover { theme.border_strong } else { theme.border };
    ui.painter()
        .rect_stroke(rect, Rounding::same(size / 2.0), Stroke::new(1.0, stroke));
    icons::avatar(ui.painter(), rect.shrink(size * 0.22), color, label);
    resp
}

fn page_icon(page: Page) -> fn(&eframe::egui::Painter, eframe::egui::Rect, &crate::theme::Theme) {
    match page {
        Page::Dashboard => icons::dashboard,
        Page::Chat => icons::chat,
        Page::Students => icons::students,
        Page::Agents => icons::agent,
        Page::AgentHistory => icons::history,
        Page::Models => icons::model,
        Page::Skills => icons::skills,
        Page::Scheduler => icons::scheduler,
        Page::Rag => icons::rag,
        Page::Privacy => icons::privacy,
        Page::Settings => icons::settings,
    }
}

fn page_badge(app: &App, page: Page) -> Option<String> {
    match page {
        Page::Students => {
            let n = app.students.read().len();
            if n > 0 {
                Some(n.to_string())
            } else {
                None
            }
        }
        Page::Chat => {
            let n = app.conversations.read().len();
            if n > 0 {
                Some(n.to_string())
            } else {
                None
            }
        }
        Page::Agents => Some(crate::agents::all_agents().len().to_string()),
        _ => None,
    }
}

fn agent_row(ui: &mut Ui, theme: &crate::theme::Theme, color: Color32, name: &str) {
    let height = 28.0;
    let (rect, resp) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
    if resp.hovered() {
        ui.painter()
            .rect_filled(rect, egui::Rounding::same(8.0), theme.surface_hover);
    }
    let avatar_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + 8.0, rect.center().y - 8.0),
        Vec2::splat(16.0),
    );
    icons::avatar(ui.painter(), avatar_rect, color, name);
    ui.painter().text(
        Pos2::new(rect.min.x + 32.0, rect.center().y),
        Align2::LEFT_CENTER,
        name,
        FontId::proportional(11.0),
        theme.text_dim,
    );
}
