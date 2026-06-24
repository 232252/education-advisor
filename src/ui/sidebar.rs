//! Sidebar navigation — DeepSeek-style dark sci-fi left rail.
//!
//! Mirrors the reference HTML: 220 px expanded / 64 px collapsed, brain logo
//! with "Edu. AI" wordmark, menu items with 14 px rounding, active state with
//! a 3 px left inset bar and blue text glow, a bottom "个人中心" row separated
//! by a hairline border, and a collapse toggle pinned to the very bottom.

use eframe::egui::{
    self, Align2, Color32, FontId, Pos2, Rect, Response, Rounding, Sense, Stroke, Ui, Vec2,
};

use crate::app::{App, Page};
use crate::theme::Theme;
use crate::ui::icons;

pub fn show(app: &mut App, ui: &mut Ui) {
    app.sidebar_anim
        .set_target(if app.sidebar_collapsed { 0.0 } else { 1.0 }, 280);
    let expanded = app.sidebar_anim.value().clamp(0.0, 1.0);
    let collapsed = expanded < 0.5;

    // DeepSeek sidebar: 1 px right hairline border rgba(255,255,255,0.06).
    let side_rect = ui.max_rect();
    ui.painter().line_segment(
        [
            Pos2::new(side_rect.max.x - 0.5, side_rect.min.y),
            Pos2::new(side_rect.max.x - 0.5, side_rect.max.y),
        ],
        Stroke::new(1.0, app.theme.border),
    );

    // 16 px horizontal padding when expanded; 0 when collapsed (icons centered).
    let pad_x = if collapsed { 0.0 } else { 16.0 };

    ui.vertical(|ui| {
        ui.add_space(24.0);

        // ── Logo area: brain icon + "Edu. AI" ──
        logo_area(ui, &app.theme, expanded);
        ui.add_space(36.0);

        // ── Menu list ──
        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(ui.available_width() - pad_x);
                for page in Page::ALL {
                    let active = app.page == page;
                    if menu_item(
                        ui,
                        &app.theme,
                        page_icon(page),
                        page.label(),
                        active,
                        expanded,
                    )
                    .clicked()
                    {
                        app.navigate(page);
                    }
                    ui.add_space(8.0);
                }
            });
        });

        // ── Spacer pushes footer to the bottom ──
        let footer_h = if collapsed { 108.0 } else { 132.0 };
        ui.allocate_space(Vec2::new(
            0.0,
            (ui.available_height() - footer_h).max(0.0),
        ));

        // ── Bottom: 个人中心 row with top hairline border ──
        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(ui.available_width() - pad_x);
                let (br, _) =
                    ui.allocate_exact_size(Vec2::new(ui.available_width(), 1.0), Sense::hover());
                ui.painter().rect_filled(br, 0.0, app.theme.border);
                ui.add_space(8.0);
                if menu_item(
                    ui,
                    &app.theme,
                    icons::user,
                    "个人中心",
                    app.page == Page::Settings,
                    expanded,
                )
                .clicked()
                {
                    app.navigate(Page::Settings);
                }
            });
        });

        ui.add_space(8.0);

        // ── Collapse toggle pinned to the very bottom ──
        ui.horizontal(|ui| {
            ui.add_space(pad_x);
            ui.vertical(|ui| {
                ui.set_width(ui.available_width() - pad_x);
                collapse_toggle(app, ui, expanded);
            });
        });
        ui.add_space(24.0);
    });
}

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------

fn logo_area(ui: &mut Ui, theme: &Theme, expanded: f32) {
    let collapsed = expanded < 0.5;
    ui.horizontal(|ui| {
        if collapsed {
            // Center the brain icon in the full width.
            let (rect, _) =
                ui.allocate_exact_size(Vec2::new(ui.available_width(), 32.0), Sense::hover());
            let icon_rect = Rect::from_center_size(rect.center(), Vec2::splat(28.0));
            icons::brain(ui.painter(), icon_rect, theme);
        } else {
            let (icon_rect, _) = ui.allocate_exact_size(Vec2::splat(28.0), Sense::hover());
            icons::brain(ui.painter(), icon_rect, theme);
            ui.add_space(12.0);
            ui.label(
                egui::RichText::new("Edu. AI")
                    .font(FontId::proportional(20.0))
                    .strong()
                    .color(theme.text),
            );
        }
    });
}

// ---------------------------------------------------------------------------
// Menu item (DeepSeek spec: 14 px radius, 12×16 padding, active left bar + glow)
// ---------------------------------------------------------------------------

fn menu_item(
    ui: &mut Ui,
    theme: &Theme,
    icon: fn(&eframe::egui::Painter, eframe::egui::Rect, &Theme),
    label: &str,
    active: bool,
    expanded: f32,
) -> Response {
    let collapsed = expanded < 0.5;
    // padding 12 px top/bottom + 20 px icon → 44 px row height.
    let height = 44.0;
    let width = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    let hover = resp.hovered();

    // Background: active → accent_dim (rgba(59,130,246,0.15)),
    //             hover → surface_hover (rgba(255,255,255,0.05)).
    let bg = if active {
        theme.accent_dim
    } else if hover {
        theme.surface_hover
    } else {
        Color32::TRANSPARENT
    };
    if bg != Color32::TRANSPARENT {
        ui.painter()
            .rect_filled(rect, Rounding::same(14.0), bg);
    }

    // Active left inset bar: 3 px solid #3b82f6.
    if active {
        let bar = Rect::from_min_size(rect.min, Vec2::new(3.0, rect.height()));
        ui.painter().rect_filled(bar, Rounding::same(2.0), theme.accent);
    }

    // Hover translateX: shift content right 4 px.
    let shift_x = if hover && !active { 4.0 } else { 0.0 };
    let icon_size = 20.0;
    let gap = 16.0;
    let text_font = FontId::proportional(14.0);
    let center_y = rect.center().y;

    if collapsed {
        let icon_rect = Rect::from_center_size(rect.center(), Vec2::splat(icon_size));
        icon(ui.painter(), icon_rect, theme);
    } else {
        let icon_x = rect.min.x + 16.0 + shift_x;
        let icon_rect = Rect::from_center_size(
            Pos2::new(icon_x + icon_size / 2.0, center_y),
            Vec2::splat(icon_size),
        );
        icon(ui.painter(), icon_rect, theme);

        let text_x = icon_x + icon_size + gap;
        let text_color = if active || hover {
            Color32::WHITE
        } else {
            theme.text_dim // #94a3b8
        };

        // Active text glow: paint halo in glow_accent at 1 px offsets, then white.
        if active {
            let glow = theme.glow_accent;
            for &(dx, dy) in &[(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
                ui.painter().text(
                    Pos2::new(text_x + dx, center_y + dy),
                    Align2::LEFT_CENTER,
                    label,
                    text_font.clone(),
                    glow,
                );
            }
        }
        ui.painter().text(
            Pos2::new(text_x, center_y),
            Align2::LEFT_CENTER,
            label,
            text_font,
            text_color,
        );
    }

    resp
}

// ---------------------------------------------------------------------------
// Collapse toggle
// ---------------------------------------------------------------------------

fn collapse_toggle(app: &mut App, ui: &mut Ui, expanded: f32) {
    let collapsed = expanded < 0.5;
    let height = 40.0;
    let (rect, resp) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::click());
    let hover = resp.hovered();

    let icon_fn = if collapsed {
        icons::chevron_right
    } else {
        icons::chevron_left
    };
    let icon_color = if hover {
        app.theme.text
    } else {
        app.theme.text_dim
    };

    if collapsed {
        let icon_rect = Rect::from_center_size(rect.center(), Vec2::splat(20.0));
        icon_fn(ui.painter(), icon_rect, icon_color);
    } else {
        let icon_rect = Rect::from_center_size(
            Pos2::new(rect.min.x + 20.0, rect.center().y),
            Vec2::splat(20.0),
        );
        icon_fn(ui.painter(), icon_rect, icon_color);
        ui.painter().text(
            Pos2::new(rect.min.x + 40.0, rect.center().y),
            Align2::LEFT_CENTER,
            "收起菜单",
            FontId::proportional(13.0),
            if hover { app.theme.text } else { app.theme.text_dim },
        );
    }

    if resp.clicked() {
        app.sidebar_collapsed = !app.sidebar_collapsed;
        app.settings.sidebar_collapsed = app.sidebar_collapsed;
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::SaveSettings(app.settings.clone()));
    }
}

// ---------------------------------------------------------------------------
// Page → icon mapping
// ---------------------------------------------------------------------------

fn page_icon(page: Page) -> fn(&eframe::egui::Painter, eframe::egui::Rect, &crate::theme::Theme) {
    match page {
        // DeepSeek reference icons: chart_pie / robot / sliders.
        Page::Dashboard => icons::chart_pie,
        Page::Chat => icons::chat,
        Page::Students => icons::students,
        Page::Agents => icons::robot,
        Page::AgentHistory => icons::history,
        Page::Models => icons::model,
        Page::Skills => icons::skills,
        Page::Scheduler => icons::scheduler,
        Page::Rag => icons::rag,
        Page::Privacy => icons::privacy,
        Page::Settings => icons::sliders,
    }
}
