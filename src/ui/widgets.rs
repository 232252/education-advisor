//! Reusable hand-painted widgets. No external widget crates — every control is
//! drawn with egui's primitive painters for full visual control.
//!
//! The visual language mirrors the DeepSeek-style dark sci-fi reference:
//! translucent glass cards with hairline white borders, blue→purple gradient
//! primary buttons, cyan→purple section accent bars and 4 px slider tracks.

#![allow(dead_code)] // shared widget kit: controls are used across the evolving UI

use std::time::Instant;

use eframe::egui::{
    self, epaint, Align2, Color32, FontFamily, FontId, Pos2, Rect, Response, Rounding, Sense,
    Stroke, Ui, Vec2,
};

use crate::charts;
use crate::theme::Theme;

const CARD_RADIUS: f32 = 20.0;
const BUTTON_RADIUS: f32 = 20.0;
const GLOW_BUTTON_RADIUS: f32 = 16.0;

/// DeepSeek card shadow: rgba(0,0,0,0.4).
const CARD_SHADOW: Color32 = Color32::from_rgba_premultiplied(0, 0, 0, 102);
/// DeepSeek slider/progress track base: #1e293b.
const TRACK_BASE: Color32 = Color32::from_rgb(30, 41, 59);
/// DeepSeek agent-tag text color: #64748b.
const TAG_TEXT: Color32 = Color32::from_rgb(100, 116, 139);
/// DeepSeek agent-tag background: rgba(255,255,255,0.05).
const TAG_BG: Color32 = Color32::from_rgba_premultiplied(255, 255, 255, 13);
/// DeepSeek setting-row divider: rgba(255,255,255,0.03).
const ROW_DIVIDER: Color32 = Color32::from_rgba_premultiplied(255, 255, 255, 8);

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

fn make_shadow(offset: Vec2, blur: f32, color: Color32) -> epaint::Shadow {
    epaint::Shadow {
        offset,
        blur,
        spread: 0.0,
        color,
    }
}

/// Paint a vertical linear gradient inside a rounded rectangle using thin strips.
fn paint_rounded_vertical_gradient(
    ui: &mut Ui,
    rect: Rect,
    rounding: f32,
    top: Color32,
    bottom: Color32,
    steps: usize,
) {
    if rect.width() <= 0.0 || rect.height() <= 0.0 {
        return;
    }
    let steps = steps.max(2);
    let r = rounding.min(rect.height() / 2.0);
    let round = Rounding::same(rounding);

    // Base mid-tone to avoid any gaps between strips.
    ui.painter()
        .rect_filled(rect, round, Theme::lerp(top, bottom, 0.5));

    let top_rect = Rect::from_min_max(rect.min, Pos2::new(rect.max.x, rect.min.y + r));
    let bottom_rect = Rect::from_min_max(Pos2::new(rect.min.x, rect.max.y - r), rect.max);
    let mid_rect = Rect::from_min_max(
        Pos2::new(rect.min.x, top_rect.max.y),
        Pos2::new(rect.max.x, bottom_rect.min.y),
    );

    ui.painter().rect_filled(
        top_rect,
        Rounding {
            nw: rounding,
            ne: rounding,
            sw: 0.0,
            se: 0.0,
        },
        top,
    );
    ui.painter().rect_filled(
        bottom_rect,
        Rounding {
            nw: 0.0,
            ne: 0.0,
            sw: rounding,
            se: rounding,
        },
        bottom,
    );

    if mid_rect.height() > 0.0 {
        let strip_h = mid_rect.height() / steps as f32;
        for i in 0..steps {
            let y0 = mid_rect.min.y + i as f32 * strip_h;
            let y1 = y0 + strip_h;
            let t0 = i as f32 / steps as f32;
            let t1 = (i + 1) as f32 / steps as f32;
            let strip = Rect::from_min_max(
                Pos2::new(mid_rect.min.x, y0),
                Pos2::new(mid_rect.max.x, y1),
            );
            ui.painter().rect_filled(
                strip,
                Rounding::ZERO,
                Theme::lerp(top, bottom, (t0 + t1) / 2.0),
            );
        }
    }
}

/// Simulate a diffused drop shadow by drawing concentric translucent rounded rects.
fn paint_diffused_shadow(ui: &mut Ui, rect: Rect, offset: Vec2, blur: f32, color: Color32) {
    if color.a() == 0 || blur <= 0.0 {
        return;
    }
    let shadow_rect = rect.translate(offset);
    let steps = ((blur / 2.0) as usize).clamp(6, 20);
    for i in 0..steps {
        let t = i as f32 / steps as f32;
        let alpha = (color.a() as f32 * (1.0 - t * t)).max(0.0) as u8;
        if alpha == 0 {
            continue;
        }
        let c = Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), alpha);
        let expand = t * blur;
        let r = shadow_rect.expand(expand);
        let radius = (r.height().min(r.width()) / 2.0).min(CARD_RADIUS);
        ui.painter().rect_filled(r, Rounding::same(radius), c);
    }
}

/// Paint a vertical gradient inside a circle by drawing horizontal chords.
fn paint_circle_gradient(
    painter: &eframe::egui::Painter,
    center: Pos2,
    radius: f32,
    top: Color32,
    bottom: Color32,
    steps: usize,
) {
    let steps = steps.max(8);
    for i in 0..steps {
        let t0 = i as f32 / steps as f32;
        let t1 = (i + 1) as f32 / steps as f32;
        let color = Theme::lerp(top, bottom, (t0 + t1) / 2.0);
        let y0 = center.y - radius + t0 * radius * 2.0;
        let y1 = center.y - radius + t1 * radius * 2.0;
        let ym = (y0 + y1) / 2.0;
        let dy = (ym - center.y).abs();
        let half_w = (radius * radius - dy * dy).sqrt();
        if half_w > 0.0 && y1 > y0 {
            let strip = Rect::from_min_max(
                Pos2::new(center.x - half_w, y0),
                Pos2::new(center.x + half_w, y1),
            );
            painter.rect_filled(strip, Rounding::ZERO, color);
        }
    }
}

/// 通用卡片容器：毛玻璃背景 + 1px 发丝边框 + 20px 圆角 + 柔和阴影。
/// 默认不绘制顶部强调线（与 DeepSeek 参考一致）。
pub fn card(ui: &mut Ui, theme: &Theme, add: impl FnOnce(&mut Ui)) {
    glass_card_with_accent(ui, theme, None, add);
}

/// Semi-transparent glass card with a hairline border, 20 px rounding and a
/// diffused drop shadow.
pub fn glass_card(ui: &mut Ui, theme: &Theme, add: impl FnOnce(&mut Ui)) {
    glass_card_with_accent(ui, theme, None, add);
}

/// `glass_card` with an optional 2 px top accent line. By default no accent is
/// drawn — pass `Some(color)` only when an explicit accent line is desired.
pub fn glass_card_with_accent(
    ui: &mut Ui,
    theme: &Theme,
    accent: Option<Color32>,
    add: impl FnOnce(&mut Ui),
) {
    let available = ui.available_width();
    let frame = egui::Frame::none()
        .fill(theme.surface)
        .stroke(Stroke::new(1.0, theme.border))
        .rounding(Rounding::same(CARD_RADIUS))
        .inner_margin(egui::Margin::same(16.0))
        .shadow(make_shadow(Vec2::new(0.0, 4.0), 15.0, CARD_SHADOW));
    let response = frame.show(ui, |ui| {
        ui.set_width((available - 32.0).max(1.0));
        add(ui);
    });

    if let Some(accent) = accent {
        let rect = response.response.rect;
        ui.painter().line_segment(
            [
                Pos2::new(rect.min.x + 12.0, rect.min.y + 1.0),
                Pos2::new(rect.max.x - 12.0, rect.min.y + 1.0),
            ],
            Stroke::new(2.0, accent),
        );
    }
}

/// Glass card that visually lifts on hover: translates up 4 px, deepens the
/// shadow and switches the border to `border_strong`.
pub fn hover_lift_card(
    ui: &mut Ui,
    theme: &Theme,
    entrance: f32,
    add: impl FnOnce(&mut Ui),
) -> Response {
    let available = ui.available_width();
    let a = entrance.clamp(0.0, 1.0);
    let frame = egui::Frame::none()
        .fill(Color32::TRANSPARENT)
        .rounding(Rounding::same(CARD_RADIUS))
        .inner_margin(egui::Margin::same(16.0));
    let response = frame.show(ui, |ui| {
        let full_rect = ui.max_rect().expand2(Vec2::splat(16.0));
        let resp = ui.interact(full_rect, ui.id().with("hover_lift_card"), Sense::click());
        let hover = resp.hovered();

        // Translate up 4 px on hover (negative Y).
        let lift = if hover { -4.0 } else { 0.0 };
        let shadow_offset = Vec2::new(0.0, if hover { 10.0 } else { 4.0 });
        let shadow_blur = if hover { 30.0 } else { 15.0 };
        let bg_rect = full_rect.translate(Vec2::new(0.0, lift));

        let shadow_alpha = (CARD_SHADOW.a() as f32 * a) as u8;
        let shadow_color = Color32::from_rgba_premultiplied(0, 0, 0, shadow_alpha);
        paint_diffused_shadow(ui, bg_rect, shadow_offset, shadow_blur, shadow_color);

        let fill = Theme::lerp(Color32::TRANSPARENT, theme.surface, a);
        let border_base = if hover {
            theme.border_strong
        } else {
            theme.border
        };
        let border = Theme::lerp(Color32::TRANSPARENT, border_base, a);
        ui.painter()
            .rect_filled(bg_rect, Rounding::same(CARD_RADIUS), fill);
        ui.painter().rect_stroke(
            bg_rect,
            Rounding::same(CARD_RADIUS),
            Stroke::new(1.0, border),
        );

        let slide = (1.0 - a) * 8.0;
        let content_rect = bg_rect.shrink(16.0).translate(Vec2::new(0.0, slide));
        ui.allocate_ui_at_rect(content_rect, |ui| {
            ui.set_width((available - 32.0).max(1.0));
            add(ui);
        });

        resp
    });
    response.inner
}

/// DeepSeek-style KPI card: large 32 px bold accent-colored value on top, a
/// 13 px label with a tiny icon below, glass card background, hover lift.
/// No bottom accent strip (matches the reference).
#[allow(clippy::too_many_arguments)]
pub fn kpi_card(
    ui: &mut Ui,
    theme: &Theme,
    label: &str,
    value: &str,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
    accent: Color32,
    width: f32,
    entrance: f32,
) -> Response {
    let width = width.max(160.0);
    let a = entrance.clamp(0.0, 1.0);
    ui.allocate_ui_with_layout(
        Vec2::new(width, 0.0),
        egui::Layout::top_down(egui::Align::LEFT),
        |ui| {
            hover_lift_card(ui, theme, entrance, |ui| {
                ui.label(
                    egui::RichText::new(value)
                        .font(FontId::new(32.0, FontFamily::Name("Numbers".into())))
                        .strong()
                        .color(with_alpha(accent, a)),
                );
                ui.horizontal(|ui| {
                    let (icon_rect, _) =
                        ui.allocate_exact_size(Vec2::splat(14.0), Sense::hover());
                    icon(ui.painter(), icon_rect, theme);
                    ui.label(
                        egui::RichText::new(label)
                            .font(FontId::proportional(13.0))
                            .color(with_alpha(theme.text_dim, a)),
                    );
                });
            })
        },
    )
    .inner
}

/// A flat selectable list row.
pub fn list_item(
    ui: &mut Ui,
    theme: &Theme,
    height: f32,
    selected: bool,
    add: impl FnOnce(&mut Ui),
) -> Response {
    let width = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    let bg = if selected {
        theme.accent_dim
    } else if resp.hovered() {
        theme.surface_hover
    } else {
        Color32::TRANSPARENT
    };
    if bg != Color32::TRANSPARENT {
        ui.painter().rect_filled(rect, Rounding::same(10.0), bg);
    }
    if selected {
        let bar = Rect::from_min_size(rect.min, Vec2::new(3.0, rect.height()));
        ui.painter()
            .rect_filled(bar, Rounding::same(2.0), theme.accent);
    }
    ui.allocate_ui_at_rect(rect.shrink(10.0), add).response
}

// ---------------------------------------------------------------------------
// Typography helpers
// ---------------------------------------------------------------------------

/// Section/panel title: a 3 px × 14 px cyan→purple gradient bar followed by a
/// 15 px bold white title.
pub fn section_title(ui: &mut Ui, theme: &Theme, text: &str) {
    ui.horizontal(|ui| {
        let (rect, _) = ui.allocate_exact_size(Vec2::new(3.0, 14.0), Sense::hover());
        paint_rounded_vertical_gradient(ui, rect, 1.5, theme.cyan, theme.purple, 8);
        ui.label(
            egui::RichText::new(text)
                .font(FontId::proportional(15.0))
                .strong()
                .color(theme.text),
        );
    });
    ui.add_space(6.0);
}

/// Alias of `section_title` for panel headers — same gradient bar + bold title.
pub fn panel_title(ui: &mut Ui, theme: &Theme, text: &str) {
    section_title(ui, theme, text);
}

pub fn page_header(ui: &mut Ui, theme: &Theme, title: &str, subtitle: &str) {
    ui.horizontal(|ui| {
        ui.vertical(|ui| {
            ui.label(
                egui::RichText::new(title)
                    .font(FontId::proportional(20.0))
                    .strong()
                    .color(theme.text),
            );
            ui.label(
                egui::RichText::new(subtitle)
                    .font(FontId::proportional(11.0))
                    .color(theme.text_faint),
            );
        });
    });
    ui.add_space(12.0);
}

/// Horizontal group header: colored left bar + bold title + pill badge on the right.
pub fn group_header(ui: &mut Ui, theme: &Theme, color: Color32, title: &str, badge_text: &str) {
    let height = 24.0;
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
    let bar_rect = Rect::from_min_size(rect.min, Vec2::new(4.0, 20.0));
    ui.painter().rect_filled(bar_rect, Rounding::same(2.0), color);
    ui.painter().text(
        Pos2::new(rect.min.x + 12.0, rect.center().y),
        Align2::LEFT_CENTER,
        title,
        FontId::proportional(15.0),
        theme.text,
    );

    // Pill badge aligned to the right.
    let galley = ui
        .painter()
        .layout(badge_text.to_string(), FontId::proportional(11.0), color, 200.0);
    let pad = Vec2::new(8.0, 3.0);
    let badge_size = Vec2::new(galley.size().x + pad.x * 2.0, galley.size().y + pad.y * 2.0);
    let badge_rect = Rect::from_min_size(
        Pos2::new(
            rect.max.x - badge_size.x,
            rect.center().y - badge_size.y / 2.0,
        ),
        badge_size,
    );
    let bg = Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 35);
    ui.painter().rect_filled(badge_rect, Rounding::same(10.0), bg);
    ui.painter()
        .rect_stroke(badge_rect, Rounding::same(10.0), Stroke::new(1.0, color));
    ui.painter().galley(
        Pos2::new(badge_rect.min.x + pad.x, badge_rect.min.y + pad.y),
        galley,
        color,
    );
    ui.add_space(10.0);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

pub fn primary_button(ui: &mut Ui, theme: &Theme, text: &str) -> Response {
    let desired = button_size(ui, text, theme);
    let (rect, resp) = ui.allocate_exact_size(desired, Sense::click());
    paint_button_bg(ui, theme, rect, &resp, true, false);
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::proportional(13.0),
        Color32::WHITE,
    );
    resp
}

pub fn primary_button_sized(ui: &mut Ui, theme: &Theme, text: &str, width: f32) -> Response {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width.max(72.0), 34.0), Sense::click());
    paint_button_bg(ui, theme, rect, &resp, true, false);
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::proportional(13.0),
        Color32::WHITE,
    );
    resp
}

pub fn ghost_button(ui: &mut Ui, theme: &Theme, text: &str) -> Response {
    let desired = button_size(ui, text, theme);
    let (rect, resp) = ui.allocate_exact_size(desired, Sense::click());
    let hover = resp.hovered();
    ui.painter()
        .rect_filled(rect, Rounding::same(BUTTON_RADIUS), theme.surface);
    ui.painter().rect_stroke(
        rect,
        Rounding::same(BUTTON_RADIUS),
        Stroke::new(1.0, theme.border),
    );
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::proportional(13.0),
        if hover { theme.text } else { theme.text_dim },
    );
    resp
}

/// Premium blue→purple gradient button with a colored glow shadow. Visually
/// identical to `primary_button` — kept as a separate name for call-site intent.
pub fn glow_button(ui: &mut Ui, theme: &Theme, text: &str) -> Response {
    let desired = button_size(ui, text, theme);
    let (rect, resp) = ui.allocate_exact_size(desired, Sense::click());
    paint_button_bg(ui, theme, rect, &resp, true, false);
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::proportional(13.0),
        Color32::WHITE,
    );
    resp
}

pub fn danger_button(ui: &mut Ui, theme: &Theme, text: &str) -> Response {
    let desired = button_size(ui, text, theme);
    let (rect, resp) = ui.allocate_exact_size(desired, Sense::click());
    let hover = resp.hovered();
    let active = resp.is_pointer_button_down_on();
    let bg = if active {
        theme.danger
    } else if hover {
        Color32::from_rgb(220, 90, 90)
    } else {
        theme.translucent(theme.danger, 0.12)
    };
    ui.painter().rect_filled(rect, Rounding::same(BUTTON_RADIUS), bg);
    ui.painter()
        .rect_stroke(rect, Rounding::same(BUTTON_RADIUS), Stroke::new(1.0, theme.danger));
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::proportional(13.0),
        if active { Color32::WHITE } else { theme.danger },
    );
    resp
}

/// Icon-only button drawn with a vector icon painter.
pub fn icon_button(
    ui: &mut Ui,
    theme: &Theme,
    icon: fn(&eframe::egui::Painter, Rect, Color32),
    size: f32,
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
    ui.painter()
        .rect_filled(rect, Rounding::same(size / 4.0), bg);
    let color = if hover { theme.accent } else { theme.text_dim };
    icon(ui.painter(), rect.shrink(size * 0.22), color);
    resp
}

/// DeepSeek-style glass icon button: 40 px circle with a translucent glass
/// background, a hairline border and a centered color icon.
pub fn glass_icon_button(
    ui: &mut Ui,
    theme: &Theme,
    icon: fn(&eframe::egui::Painter, Rect, Color32),
    icon_color: Color32,
) -> Response {
    let size = 40.0;
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(size), Sense::click());
    let hover = resp.hovered();
    let fill = if hover { theme.surface_hover } else { theme.surface };
    let center = rect.center();
    let radius = size / 2.0;
    ui.painter().circle_filled(center, radius, fill);
    ui.painter().circle_stroke(
        center,
        radius,
        Stroke::new(1.0, if hover { theme.border_strong } else { theme.border }),
    );
    let inner = rect.shrink(size * 0.25);
    icon(ui.painter(), inner, icon_color);
    resp
}

/// Like `glass_icon_button` but for theme icons (`fn(&Painter, Rect, &Theme)`),
/// e.g. `icons::bolt` which picks its own color from the theme.
pub fn glass_icon_button_theme(
    ui: &mut Ui,
    theme: &Theme,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
) -> Response {
    let size = 40.0;
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(size), Sense::click());
    let hover = resp.hovered();
    let fill = if hover { theme.surface_hover } else { theme.surface };
    let center = rect.center();
    let radius = size / 2.0;
    ui.painter().circle_filled(center, radius, fill);
    ui.painter().circle_stroke(
        center,
        radius,
        Stroke::new(1.0, if hover { theme.border_strong } else { theme.border }),
    );
    let inner = rect.shrink(size * 0.25);
    icon(ui.painter(), inner, theme);
    resp
}

/// DeepSeek gradient primary button with a leading vector icon + label.
/// Mirrors `primary_button` styling (blue→purple gradient, pill shape, blue
/// glow shadow) but lays out an icon to the left of the text.
pub fn primary_button_with_icon(
    ui: &mut Ui,
    theme: &Theme,
    text: &str,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
) -> Response {
    let icon_size = 14.0;
    let gap = 8.0;
    let pad_x = 24.0;
    let pad_y = 10.0;
    let text_font = FontId::proportional(14.0);
    let galley = ui
        .painter()
        .layout(text.to_string(), text_font, Color32::WHITE, f32::INFINITY);
    let text_w = galley.size().x;
    let text_h = galley.size().y;
    let content_w = icon_size + gap + text_w;
    let total_w = content_w + pad_x * 2.0;
    let total_h = (text_h.max(icon_size) + pad_y * 2.0).max(40.0);
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(total_w, total_h), Sense::click());

    let hover = resp.hovered();
    let active = resp.is_pointer_button_down_on();
    let lift = if active { 1.0 } else if hover { -2.0 } else { 0.0 };
    let bg_rect = rect.translate(Vec2::new(0.0, -lift));

    // Blue glow shadow (brightens on hover).
    let shadow_alpha = if hover { 128 } else { 77 };
    let shadow_offset = Vec2::new(0.0, if hover { 8.0 } else { 4.0 });
    let shadow_blur = if hover { 25.0 } else { 15.0 };
    let shadow_color = Color32::from_rgba_premultiplied(59, 130, 246, shadow_alpha);
    paint_diffused_shadow(ui, bg_rect, shadow_offset, shadow_blur, shadow_color);

    // Gradient fill (blue → purple) with pill rounding.
    paint_rounded_vertical_gradient(
        ui,
        bg_rect,
        40.0,
        theme.gradient_primary_from,
        theme.gradient_primary_to,
        16,
    );

    // Icon + text centered as a group.
    let start_x = bg_rect.center().x - content_w / 2.0;
    let center_y = bg_rect.center().y;
    let icon_rect = Rect::from_center_size(
        Pos2::new(start_x + icon_size / 2.0, center_y),
        Vec2::splat(icon_size),
    );
    icon(ui.painter(), icon_rect, theme);
    ui.painter().galley(
        Pos2::new(start_x + icon_size + gap, center_y - text_h / 2.0),
        galley,
        Color32::WHITE,
    );

    resp
}

/// Toolbar button with icon + label.
pub fn tool_button(
    ui: &mut Ui,
    theme: &Theme,
    label: &str,
    icon: fn(&eframe::egui::Painter, Rect, Color32),
) -> Response {
    let desired = tool_button_size(ui, label, theme);
    let (rect, resp) = ui.allocate_exact_size(desired, Sense::click());
    let hover = resp.hovered();
    let active = resp.is_pointer_button_down_on();
    let bg = if active {
        theme.accent_dim
    } else if hover {
        theme.surface_hover
    } else {
        Color32::TRANSPARENT
    };
    let radius = 10.0;
    if bg != Color32::TRANSPARENT {
        ui.painter().rect_filled(rect, Rounding::same(radius), bg);
    }
    ui.painter()
        .rect_stroke(rect, Rounding::same(radius), Stroke::new(1.0, theme.border));
    let icon_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + 10.0, rect.min.y + 7.0),
        Vec2::splat(18.0),
    );
    let color = if hover { theme.accent } else { theme.text_dim };
    icon(ui.painter(), icon_rect, color);
    ui.painter().text(
        Pos2::new(rect.min.x + 34.0, rect.center().y),
        Align2::LEFT_CENTER,
        label,
        FontId::proportional(12.0),
        if hover { theme.text } else { theme.text_dim },
    );
    resp
}

/// Paint a DeepSeek gradient primary button background: linear gradient
/// (#3b82f6 → #8b5cf6), 20 px rounding, blue glow shadow that brightens on
/// hover (rgba 0.3 → 0.5, offset 4→8, blur 15→25).
fn paint_button_bg(
    ui: &mut Ui,
    theme: &Theme,
    rect: Rect,
    resp: &Response,
    primary: bool,
    _danger: bool,
) {
    let hover = resp.hovered();
    let active = resp.is_pointer_button_down_on();
    if primary {
        let lift = if active { 1.0 } else if hover { -2.0 } else { 0.0 };
        let bg_rect = rect.translate(Vec2::new(0.0, -lift));

        let shadow_alpha = if hover { 128 } else { 77 }; // 0.5 / 0.3
        let shadow_offset = Vec2::new(0.0, if hover { 8.0 } else { 4.0 });
        let shadow_blur = if hover { 25.0 } else { 15.0 };
        let shadow_color = Color32::from_rgba_premultiplied(59, 130, 246, shadow_alpha);
        paint_diffused_shadow(ui, bg_rect, shadow_offset, shadow_blur, shadow_color);

        paint_rounded_vertical_gradient(
            ui,
            bg_rect,
            BUTTON_RADIUS,
            theme.gradient_primary_from,
            theme.gradient_primary_to,
            16,
        );
    } else {
        let bg = if active {
            theme.accent_dim
        } else if hover {
            theme.translucent(theme.accent, 0.10)
        } else {
            theme.surface
        };
        ui.painter().rect_filled(rect, Rounding::same(BUTTON_RADIUS), bg);
        ui.painter().rect_stroke(
            rect,
            Rounding::same(BUTTON_RADIUS),
            Stroke::new(1.0, if hover { theme.border_strong } else { theme.border }),
        );
    }
}

fn button_size(ui: &Ui, text: &str, theme: &Theme) -> Vec2 {
    let galley = ui.painter().layout(
        text.to_string(),
        FontId::proportional(13.0),
        theme.text,
        f32::INFINITY,
    );
    let w = (galley.size().x + 32.0).max(72.0);
    Vec2::new(w, 34.0)
}

fn tool_button_size(ui: &Ui, text: &str, theme: &Theme) -> Vec2 {
    let galley = ui.painter().layout(
        text.to_string(),
        FontId::proportional(12.0),
        theme.text,
        f32::INFINITY,
    );
    Vec2::new(galley.size().x + 48.0, 32.0)
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

/// A styled single-line text input painted on top of a custom rounded background.
pub fn text_input(
    ui: &mut Ui,
    theme: &Theme,
    text: &mut String,
    hint: &str,
    width: f32,
) -> Response {
    let height = 34.0;
    let (rect, mut resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    paint_input_bg(ui, theme, rect, resp.hovered() || resp.has_focus());
    let lay_rect = rect.shrink2(Vec2::new(12.0, 6.0));
    let edit = egui::TextEdit::singleline(text)
        .desired_width(lay_rect.width())
        .hint_text(hint)
        .margin(egui::Vec2::ZERO)
        .text_color(theme.text);
    let mut inner = ui.child_ui(lay_rect, egui::Layout::left_to_right(egui::Align::Center));
    let inner_resp = inner.add(edit);
    if resp.clicked() {
        inner_resp.request_focus();
    }
    resp = resp.union(inner_resp);
    resp
}

pub fn text_input_multiline(
    ui: &mut Ui,
    theme: &Theme,
    text: &mut String,
    hint: &str,
    width: f32,
    rows: usize,
) -> Response {
    let min_h = ((rows as f32).mul_add(20.0, 20.0)).max(60.0);
    let (rect, mut resp) = ui.allocate_exact_size(Vec2::new(width, min_h), Sense::click());
    paint_input_bg(ui, theme, rect, resp.hovered() || resp.has_focus());
    let lay_rect = rect.shrink2(Vec2::new(12.0, 8.0));
    let edit = egui::TextEdit::multiline(text)
        .desired_width(lay_rect.width())
        .desired_rows(rows)
        .hint_text(hint)
        .margin(egui::Vec2::ZERO)
        .text_color(theme.text);
    let mut inner = ui.child_ui(lay_rect, egui::Layout::top_down(egui::Align::LEFT));
    let inner_resp = inner.add(edit);
    if resp.clicked() {
        inner_resp.request_focus();
    }
    resp = resp.union(inner_resp);
    resp
}

/// A search input with a magnifying glass vector icon.
pub fn search_input(
    ui: &mut Ui,
    theme: &Theme,
    text: &mut String,
    hint: &str,
    width: f32,
) -> Response {
    let height = 34.0;
    let (rect, mut resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    paint_input_bg(ui, theme, rect, resp.hovered() || resp.has_focus());
    let icon_w = 28.0;
    let icon_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + 6.0, rect.min.y + 5.0),
        Vec2::splat(height - 10.0),
    );
    crate::ui::icons::search(ui.painter(), icon_rect, theme);
    let lay_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + icon_w, rect.min.y + 6.0),
        Vec2::new(rect.width() - icon_w - 12.0, rect.height() - 12.0),
    );
    let edit = egui::TextEdit::singleline(text)
        .desired_width(lay_rect.width())
        .hint_text(hint)
        .margin(egui::Vec2::ZERO)
        .text_color(theme.text);
    let mut inner = ui.child_ui(lay_rect, egui::Layout::left_to_right(egui::Align::Center));
    let inner_resp = inner.add(edit);
    if resp.clicked() {
        inner_resp.request_focus();
    }
    resp = resp.union(inner_resp);
    resp
}

/// A numeric input with +/- step buttons.
pub fn number_input<T>(
    ui: &mut Ui,
    theme: &Theme,
    value: &mut T,
    range: std::ops::RangeInclusive<T>,
    width: f32,
) -> Response
where
    T: egui::emath::Numeric
        + std::fmt::Display
        + std::ops::Add<Output = T>
        + std::ops::Sub<Output = T>
        + PartialOrd
        + Copy,
{
    let height = 34.0;
    let total_w = width.max(120.0);
    let (rect, mut resp) = ui.allocate_exact_size(Vec2::new(total_w, height), Sense::click());
    paint_input_bg(ui, theme, rect, resp.hovered() || resp.has_focus());

    let btn_w = 30.0;
    let inner_w = total_w - btn_w * 2.0 - 4.0;
    let left_btn = Rect::from_min_size(rect.min, Vec2::new(btn_w, height));
    let right_btn = Rect::from_min_size(
        Pos2::new(rect.max.x - btn_w, rect.min.y),
        Vec2::new(btn_w, height),
    );
    let center_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + btn_w + 2.0, rect.min.y + 6.0),
        Vec2::new(inner_w, height - 12.0),
    );

    let left_resp = step_button(ui, theme, left_btn, "−");
    let right_resp = step_button(ui, theme, right_btn, "+");

    let mut text = format!("{value:.2}");
    let edit = egui::TextEdit::singleline(&mut text)
        .desired_width(center_rect.width())
        .margin(egui::Vec2::ZERO)
        .text_color(theme.text)
        .horizontal_align(egui::Align::Center);
    let mut inner = ui.child_ui(
        center_rect,
        egui::Layout::left_to_right(egui::Align::Center),
    );
    let inner_resp = inner.add(edit);
    if let Ok(v) = text.parse::<f64>() {
        let parsed = T::from_f64(v);
        if parsed >= *range.start() && parsed <= *range.end() {
            *value = parsed;
        }
    }

    if left_resp.clicked() {
        let next = *value - T::from_f64(1.0);
        if next >= *range.start() {
            *value = next;
        }
    }
    if right_resp.clicked() {
        let next = *value + T::from_f64(1.0);
        if next <= *range.end() {
            *value = next;
        }
    }

    if resp.clicked() {
        inner_resp.request_focus();
    }
    resp = resp.union(inner_resp).union(left_resp).union(right_resp);
    resp
}

fn step_button(ui: &mut Ui, theme: &Theme, rect: Rect, label: &str) -> Response {
    let (_, resp) = ui.allocate_exact_size(rect.size(), Sense::click());
    let hover = resp.hovered();
    let active = resp.is_pointer_button_down_on();
    let bg = if active {
        theme.accent_dim
    } else if hover {
        theme.surface_hover
    } else {
        Color32::TRANSPARENT
    };
    ui.painter().rect_filled(rect, Rounding::same(8.0), bg);
    ui.painter().text(
        rect.center(),
        Align2::CENTER_CENTER,
        label,
        FontId::proportional(14.0),
        if hover { theme.accent } else { theme.text_dim },
    );
    resp
}

fn paint_input_bg(ui: &mut Ui, theme: &Theme, rect: Rect, focused: bool) {
    let fill = theme.surface;
    let stroke = if focused { theme.accent } else { theme.border };
    ui.painter().rect_filled(rect, Rounding::same(10.0), fill);
    ui.painter()
        .rect_stroke(rect, Rounding::same(10.0), Stroke::new(1.0, stroke));
}

/// A hand-painted toggle switch. The "on" track uses the blue→purple gradient.
/// The returned response is marked changed on click.
pub fn toggle_switch(ui: &mut Ui, theme: &Theme, value: &mut bool) -> Response {
    let width = 44.0;
    let height = 24.0;
    let (rect, mut resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    if resp.clicked() {
        *value = !*value;
        resp.mark_changed();
    }
    let on = *value;
    if on {
        paint_rounded_vertical_gradient(
            ui,
            rect,
            height / 2.0,
            theme.gradient_primary_from,
            theme.gradient_primary_to,
            8,
        );
    } else {
        ui.painter()
            .rect_filled(rect, Rounding::same(height / 2.0), theme.border);
    }
    let margin = 3.0;
    let thumb_r = (height - margin * 2.0) / 2.0;
    let thumb_x = if on {
        rect.max.x - margin - thumb_r
    } else {
        rect.min.x + margin + thumb_r
    };
    let center_y = rect.center().y;
    ui.painter()
        .circle_filled(Pos2::new(thumb_x, center_y), thumb_r, Color32::WHITE);
    resp
}

/// A small segmented tab switcher.
pub fn tab_switcher(ui: &mut Ui, theme: &Theme, tabs: &[&str], active: usize) -> Option<usize> {
    let height = 32.0;
    // Bug #13 — 窄屏不滚动：当 tab 总宽度超过可用宽度时，套一层水平
    // ScrollArea 防止标签被截断（4 个中文 tab + 边框在 360px 屏宽下就会撞墙）。
    let total_w = ui.available_width();
    let outer = ui
        .allocate_ui_with_layout(
            Vec2::new(total_w, height),
            egui::Layout::left_to_right(egui::Align::Center),
            |ui| {
                egui::ScrollArea::horizontal()
                    .id_source("tab_switcher_scroll")
                    .max_height(height)
                    .auto_shrink([false, true])
                    .show(ui, |ui| {
                        let (rect, _) =
                            ui.allocate_exact_size(Vec2::new(total_w, height), Sense::hover());
                        ui.painter()
                            .rect_filled(rect, Rounding::same(8.0), theme.surface);
                        let count = tabs.len();
                        let tab_w = total_w / count.max(1) as f32;
                        let mut changed = None;
                        for (i, label) in tabs.iter().enumerate() {
                            let tr = Rect::from_min_size(
                                Pos2::new((i as f32).mul_add(tab_w, rect.min.x), rect.min.y),
                                Vec2::new(tab_w, height),
                            );
                            let (_, resp) = ui.allocate_exact_size(tr.size(), Sense::click());
                            if i == active {
                                ui.painter().rect_filled(
                                    tr.shrink(2.0),
                                    Rounding::same(6.0),
                                    theme.bg_elevated,
                                );
                                ui.painter().rect_stroke(
                                    tr.shrink(2.0),
                                    Rounding::same(6.0),
                                    Stroke::new(1.0, theme.border),
                                );
                            } else if resp.hovered() {
                                ui.painter().rect_filled(
                                    tr.shrink(2.0),
                                    Rounding::same(6.0),
                                    theme.surface_hover,
                                );
                            }
                            if resp.clicked() {
                                changed = Some(i);
                            }
                            ui.painter().text(
                                tr.center(),
                                Align2::CENTER_CENTER,
                                *label,
                                FontId::proportional(12.0),
                                if i == active {
                                    theme.text
                                } else {
                                    theme.text_dim
                                },
                            );
                        }
                        changed
                    })
                    .inner
            },
        )
        .inner;
    outer
}

/// A hand-painted dropdown selector. Returns Some(index) when selection changes.
pub fn dropdown_select(
    ui: &mut Ui,
    theme: &Theme,
    id: impl std::hash::Hash,
    selected_text: &str,
    items: &[&str],
) -> Option<usize> {
    let popup_id = ui.make_persistent_id(id);
    let (rect, resp) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), 34.0), Sense::click());
    let open = ui.memory(|mem| mem.is_popup_open(popup_id));
    paint_input_bg(ui, theme, rect, open || resp.hovered() || resp.has_focus());
    ui.painter().text(
        Pos2::new(rect.min.x + 12.0, rect.center().y),
        Align2::LEFT_CENTER,
        selected_text,
        FontId::proportional(13.0),
        theme.text,
    );
    let chevron_rect = Rect::from_min_size(
        Pos2::new(rect.max.x - 22.0, rect.center().y - 5.0),
        Vec2::splat(10.0),
    );
    crate::ui::icons::chevron_down(ui.painter(), chevron_rect, theme.text_dim);
    if resp.clicked() {
        ui.memory_mut(|mem| mem.toggle_popup(popup_id));
    }
    let mut selected = None;
    egui::popup_below_widget(ui, popup_id, &resp, |ui| {
        ui.set_min_width(rect.width());
        for (i, item) in items.iter().enumerate() {
            if ui.selectable_label(false, *item).clicked() {
                selected = Some(i);
                ui.memory_mut(eframe::egui::Memory::close_popup);
            }
        }
    });
    selected
}

/// A dropdown with a label on the left.
pub fn labeled_dropdown(
    ui: &mut Ui,
    theme: &Theme,
    id: impl std::hash::Hash,
    label: &str,
    selected_text: &str,
    items: &[&str],
) -> Option<usize> {
    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(label)
                .font(FontId::proportional(13.0))
                .color(theme.text_dim),
        );
        dropdown_select(ui, theme, id, selected_text, items)
    })
    .inner
}

/// A simple horizontal slider with value display.
pub fn slider_f32(
    ui: &mut Ui,
    theme: &Theme,
    value: &mut f32,
    range: std::ops::RangeInclusive<f32>,
    width: f32,
) -> Response {
    let height = 24.0;
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    let min = *range.start();
    let max = *range.end();
    let frac = if (max - min).abs() > f32::EPSILON {
        ((*value - min) / (max - min)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // track
    let track_h = 4.0;
    let track_y = rect.center().y;
    let track_rect = Rect::from_min_size(
        Pos2::new(rect.min.x, track_y - track_h / 2.0),
        Vec2::new(rect.width().max(1.0), track_h),
    );
    ui.painter()
        .rect_filled(track_rect, Rounding::same(track_h / 2.0), TRACK_BASE);
    let fill_rect = Rect::from_min_size(
        track_rect.min,
        Vec2::new(track_rect.width() * frac, track_h),
    );
    paint_rounded_vertical_gradient(
        ui,
        fill_rect,
        track_h / 2.0,
        theme.gradient_primary_to,
        theme.gradient_primary_from,
        8,
    );

    // thumb
    let thumb_r = 8.0;
    let thumb_x = rect.min.x + frac * rect.width().max(1.0);
    ui.painter()
        .circle_filled(Pos2::new(thumb_x, track_y), thumb_r, theme.accent);
    ui.painter().circle_filled(
        Pos2::new(thumb_x, track_y),
        thumb_r - 3.0,
        theme.bg_elevated,
    );

    // value text
    ui.painter().text(
        Pos2::new(rect.max.x + 8.0, rect.center().y),
        Align2::LEFT_CENTER,
        format!("{value:.2}"),
        FontId::proportional(12.0),
        theme.text,
    );

    if resp.dragged() {
        if let Some(pos) = resp.interact_pointer_pos() {
            let new_frac = ((pos.x - rect.min.x) / rect.width().max(1.0)).clamp(0.0, 1.0);
            *value = min + new_frac * (max - min);
        }
    }
    resp
}

/// A simple progress bar.
pub fn progress_bar(ui: &mut Ui, _theme: &Theme, frac: f32, height: f32, color: Color32) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width().max(1.0), height), Sense::hover());
    ui.painter()
        .rect_filled(rect, Rounding::same(height / 2.0), TRACK_BASE);
    let fill_w = rect.width() * frac.clamp(0.0, 1.0);
    if fill_w > 0.0 {
        let fill = Rect::from_min_size(rect.min, Vec2::new(fill_w, rect.height()));
        ui.painter()
            .rect_filled(fill, Rounding::same(height / 2.0), color);
    }
}

/// Rounded capsule progress bar with a 4 px `#1e293b` track, a gradient fill
/// and an optional percentage label.
pub fn capsule_progress(
    ui: &mut Ui,
    theme: &Theme,
    value: f32,
    max: f32,
    color: Color32,
    show_percent: bool,
) {
    let track_h = 4.0;
    let row_h = if show_percent { 16.0 } else { track_h };
    let text_w = if show_percent { 40.0 } else { 0.0 };
    let track_w = (ui.available_width() - text_w - 8.0).max(20.0);
    let (rect, _) = ui.allocate_exact_size(Vec2::new(track_w, row_h), Sense::hover());

    // Task 9 — 600 ms 生长动画。
    let anim_id = ui.id().with("capsule_progress_anim");
    let start = ui
        .ctx()
        .memory_mut(|mem| *mem.data.get_temp_mut_or_insert_with(anim_id, Instant::now));
    let animated_value = charts::animated_value(value, start.elapsed().as_millis() as f32);

    let frac = if max > 0.0 {
        (animated_value / max).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let track_y = rect.center().y;
    let track_rect = Rect::from_min_size(
        Pos2::new(rect.min.x, track_y - track_h / 2.0),
        Vec2::new(track_w, track_h),
    );
    ui.painter()
        .rect_filled(track_rect, Rounding::same(track_h / 2.0), TRACK_BASE);

    let fill_w = track_rect.width() * frac;
    if fill_w > 0.0 {
        let fill_rect = Rect::from_min_size(track_rect.min, Vec2::new(fill_w, track_h));
        let light = Theme::lerp(color, Color32::WHITE, 0.25);
        paint_rounded_vertical_gradient(ui, fill_rect, track_h / 2.0, light, color, 8);
    }

    if show_percent {
        let percent = (frac * 100.0) as i32;
        ui.painter().text(
            Pos2::new(rect.max.x + 8.0, rect.center().y),
            Align2::LEFT_CENTER,
            format!("{percent}%"),
            FontId::proportional(11.0),
            theme.text_dim,
        );
    }
}

/// Custom DeepSeek-style slider: 4 px `#1e293b` track with a gradient fill and
/// a 16 px cyan→blue gradient thumb with a blue glow.
pub fn custom_slider(
    ui: &mut Ui,
    theme: &Theme,
    value: &mut f32,
    range: std::ops::RangeInclusive<f32>,
    label_width: f32,
    value_text: &str,
) -> (Response, bool) {
    let min = *range.start();
    let max = *range.end();
    let old_value = *value;
    let height = 24.0;
    let value_w = label_width.max(40.0);
    let track_w = (ui.available_width() - value_w - 8.0).max(40.0);
    let (rect, mut resp) = ui.allocate_exact_size(Vec2::new(track_w, height), Sense::click());
    let frac = if (max - min).abs() > f32::EPSILON {
        ((*value - min) / (max - min)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Track (4 px, #1e293b).
    let track_h = 4.0;
    let track_y = rect.center().y;
    let track_rect = Rect::from_min_max(
        Pos2::new(rect.min.x, track_y - track_h / 2.0),
        Pos2::new(rect.max.x, track_y + track_h / 2.0),
    );
    ui.painter()
        .rect_filled(track_rect, Rounding::same(track_h / 2.0), TRACK_BASE);
    let fill_w = (track_rect.width() * frac).max(0.0);
    let fill_rect = Rect::from_min_max(
        track_rect.min,
        Pos2::new(track_rect.min.x + fill_w, track_rect.max.y),
    );
    paint_rounded_vertical_gradient(
        ui,
        fill_rect,
        track_h / 2.0,
        theme.gradient_primary_to,
        theme.gradient_primary_from,
        8,
    );

    // Thumb (16 px diameter) with cyan→blue gradient + blue glow.
    let thumb_r = 8.0; // diameter 16
    let thumb_x = rect.min.x + frac * rect.width().max(1.0);
    let thumb_center = Pos2::new(thumb_x, track_y);
    let glow = Color32::from_rgba_premultiplied(59, 130, 246, 102); // rgba(59,130,246,0.4)
    ui.painter()
        .circle_filled(thumb_center, thumb_r + 5.0, glow);
    paint_circle_gradient(
        ui.painter(),
        thumb_center,
        thumb_r,
        theme.cyan,
        theme.accent,
        16,
    );

    // Value text
    ui.painter().text(
        Pos2::new(rect.max.x + 8.0, rect.center().y),
        Align2::LEFT_CENTER,
        value_text,
        FontId::new(12.0, FontFamily::Name("Numbers".into())),
        theme.accent,
    );

    if resp.dragged() {
        if let Some(pos) = resp.interact_pointer_pos() {
            let new_frac = ((pos.x - rect.min.x) / rect.width().max(1.0)).clamp(0.0, 1.0);
            *value = min + new_frac * (max - min);
        }
    }

    let changed = (*value - old_value).abs() > f32::EPSILON;
    if changed {
        resp.mark_changed();
    }
    (resp, changed)
}

// ---------------------------------------------------------------------------
// Badges, pills, tags, empty state, stat card
// ---------------------------------------------------------------------------

pub fn badge(ui: &mut Ui, _theme: &Theme, text: &str, color: Color32) -> Response {
    let pad_x = 8.0;
    let pad_y = 3.0;
    let galley = ui
        .painter()
        .layout(text.to_string(), FontId::proportional(11.0), color, 200.0);
    let size = Vec2::new(galley.size().x + pad_x * 2.0, galley.size().y + pad_y * 2.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    let bg = Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 35);
    ui.painter().rect_filled(rect, Rounding::same(10.0), bg);
    ui.painter()
        .rect_stroke(rect, Rounding::same(10.0), Stroke::new(1.0, color));
    ui.painter().galley(
        Pos2::new(
            rect.center().x - galley.size().x / 2.0,
            rect.center().y - galley.size().y / 2.0,
        ),
        galley,
        color,
    );
    resp
}

pub fn status_pill(ui: &mut Ui, _theme: &Theme, label: &str, color: Color32) -> Response {
    let galley = ui
        .painter()
        .layout(label.to_string(), FontId::proportional(12.0), color, 200.0);
    let pad = Vec2::new(10.0, 5.0);
    let dot_w = 14.0;
    let size = Vec2::new(
        pad.x.mul_add(2.0, galley.size().x) + dot_w,
        pad.y.mul_add(2.0, galley.size().y),
    );
    let (rect, resp) = ui.allocate_exact_size(size, egui::Sense::hover());
    let bg = Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 18);
    ui.painter().rect_filled(rect, 8.0, bg);
    ui.painter().rect_stroke(
        rect,
        8.0,
        Stroke::new(
            1.0,
            Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 50),
        ),
    );
    ui.painter().circle_filled(
        Pos2::new(rect.min.x + pad.x + 4.0, rect.center().y),
        4.0,
        color,
    );
    ui.painter().galley(
        Pos2::new(rect.min.x + pad.x + dot_w, rect.min.y + pad.y),
        galley,
        color,
    );
    resp
}

/// DeepSeek-style agent tag: a small pill with `rgba(255,255,255,0.05)`
/// background, 20 px rounding, 11 px `#64748b` text and 4 px × 12 px padding.
pub fn agent_tag(ui: &mut Ui, _theme: &Theme, text: &str) -> Response {
    let pad_x = 12.0;
    let pad_y = 4.0;
    let galley = ui
        .painter()
        .layout(text.to_string(), FontId::proportional(11.0), TAG_TEXT, 200.0);
    let size = Vec2::new(galley.size().x + pad_x * 2.0, galley.size().y + pad_y * 2.0);
    let (rect, resp) = ui.allocate_exact_size(size, Sense::hover());
    ui.painter().rect_filled(rect, Rounding::same(20.0), TAG_BG);
    ui.painter().galley(
        Pos2::new(
            rect.center().x - galley.size().x / 2.0,
            rect.center().y - galley.size().y / 2.0,
        ),
        galley,
        TAG_TEXT,
    );
    resp
}

pub fn empty_state(
    ui: &mut Ui,
    theme: &Theme,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
    text: &str,
) {
    ui.vertical_centered(|ui| {
        ui.add_space(40.0);
        let (rect, _) = ui.allocate_exact_size(Vec2::splat(64.0), Sense::hover());
        icon(ui.painter(), rect, theme);
        ui.add_space(10.0);
        ui.label(
            egui::RichText::new(text)
                .font(FontId::proportional(14.0))
                .color(theme.text_faint),
        );
        ui.add_space(40.0);
    });
}

/// Centered empty state with a 72 px icon, title, subtitle and a gradient CTA button.
pub fn empty_state_with_cta(
    ui: &mut Ui,
    theme: &Theme,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
    title: &str,
    subtitle: &str,
    cta_text: &str,
    cta_callback: impl FnOnce(),
) {
    ui.vertical_centered(|ui| {
        ui.add_space(40.0);
        let (rect, _) = ui.allocate_exact_size(Vec2::splat(72.0), Sense::hover());
        icon(ui.painter(), rect, theme);
        ui.add_space(16.0);
        ui.label(
            egui::RichText::new(title)
                .font(FontId::proportional(16.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(8.0);
        ui.label(
            egui::RichText::new(subtitle)
                .font(FontId::proportional(12.0))
                .color(theme.text_dim),
        );
        ui.add_space(20.0);
        if glow_button(ui, theme, cta_text).clicked() {
            cta_callback();
        }
        ui.add_space(40.0);
    });
}

pub fn stat_card(
    ui: &mut Ui,
    theme: &Theme,
    label: &str,
    value: &str,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
    accent: Color32,
    width: f32,
) -> Response {
    let width = width.max(120.0);
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, 92.0), Sense::hover());
    ui.painter()
        .rect_filled(rect, Rounding::same(CARD_RADIUS), theme.surface);
    ui.painter()
        .rect_stroke(rect, Rounding::same(CARD_RADIUS), Stroke::new(1.0, theme.border));
    let orb = Rect::from_min_size(
        Pos2::new(rect.max.x - 44.0, rect.min.y - 8.0),
        Vec2::splat(52.0),
    );
    let orb_color = Color32::from_rgba_premultiplied(accent.r(), accent.g(), accent.b(), 25);
    ui.painter().circle_filled(orb.center(), 26.0, orb_color);
    let icon_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + 14.0, rect.min.y + 14.0),
        Vec2::splat(40.0),
    );
    let icon_bg = Color32::from_rgba_premultiplied(accent.r(), accent.g(), accent.b(), 30);
    ui.painter()
        .rect_filled(icon_rect, Rounding::same(12.0), icon_bg);
    icon(ui.painter(), icon_rect.shrink(9.0), theme);
    ui.painter().text(
        Pos2::new(rect.min.x + 14.0, rect.max.y - 14.0),
        Align2::LEFT_BOTTOM,
        value,
        FontId::proportional(24.0),
        theme.text,
    );
    ui.painter().text(
        Pos2::new(rect.max.x - 14.0, rect.max.y - 14.0),
        Align2::RIGHT_BOTTOM,
        label,
        FontId::proportional(11.0),
        theme.text_dim,
    );
    resp
}

/// DeepSeek-style settings row: title + subtitle on the left, arbitrary right
/// content (switch, dropdown, …) aligned to the right, separated by a faint
/// `rgba(255,255,255,0.03)` bottom border with 16 px vertical padding.
pub fn setting_row(
    ui: &mut Ui,
    theme: &Theme,
    title: &str,
    subtitle: &str,
    right_content: impl FnOnce(&mut Ui),
) {
    ui.add_space(16.0);
    let width = ui.available_width();
    ui.allocate_ui_with_layout(
        Vec2::new(width, 0.0),
        egui::Layout::left_to_right(egui::Align::Center),
        |ui| {
            ui.set_min_width(width);
            ui.vertical(|ui| {
                ui.label(
                    egui::RichText::new(title)
                        .font(FontId::proportional(14.0))
                        .color(theme.text),
                );
                if !subtitle.is_empty() {
                    ui.label(
                        egui::RichText::new(subtitle)
                            .font(FontId::proportional(11.0))
                            .color(theme.text_faint),
                    );
                }
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                right_content(ui);
            });
        },
    );
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 1.0), Sense::hover());
    ui.painter().rect_filled(rect, 0.0, ROW_DIVIDER);
}

// ---------------------------------------------------------------------------
// Checkbox / radio helpers
// ---------------------------------------------------------------------------

pub fn checkbox(ui: &mut Ui, theme: &Theme, value: &mut bool, label: &str) -> Response {
    let size = 18.0;
    let (rect, resp) = ui.allocate_exact_size(Vec2::splat(size), Sense::click());
    if resp.clicked() {
        *value = !*value;
    }
    ui.painter()
        .rect_filled(rect, Rounding::same(5.0), theme.surface);
    ui.painter().rect_stroke(
        rect,
        Rounding::same(5.0),
        Stroke::new(1.5, if *value { theme.accent } else { theme.border }),
    );
    if *value {
        let pad = 4.0;
        let check = rect.shrink(pad);
        ui.painter()
            .rect_filled(check, Rounding::same(3.0), theme.accent);
    }
    if !label.is_empty() {
        ui.painter().text(
            Pos2::new(rect.max.x + 8.0, rect.center().y),
            Align2::LEFT_CENTER,
            label,
            FontId::proportional(13.0),
            theme.text,
        );
    }
    resp
}

// ---------------------------------------------------------------------------
// Navigation rail item
// ---------------------------------------------------------------------------

/// A single item for a left navigation rail. `expanded` controls label visibility.
pub fn nav_item(
    ui: &mut Ui,
    theme: &Theme,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
    label: &str,
    active: bool,
    expanded: f32,
    badge: Option<&str>,
) -> Response {
    let height = 44.0;
    let width = ui.available_width().max(48.0);
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    let hover = resp.hovered();

    let bg = if active {
        theme.accent_bg
    } else if hover {
        theme.surface_hover
    } else {
        Color32::TRANSPARENT
    };
    ui.painter().rect_filled(rect, Rounding::same(11.0), bg);

    // Task 9 — 侧边栏活动指示条：active 时加宽并加深颜色，伴随平滑过渡。
    if active || hover {
        let anim_id = ui.id().with("nav_indicator");
        let active_t = ui
            .ctx()
            .animate_value_with_time(anim_id, if active { 1.0 } else { 0.0 }, 0.18);
        let bar_w = 3.0 + active_t * 2.0;
        let bar_color = Theme::lerp(theme.accent_dim, theme.accent_strong, active_t);
        let bar = Rect::from_min_size(rect.min, Vec2::new(bar_w, rect.height()));
        ui.painter().rect_filled(bar, Rounding::same(2.0), bar_color);
    }

    let collapsed = expanded < 0.5;
    let icon_x = if collapsed {
        rect.center().x
    } else {
        rect.min.x + 22.0
    };
    let center_y = rect.center().y;
    let _icon_color = if active {
        theme.accent
    } else if hover {
        theme.text
    } else {
        theme.text_dim
    };
    let icon_size = if collapsed { 22.0 } else { 19.0 };
    let icon_rect = Rect::from_center_size(Pos2::new(icon_x, center_y), Vec2::splat(icon_size));
    icon(ui.painter(), icon_rect, theme);

    if !collapsed {
        let alpha = expanded.clamp(0.0, 1.0);
        let color = if active || hover {
            theme.text
        } else {
            theme.text_dim
        };
        let c = with_alpha(color, alpha);
        ui.painter().text(
            Pos2::new(icon_x + 18.0, center_y),
            Align2::LEFT_CENTER,
            label,
            FontId::proportional(13.0),
            c,
        );
    }

    if let Some(b) = badge {
        let galley = ui.painter().layout(
            b.to_string(),
            FontId::proportional(10.0),
            Color32::WHITE,
            100.0,
        );
        let pad = Vec2::new(6.0, 2.0);
        let badge_size = galley.size() + pad * 2.0;
        let badge_x = if collapsed {
            rect.max.x - badge_size.x - 4.0
        } else {
            rect.max.x - badge_size.x - 12.0
        };
        let badge_rect = Rect::from_min_size(Pos2::new(badge_x, rect.min.y + 6.0), badge_size);
        ui.painter()
            .rect_filled(badge_rect, Rounding::same(8.0), theme.accent);
        ui.painter().galley(
            Pos2::new(badge_rect.min.x + pad.x, badge_rect.min.y + pad.y),
            galley,
            Color32::WHITE,
        );
    }

    resp
}

fn with_alpha(c: Color32, alpha: f32) -> Color32 {
    Color32::from_rgba_premultiplied(
        (f32::from(c.r()) * alpha) as u8,
        (f32::from(c.g()) * alpha) as u8,
        (f32::from(c.b()) * alpha) as u8,
        (f32::from(c.a()) * alpha) as u8,
    )
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

pub fn divider(ui: &mut Ui, theme: &Theme) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 1.0), Sense::hover());
    ui.painter().rect_filled(rect, 0.0, theme.border);
}

/// A circular progress ring.
pub fn progress_ring(ui: &mut Ui, theme: &Theme, frac: f32, size: f32) {
    if size < 8.0 {
        return;
    }
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
    let center = rect.center();
    let radius = (size / 2.0 - 3.0).max(1.0);
    let stroke_bg = Stroke::new(4.0, theme.border);
    let stroke_fg = Stroke::new(4.0, theme.accent);
    ui.painter().circle_stroke(center, radius, stroke_bg);
    let frac = frac.clamp(0.0, 1.0);
    if frac <= 0.0 {
        return;
    }
    let start = std::f32::consts::FRAC_PI_2;
    let end = start + frac * std::f32::consts::TAU;
    let n = ((frac * 64.0) as usize).max(1);
    let pts: Vec<Pos2> = (0..=n)
        .map(|i| {
            let t = (i as f32 / n as f32).mul_add(end - start, start);
            Pos2::new(center.x + radius * t.cos(), center.y + radius * t.sin())
        })
        .collect();
    if pts.len() > 1 {
        ui.painter().add(egui::Shape::line(pts, stroke_fg));
    }
}

/// Draw a simple tooltip when the response is hovered.
pub fn tooltip(resp: &Response, text: &str) {
    resp.clone().on_hover_text(text);
}

/// Floating action button anchored at the bottom-right of the available space.
/// Uses the DeepSeek blue→purple gradient with a blue glow shadow.
pub fn fab_button(ui: &mut Ui, theme: &Theme, text: &str) -> Response {
    let padding = Vec2::new(24.0, 16.0);
    let galley = ui.painter().layout(
        text.to_string(),
        FontId::proportional(14.0),
        Color32::WHITE,
        f32::INFINITY,
    );
    let size = Vec2::new(
        galley.size().x + padding.x * 2.0,
        galley.size().y + padding.y * 2.0,
    )
    .max(Vec2::new(120.0, 48.0));

    let available = ui.available_rect_before_wrap();
    let rect = Rect::from_min_size(
        Pos2::new(
            available.max.x - size.x - 24.0,
            available.max.y - size.y - 24.0,
        ),
        size,
    );
    let resp = ui.allocate_rect(rect, Sense::click());
    let hover = resp.hovered();
    let active = resp.is_pointer_button_down_on();

    let lift = if active { 1.0 } else if hover { -2.0 } else { 0.0 };
    let bg_rect = resp.rect.translate(Vec2::new(0.0, -lift));

    let shadow_alpha = if hover { 128 } else { 77 };
    let shadow_offset = Vec2::new(0.0, if hover { 8.0 } else { 4.0 });
    let shadow_blur = if hover { 25.0 } else { 15.0 };
    let shadow_color = Color32::from_rgba_premultiplied(59, 130, 246, shadow_alpha);
    paint_diffused_shadow(ui, bg_rect, shadow_offset, shadow_blur, shadow_color);

    paint_rounded_vertical_gradient(
        ui,
        bg_rect,
        BUTTON_RADIUS,
        theme.gradient_primary_from,
        theme.gradient_primary_to,
        16,
    );

    ui.painter().text(
        bg_rect.center(),
        Align2::CENTER_CENTER,
        text,
        FontId::new(14.0, FontFamily::Name("Numbers".into())),
        Color32::WHITE,
    );
    resp
}
