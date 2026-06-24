//! Hand-painted vector icons. No emoji, no icon fonts — every glyph is drawn
//! with egui primitive painters for crisp, consistent, lightweight visuals.
//!
//! The kit is split into three layers:
//! 1. **Theme icons** `(painter, rect, &Theme)` — primary navigation / status
//!    glyphs that pick their own accent color from the active theme.
//! 2. **Color icons** `(painter, rect, Color32)` — generic glyphs whose color
//!    is decided by the caller (used inside buttons, toasts, etc.).
//! 3. **Gradient orb icons** — premium rounded-square avatars used on the
//!    dashboard cards.
//!
//! All strokes use a uniform 2.5px weight for a modern, legible look that
//! matches a DeepSeek-style reference UI.

#![allow(dead_code)] // shared icon kit: glyphs are used across the evolving UI

use eframe::egui::{Color32, FontId, Painter, Pos2, Rect, Rounding, Stroke, Vec2};

use crate::theme::Theme;

/// Default stroke weight for icon outlines.
const W: f32 = 2.5;

// ---------------------------------------------------------------------------
// Rounded-box helper (DeepSeek-style agent-icon-wrap)
// ---------------------------------------------------------------------------

/// Draw a rounded-square colored container (like the 48px `agent-icon-wrap`
/// from the reference UI) and then paint a color-signature glyph inside it.
///
/// `bg_color` fills the container, `icon_color` is forwarded to `icon_fn`
/// (falling back to `theme.accent` when transparent). The icon is inset so it
/// breathes inside the box.
pub fn icon_in_rounded_box(
    painter: &Painter,
    rect: Rect,
    bg_color: Color32,
    icon_fn: fn(&Painter, Rect, Color32),
    icon_color: Color32,
    theme: &Theme,
) {
    if rect.width() <= 0.0 || rect.height() <= 0.0 {
        return;
    }
    let radius = rect.width().min(rect.height()) / 3.0;
    painter.rect_filled(rect, Rounding::same(radius), bg_color);
    let color = if icon_color == Color32::TRANSPARENT {
        theme.accent
    } else {
        icon_color
    };
    let inner = rect.shrink(rect.width().min(rect.height()) * 0.24);
    icon_fn(painter, inner, color);
}

// ---------------------------------------------------------------------------
// Theme icons (navigation / status)
// ---------------------------------------------------------------------------

/// Dashboard — 2x2 grid of rounded tiles, one highlighted with the accent.
pub fn dashboard(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.36;
    let stroke = Stroke::new(W, theme.text_dim);
    let off = s * 0.54;
    let half = s * 0.46;
    for (i, &dx) in [-off, off].iter().enumerate() {
        for &dy in [-off, off].iter() {
            let r = Rect::from_center_size(Pos2::new(c.x + dx, c.y + dy), Vec2::splat(half * 2.0));
            let fill = if i == 0 && dy < 0.0 {
                theme.accent_dim
            } else {
                Color32::TRANSPARENT
            };
            if fill != Color32::TRANSPARENT {
                painter.rect_filled(r, Rounding::same(4.0), fill);
            }
            painter.rect_stroke(r, Rounding::same(4.0), stroke);
        }
    }
}

/// Chat bubble with a tail (theme variant).
pub fn chat(painter: &Painter, rect: Rect, theme: &Theme) {
    message(painter, rect, theme);
}

/// Message / chat bubble — rounded body, tail, three accent dots.
pub fn message(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.36;
    let h = w * 0.78;
    let body = Rect::from_center_size(c, Vec2::new(w * 2.0, h * 2.0));
    let stroke = Stroke::new(W, theme.text_dim);
    painter.rect_stroke(body, Rounding::same(8.0), stroke);
    let tail = [
        Pos2::new(c.x - w * 0.4, c.y + h),
        Pos2::new(c.x - w * 0.12, c.y + h + w * 0.34),
        Pos2::new(c.x + w * 0.12, c.y + h),
    ];
    painter.add(egui::Shape::closed_line(tail.to_vec(), stroke));
    for i in 0..3 {
        let dx = (i as f32 - 1.0) * w * 0.38;
        painter.circle_filled(Pos2::new(c.x + dx, c.y), w * 0.1, theme.accent);
    }
}

/// Students — head + shoulders (neutral).
pub fn students(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.text_dim);
    painter.circle_stroke(Pos2::new(c.x, c.y - r * 0.35), r * 0.38, stroke);
    let arc: Vec<Pos2> = (0..=14)
        .map(|i| {
            let a = std::f32::consts::PI * (i as f32 / 14.0 + 1.0);
            Pos2::new(
                (r * 0.95).mul_add(a.cos(), c.x),
                (r * 0.5).mul_add(a.sin(), c.y + r * 0.55),
            )
        })
        .collect();
    painter.add(egui::Shape::line(arc, stroke));
}

/// User / person — head + shoulders in the accent color.
pub fn user(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.accent);
    painter.circle_stroke(Pos2::new(c.x, c.y - r * 0.35), r * 0.38, stroke);
    let arc: Vec<Pos2> = (0..=14)
        .map(|i| {
            let a = std::f32::consts::PI * (i as f32 / 14.0 + 1.0);
            Pos2::new(
                (r * 0.95).mul_add(a.cos(), c.x),
                (r * 0.5).mul_add(a.sin(), c.y + r * 0.55),
            )
        })
        .collect();
    painter.add(egui::Shape::line(arc, stroke));
}

/// Agent — friendly robot head with accent eyes.
pub fn agent(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.30;
    let stroke = Stroke::new(W, theme.text_dim);
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::splat(s * 2.0)),
        Rounding::same(6.0),
        stroke,
    );
    painter.circle_filled(Pos2::new(c.x - s * 0.45, c.y - s * 0.1), s * 0.14, theme.accent);
    painter.circle_filled(Pos2::new(c.x + s * 0.45, c.y - s * 0.1), s * 0.14, theme.accent);
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.4, c.y + s * 0.5),
            Pos2::new(c.x + s * 0.4, c.y + s * 0.5),
        ],
        stroke,
    );
    painter.line_segment([Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y - s * 1.45)], stroke);
    painter.circle_filled(Pos2::new(c.x, c.y - s * 1.5), s * 0.16, theme.accent);
}

/// History — clock with hands.
pub fn history(painter: &Painter, rect: Rect, theme: &Theme) {
    clock(painter, rect, theme);
}

/// Clock — circle with minute + hour hands.
pub fn clock(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.text_dim);
    painter.circle_stroke(c, r, stroke);
    painter.line_segment([c, Pos2::new(c.x, c.y - r * 0.55)], stroke);
    painter.line_segment([c, Pos2::new(c.x + r * 0.45, c.y + r * 0.12)], Stroke::new(W, theme.accent));
}

/// Model — hexagonal network with an accent core.
pub fn model(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let link = Stroke::new(1.8, theme.border_strong);
    let nodes = [
        Pos2::new(c.x, c.y - s),
        Pos2::new(c.x + s * 0.87, c.y - s * 0.5),
        Pos2::new(c.x + s * 0.87, c.y + s * 0.5),
        Pos2::new(c.x, c.y + s),
        Pos2::new(c.x - s * 0.87, c.y + s * 0.5),
        Pos2::new(c.x - s * 0.87, c.y - s * 0.5),
    ];
    for i in 0..6 {
        painter.line_segment([nodes[i], nodes[(i + 1) % 6]], link);
        painter.line_segment([c, nodes[i]], link);
    }
    for n in &nodes {
        painter.circle_filled(*n, s * 0.15, theme.text_dim);
    }
    painter.circle_filled(c, s * 0.2, theme.accent);
}

/// Skills — five-point star in the accent color.
pub fn skills(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.accent);
    let pts: Vec<Pos2> = (0..10)
        .map(|i| {
            let a = std::f32::consts::FRAC_PI_2 + i as f32 * std::f32::consts::PI / 5.0;
            let rad = if i % 2 == 0 { r } else { r * 0.45 };
            Pos2::new(c.x + rad * a.cos(), c.y - rad * a.sin())
        })
        .collect();
    painter.add(egui::Shape::closed_line(pts.clone(), stroke));
    painter.add(egui::Shape::convex_polygon(pts, theme.accent_dim, Stroke::NONE));
}

/// Scheduler — clock with quadrant tick marks.
pub fn scheduler(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.text_dim);
    painter.circle_stroke(c, r, stroke);
    painter.line_segment([c, Pos2::new(c.x, c.y - r * 0.55)], stroke);
    painter.line_segment([c, Pos2::new(c.x + r * 0.5, c.y)], Stroke::new(W, theme.accent));
    for i in 0..4 {
        let a = i as f32 * std::f32::consts::FRAC_PI_2;
        let p1 = Pos2::new(
            (r * 0.78).mul_add(a.cos(), c.x),
            (r * 0.78).mul_add(-a.sin(), c.y),
        );
        let p2 = Pos2::new(
            (r * 0.94).mul_add(a.cos(), c.x),
            (r * 0.94).mul_add(-a.sin(), c.y),
        );
        painter.line_segment([p1, p2], stroke);
    }
}

/// RAG — document with text lines and a folded corner.
pub fn rag(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.32;
    let h = w * 1.25;
    let stroke = Stroke::new(W, theme.text_dim);
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::new(w * 2.0, h * 2.0)),
        Rounding::same(3.0),
        stroke,
    );
    for i in 0..4 {
        let y = (i as f32 * h).mul_add(0.37, c.y - h * 0.55);
        painter.line_segment(
            [
                Pos2::new(c.x - w * 0.7, y),
                Pos2::new(c.x + w * (i as f32).mul_add(-0.12, 0.55), y),
            ],
            Stroke::new(1.8, theme.border_strong),
        );
    }
    let fold = [
        Pos2::new(c.x + w * 0.5, c.y - h),
        Pos2::new(c.x + w, c.y - h),
        Pos2::new(c.x + w, c.y - h * 0.55),
    ];
    painter.add(egui::Shape::line(fold.to_vec(), stroke));
}

/// Privacy — padlock.
pub fn privacy(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.text_dim);
    let body = Rect::from_center_size(Pos2::new(c.x, c.y + s * 0.2), Vec2::new(s * 1.6, s * 1.3));
    painter.rect_filled(body, Rounding::same(3.0), theme.accent_dim);
    painter.rect_stroke(body, Rounding::same(3.0), stroke);
    let arc: Vec<Pos2> = (0..=12)
        .map(|i| {
            let a = std::f32::consts::PI + i as f32 * std::f32::consts::PI / 12.0;
            Pos2::new(
                (s * 0.55).mul_add(a.cos(), c.x),
                (s * 0.55).mul_add(a.sin(), c.y - s * 0.35),
            )
        })
        .collect();
    painter.add(egui::Shape::line(arc, stroke));
    painter.circle_filled(Pos2::new(c.x, c.y + s * 0.2), s * 0.13, theme.accent);
    painter.line_segment(
        [Pos2::new(c.x, c.y + s * 0.35), Pos2::new(c.x, c.y + s * 0.65)],
        Stroke::new(W, theme.accent),
    );
}

/// Settings — 8-tooth gear with an accent hub.
pub fn settings(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.36;
    let stroke = Stroke::new(W, theme.text_dim);
    let n = 8;
    let pts: Vec<Pos2> = (0..(n * 2))
        .map(|i| {
            let a = i as f32 * std::f32::consts::PI / n as f32;
            let rad = if i % 2 == 0 { r } else { r * 0.72 };
            Pos2::new(c.x + rad * a.cos(), c.y + rad * a.sin())
        })
        .collect();
    painter.add(egui::Shape::closed_line(pts, stroke));
    painter.circle_stroke(c, r * 0.38, Stroke::new(W, theme.accent));
}

/// Search — magnifier.
pub fn search(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(W, theme.text_dim);
    let center = Pos2::new(c.x - r * 0.2, c.y - r * 0.2);
    painter.circle_stroke(center, r, stroke);
    painter.line_segment(
        [
            Pos2::new(c.x + r * 0.45, c.y + r * 0.45),
            Pos2::new(c.x + r * 0.9, c.y + r * 0.9),
        ],
        Stroke::new(W, theme.accent),
    );
}

// ---------------------------------------------------------------------------
// New FontAwesome-style theme icons
// ---------------------------------------------------------------------------

/// Pie chart — circle with two accent radii and a filled slice.
pub fn chart_pie(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    painter.circle_stroke(c, r, Stroke::new(W, theme.text_dim));
    let top = Pos2::new(c.x, c.y - r);
    let right = Pos2::new(c.x + r, c.y);
    painter.add(egui::Shape::convex_polygon(
        vec![c, top, right],
        theme.accent_dim,
        Stroke::NONE,
    ));
    let stroke = Stroke::new(W, theme.accent);
    painter.line_segment([c, top], stroke);
    painter.line_segment([c, right], stroke);
}

/// Robot — rounded head, accent eyes, antenna and side ears.
pub fn robot(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.30;
    let stroke = Stroke::new(W, theme.text_dim);
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::splat(s * 2.0)),
        Rounding::same(6.0),
        stroke,
    );
    painter.circle_filled(Pos2::new(c.x - s * 0.45, c.y - s * 0.1), s * 0.14, theme.accent);
    painter.circle_filled(Pos2::new(c.x + s * 0.45, c.y - s * 0.1), s * 0.14, theme.accent);
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.4, c.y + s * 0.5),
            Pos2::new(c.x + s * 0.4, c.y + s * 0.5),
        ],
        stroke,
    );
    painter.line_segment([Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y - s * 1.4)], stroke);
    painter.circle_filled(Pos2::new(c.x, c.y - s * 1.45), s * 0.16, theme.accent);
    painter.line_segment([Pos2::new(c.x - s, c.y), Pos2::new(c.x - s * 1.25, c.y)], stroke);
    painter.line_segment([Pos2::new(c.x + s, c.y), Pos2::new(c.x + s * 1.25, c.y)], stroke);
}

/// Sliders — three horizontal tracks with accent knobs.
pub fn sliders(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.text_dim);
    let knob_xs = [c.x - s * 0.4, c.x + s * 0.25, c.x - s * 0.1];
    for (i, &kx) in knob_xs.iter().enumerate() {
        let y = c.y - s + i as f32 * s;
        painter.line_segment([Pos2::new(c.x - s, y), Pos2::new(c.x + s, y)], stroke);
        painter.circle_filled(Pos2::new(kx, y), s * 0.17, theme.accent);
    }
}

/// Brain — stylized two-hemisphere silhouette for the logo.
pub fn brain(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.purple);
    let pts = vec![
        Pos2::new(c.x - s * 0.9, c.y - s * 0.2),
        Pos2::new(c.x - s * 0.7, c.y - s * 0.8),
        Pos2::new(c.x - s * 0.3, c.y - s * 0.95),
        Pos2::new(c.x, c.y - s * 0.65),
        Pos2::new(c.x + s * 0.3, c.y - s * 0.95),
        Pos2::new(c.x + s * 0.7, c.y - s * 0.8),
        Pos2::new(c.x + s * 0.9, c.y - s * 0.2),
        Pos2::new(c.x + s * 0.6, c.y + s * 0.7),
        Pos2::new(c.x, c.y + s * 0.9),
        Pos2::new(c.x - s * 0.6, c.y + s * 0.7),
    ];
    painter.add(egui::Shape::closed_line(pts, stroke));
    painter.line_segment(
        [Pos2::new(c.x, c.y - s * 0.55), Pos2::new(c.x, c.y + s * 0.8)],
        Stroke::new(2.0, theme.purple),
    );
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.7, c.y - s * 0.1),
            Pos2::new(c.x - s * 0.2, c.y - s * 0.1),
        ],
        Stroke::new(2.0, theme.purple),
    );
    painter.line_segment(
        [
            Pos2::new(c.x + s * 0.2, c.y - s * 0.1),
            Pos2::new(c.x + s * 0.7, c.y - s * 0.1),
        ],
        Stroke::new(2.0, theme.purple),
    );
}

/// Circle check — green ring with a checkmark.
pub fn circle_check(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.36;
    painter.circle_stroke(c, r, Stroke::new(W, theme.success));
    let s = r * 0.5;
    let stroke = Stroke::new(W, theme.success);
    painter.line_segment(
        [Pos2::new(c.x - s, c.y), Pos2::new(c.x - s * 0.2, c.y + s * 0.7)],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.2, c.y + s * 0.7),
            Pos2::new(c.x + s * 0.8, c.y - s * 0.6),
        ],
        stroke,
    );
}

/// Triangle warning — filled triangle with an exclamation mark.
pub fn triangle_warning(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.36;
    let pts = vec![
        Pos2::new(c.x, c.y - s),
        Pos2::new(c.x + s * 0.95, c.y + s * 0.75),
        Pos2::new(c.x - s * 0.95, c.y + s * 0.75),
    ];
    painter.add(egui::Shape::convex_polygon(pts, theme.warning_dim, Stroke::new(W, theme.warning)));
    painter.line_segment(
        [Pos2::new(c.x, c.y - s * 0.3), Pos2::new(c.x, c.y + s * 0.3)],
        Stroke::new(W, theme.warning),
    );
    painter.circle_filled(Pos2::new(c.x, c.y + s * 0.55), s * 0.09, theme.warning);
}

/// Arrow up — upward arrow in the success color.
pub fn arrow_up(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(W, theme.success);
    let tip = Pos2::new(c.x, c.y - s * 0.7);
    painter.line_segment([Pos2::new(c.x, c.y + s), Pos2::new(c.x, c.y - s * 0.3)], stroke);
    painter.line_segment([Pos2::new(c.x - s * 0.6, c.y), tip], stroke);
    painter.line_segment([Pos2::new(c.x + s * 0.6, c.y), tip], stroke);
}

/// Gem / diamond — faceted stone in cyan.
pub fn gem(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.cyan);
    let g_y = c.y - s * 0.1;
    let t_y = c.y - s * 0.7;
    let b_y = c.y + s * 0.8;
    let gl = c.x - s;
    let gr = c.x + s;
    let tl = c.x - s * 0.45;
    let tr = c.x + s * 0.45;
    painter.line_segment([Pos2::new(gl, g_y), Pos2::new(gr, g_y)], stroke);
    painter.line_segment([Pos2::new(gl, g_y), Pos2::new(tl, t_y)], stroke);
    painter.line_segment([Pos2::new(gr, g_y), Pos2::new(tr, t_y)], stroke);
    painter.line_segment([Pos2::new(tl, t_y), Pos2::new(tr, t_y)], stroke);
    painter.line_segment([Pos2::new(gl, g_y), Pos2::new(c.x, b_y)], stroke);
    painter.line_segment([Pos2::new(gr, g_y), Pos2::new(c.x, b_y)], stroke);
    let f = Stroke::new(2.0, theme.cyan);
    painter.line_segment([Pos2::new(tl, t_y), Pos2::new(c.x, b_y)], f);
    painter.line_segment([Pos2::new(tr, t_y), Pos2::new(c.x, b_y)], f);
}

/// Chalkboard — framed board with a ledge.
pub fn chalkboard(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.text_dim);
    let frame = Rect::from_center_size(c, Vec2::new(s * 2.0, s * 1.4));
    painter.rect_stroke(frame, Rounding::same(3.0), stroke);
    let board = Rect::from_center_size(Pos2::new(c.x, c.y - s * 0.1), Vec2::new(s * 1.7, s * 1.0));
    painter.rect_filled(board, Rounding::same(2.0), theme.accent_dim);
    painter.line_segment(
        [
            Pos2::new(c.x - s * 1.15, c.y + s * 0.78),
            Pos2::new(c.x + s * 1.15, c.y + s * 0.78),
        ],
        Stroke::new(3.0, theme.text_dim),
    );
}

/// Heart — two-bump silhouette in pink.
pub fn heart(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(W, theme.pink);
    let pts = vec![
        Pos2::new(c.x, c.y - s * 0.25),
        Pos2::new(c.x - s * 0.25, c.y - s * 0.55),
        Pos2::new(c.x - s * 0.7, c.y - s * 0.45),
        Pos2::new(c.x - s * 0.95, c.y - s * 0.1),
        Pos2::new(c.x - s * 0.8, c.y + s * 0.3),
        Pos2::new(c.x - s * 0.4, c.y + s * 0.65),
        Pos2::new(c.x, c.y + s * 0.9),
        Pos2::new(c.x + s * 0.4, c.y + s * 0.65),
        Pos2::new(c.x + s * 0.8, c.y + s * 0.3),
        Pos2::new(c.x + s * 0.95, c.y - s * 0.1),
        Pos2::new(c.x + s * 0.7, c.y - s * 0.45),
        Pos2::new(c.x + s * 0.25, c.y - s * 0.55),
    ];
    painter.add(egui::Shape::closed_line(pts, stroke));
}

/// School — peaked roof, body, flag and door.
pub fn school(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(W, theme.text_dim);
    let roof = vec![
        Pos2::new(c.x - s, c.y - s * 0.1),
        Pos2::new(c.x, c.y - s * 0.7),
        Pos2::new(c.x + s, c.y - s * 0.1),
    ];
    painter.add(egui::Shape::closed_line(roof, stroke));
    let body = Rect::from_min_max(
        Pos2::new(c.x - s * 0.8, c.y - s * 0.1),
        Pos2::new(c.x + s * 0.8, c.y + s * 0.7),
    );
    painter.rect_stroke(body, Rounding::same(2.0), stroke);
    painter.line_segment(
        [Pos2::new(c.x, c.y - s * 0.7), Pos2::new(c.x, c.y - s * 1.05)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x, c.y - s * 1.05), Pos2::new(c.x + s * 0.35, c.y - s * 0.92)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + s * 0.35, c.y - s * 0.92), Pos2::new(c.x, c.y - s * 0.8)],
        stroke,
    );
    let door = Rect::from_min_max(
        Pos2::new(c.x - s * 0.2, c.y + s * 0.2),
        Pos2::new(c.x + s * 0.2, c.y + s * 0.7),
    );
    painter.rect_stroke(door, Rounding::same(2.0), Stroke::new(2.0, theme.accent));
}

/// Shield — success-tinted shield with a checkmark.
pub fn shield(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let pts = vec![
        Pos2::new(c.x, c.y - s),
        Pos2::new(c.x + s * 0.85, c.y - s * 0.6),
        Pos2::new(c.x + s * 0.85, c.y + s * 0.1),
        Pos2::new(c.x, c.y + s * 0.9),
        Pos2::new(c.x - s * 0.85, c.y + s * 0.1),
        Pos2::new(c.x - s * 0.85, c.y - s * 0.6),
    ];
    painter.add(egui::Shape::convex_polygon(pts, theme.success_dim, Stroke::new(W, theme.success)));
    let cs = s * 0.4;
    let stroke = Stroke::new(W, theme.success);
    painter.line_segment(
        [Pos2::new(c.x - cs * 0.6, c.y), Pos2::new(c.x - cs * 0.1, c.y + cs * 0.5)],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - cs * 0.1, c.y + cs * 0.5),
            Pos2::new(c.x + cs * 0.7, c.y - cs * 0.4),
        ],
        stroke,
    );
}

/// Lightning bolt — zigzag in the warning color.
pub fn bolt(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let pts = vec![
        Pos2::new(c.x + s * 0.1, c.y - s),
        Pos2::new(c.x - s * 0.5, c.y + s * 0.1),
        Pos2::new(c.x - s * 0.05, c.y + s * 0.1),
        Pos2::new(c.x - s * 0.2, c.y + s),
        Pos2::new(c.x + s * 0.5, c.y - s * 0.15),
        Pos2::new(c.x + s * 0.05, c.y - s * 0.15),
    ];
    painter.add(egui::Shape::closed_line(pts, Stroke::new(W, theme.warning)));
}

/// Floppy disk — save icon.
pub fn floppy(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(W, theme.text_dim);
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::new(s * 1.8, s * 1.8)),
        Rounding::same(3.0),
        stroke,
    );
    let slot = Rect::from_min_max(
        Pos2::new(c.x + s * 0.1, c.y - s * 0.9),
        Pos2::new(c.x + s * 0.8, c.y - s * 0.2),
    );
    painter.rect_stroke(slot, Rounding::same(1.0), stroke);
    painter.line_segment(
        [
            Pos2::new(c.x + s * 0.45, c.y - s * 0.85),
            Pos2::new(c.x + s * 0.45, c.y - s * 0.25),
        ],
        Stroke::new(2.0, theme.text_dim),
    );
    let label = Rect::from_min_max(
        Pos2::new(c.x - s * 0.6, c.y + s * 0.1),
        Pos2::new(c.x + s * 0.6, c.y + s * 0.7),
    );
    painter.rect_stroke(label, Rounding::same(1.0), stroke);
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.45, c.y + s * 0.35),
            Pos2::new(c.x + s * 0.45, c.y + s * 0.35),
        ],
        Stroke::new(2.0, theme.text_dim),
    );
}

// ---------------------------------------------------------------------------
// Color icons (caller-supplied color)
// ---------------------------------------------------------------------------

/// Plus — accent plus sign (theme variant).
pub fn plus(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(W, theme.accent);
    painter.line_segment([Pos2::new(c.x - s, c.y), Pos2::new(c.x + s, c.y)], stroke);
    painter.line_segment([Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y + s)], stroke);
}

pub fn cross(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(W, color);
    painter.line_segment([Pos2::new(c.x - s, c.y - s), Pos2::new(c.x + s, c.y + s)], stroke);
    painter.line_segment([Pos2::new(c.x + s, c.y - s), Pos2::new(c.x - s, c.y + s)], stroke);
}

pub fn edit(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(W, color);
    painter.line_segment(
        [Pos2::new(c.x - s, c.y + s * 0.2), Pos2::new(c.x + s * 0.4, c.y - s * 1.2)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - s, c.y + s * 0.2), Pos2::new(c.x - s * 0.6, c.y + s * 0.6)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - s * 0.6, c.y + s * 0.6), Pos2::new(c.x - s * 0.2, c.y + s * 0.2)],
        stroke,
    );
}

pub fn trash(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.28;
    let h = w * 1.1;
    let stroke = Stroke::new(W, color);
    painter.line_segment(
        [Pos2::new(c.x - w, c.y - h * 0.6), Pos2::new(c.x + w, c.y - h * 0.6)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - w * 0.35, c.y - h * 0.6), Pos2::new(c.x - w * 0.35, c.y - h * 0.85)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + w * 0.35, c.y - h * 0.6), Pos2::new(c.x + w * 0.35, c.y - h * 0.85)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - w * 0.35, c.y - h * 0.85), Pos2::new(c.x + w * 0.35, c.y - h * 0.85)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - w * 0.8, c.y - h * 0.5), Pos2::new(c.x - w * 0.6, c.y + h * 0.7)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + w * 0.8, c.y - h * 0.5), Pos2::new(c.x + w * 0.6, c.y + h * 0.7)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - w * 0.6, c.y + h * 0.7), Pos2::new(c.x + w * 0.6, c.y + h * 0.7)],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.25, c.y - h * 0.25),
            Pos2::new(c.x - w * 0.15, c.y + h * 0.35),
        ],
        Stroke::new(1.8, color),
    );
    painter.line_segment(
        [
            Pos2::new(c.x + w * 0.05, c.y - h * 0.25),
            Pos2::new(c.x + w * 0.15, c.y + h * 0.35),
        ],
        Stroke::new(1.8, color),
    );
}

pub fn refresh(painter: &Painter, rect: Rect, color: Color32) {
    if rect.width() < 2.0 || rect.height() < 2.0 {
        return;
    }
    let c = rect.center();
    let r = (rect.width().min(rect.height()) * 0.32).max(1.0);
    let stroke = Stroke::new(W.max(0.1), color);
    let pts: Vec<Pos2> = (0..=14)
        .map(|i| {
            let a = i as f32 * std::f32::consts::TAU / 14.0 + 0.5;
            Pos2::new(c.x + r * a.cos(), c.y + r * a.sin())
        })
        .collect();
    painter.add(egui::Shape::line(pts.clone(), stroke));
    if let (Some(&tip), Some(&prev)) = (pts.last(), pts.get(pts.len().saturating_sub(2))) {
        let dx = tip.x - prev.x;
        let dy = tip.y - prev.y;
        let len = dx.hypot(dy).max(1.0);
        let nx = dx / len;
        let ny = dy / len;
        let a1 = Pos2::new(
            (r * 0.35).mul_add(-(nx * 0.87 - ny * 0.49), tip.x),
            (r * 0.35).mul_add(-(ny * 0.87 + nx * 0.49), tip.y),
        );
        let a2 = Pos2::new(
            (r * 0.35).mul_add(-(nx * 0.87 + ny * 0.49), tip.x),
            (r * 0.35).mul_add(-(ny * 0.87 - nx * 0.49), tip.y),
        );
        painter.line_segment([tip, a1], stroke);
        painter.line_segment([tip, a2], stroke);
    }
}

pub fn run(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let pts = vec![
        Pos2::new(c.x - s * 0.5, c.y - s),
        Pos2::new(c.x + s * 0.8, c.y),
        Pos2::new(c.x - s * 0.5, c.y + s),
    ];
    painter.add(egui::Shape::convex_polygon(pts, color, Stroke::new(W, color)));
}

pub fn stop(painter: &Painter, rect: Rect, color: Color32) {
    let r = rect.shrink(rect.width().min(rect.height()) * 0.32);
    painter.rect_filled(r, Rounding::same(3.0), color);
}

pub fn chevron_left(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(W, color);
    painter.line_segment([Pos2::new(c.x + s * 0.4, c.y - s), Pos2::new(c.x - s * 0.4, c.y)], stroke);
    painter.line_segment([Pos2::new(c.x - s * 0.4, c.y), Pos2::new(c.x + s * 0.4, c.y + s)], stroke);
}

pub fn chevron_right(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(W, color);
    painter.line_segment([Pos2::new(c.x - s * 0.4, c.y - s), Pos2::new(c.x + s * 0.4, c.y)], stroke);
    painter.line_segment([Pos2::new(c.x + s * 0.4, c.y), Pos2::new(c.x - s * 0.4, c.y + s)], stroke);
}

pub fn chevron_down(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(W, color);
    painter.line_segment([Pos2::new(c.x - s, c.y - s * 0.4), Pos2::new(c.x, c.y + s * 0.4)], stroke);
    painter.line_segment([Pos2::new(c.x, c.y + s * 0.4), Pos2::new(c.x + s, c.y - s * 0.4)], stroke);
}

pub fn dot(painter: &Painter, rect: Rect, color: Color32) {
    painter.circle_filled(rect.center(), rect.width().min(rect.height()) * 0.28, color);
}

pub fn bell(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(W, color);
    let arc: Vec<Pos2> = (0..=10)
        .map(|i| {
            let a = std::f32::consts::PI + i as f32 * std::f32::consts::PI / 10.0;
            Pos2::new(
                (w * 1.1).mul_add(a.cos(), c.x),
                (w * 0.7).mul_add(a.sin(), c.y + w * 0.3),
            )
        })
        .collect();
    painter.add(egui::Shape::line(arc, stroke));
    painter.circle_filled(Pos2::new(c.x, c.y - w * 0.85), w * 0.18, color);
    painter.circle_filled(Pos2::new(c.x, c.y + w * 0.95), w * 0.2, color);
    painter.line_segment(
        [Pos2::new(c.x - w, c.y + w * 0.9), Pos2::new(c.x + w, c.y + w * 0.9)],
        stroke,
    );
}

pub fn sun(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.22;
    let stroke = Stroke::new(W, color);
    painter.circle_stroke(c, r, stroke);
    for i in 0..8 {
        let a = i as f32 * std::f32::consts::FRAC_PI_4;
        let p1 = Pos2::new((r * 1.5).mul_add(a.cos(), c.x), (r * 1.5).mul_add(-a.sin(), c.y));
        let p2 = Pos2::new((r * 2.0).mul_add(a.cos(), c.x), (r * 2.0).mul_add(-a.sin(), c.y));
        painter.line_segment([p1, p2], stroke);
    }
}

pub fn moon(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(W, color);
    let arc1: Vec<Pos2> = (0..=16)
        .map(|i| {
            let a = -std::f32::consts::FRAC_PI_2 + i as f32 * std::f32::consts::PI / 8.0;
            Pos2::new(c.x + r * a.cos(), c.y + r * a.sin())
        })
        .collect();
    let arc2: Vec<Pos2> = (0..=16)
        .map(|i| {
            let a = -std::f32::consts::FRAC_PI_2 + i as f32 * std::f32::consts::PI / 8.0;
            Pos2::new(
                (r * 0.55).mul_add(a.cos(), c.x + r * 0.55),
                (r * 0.65).mul_add(a.sin(), c.y),
            )
        })
        .collect();
    painter.add(egui::Shape::line(arc1, stroke));
    painter.add(egui::Shape::line(arc2, stroke));
}

pub fn check(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(W, color);
    painter.line_segment(
        [Pos2::new(c.x - s, c.y), Pos2::new(c.x - s * 0.15, c.y + s * 0.75)],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.15, c.y + s * 0.75),
            Pos2::new(c.x + s * 0.9, c.y - s * 0.7),
        ],
        stroke,
    );
}

pub fn filter(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(W, color);
    painter.line_segment([Pos2::new(c.x - w, c.y - w), Pos2::new(c.x + w, c.y - w)], stroke);
    painter.line_segment(
        [Pos2::new(c.x - w, c.y - w), Pos2::new(c.x - w * 0.35, c.y + w * 0.3)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + w, c.y - w), Pos2::new(c.x + w * 0.35, c.y + w * 0.3)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - w * 0.35, c.y + w * 0.3), Pos2::new(c.x - w * 0.35, c.y + w * 0.9)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + w * 0.35, c.y + w * 0.3), Pos2::new(c.x + w * 0.35, c.y + w * 0.9)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - w * 0.35, c.y + w * 0.9), Pos2::new(c.x + w * 0.35, c.y + w * 0.9)],
        stroke,
    );
}

pub fn download(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(W, color);
    painter.line_segment([Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y + s * 0.6)], stroke);
    painter.line_segment([Pos2::new(c.x - s * 0.6, c.y), Pos2::new(c.x, c.y + s * 0.6)], stroke);
    painter.line_segment([Pos2::new(c.x + s * 0.6, c.y), Pos2::new(c.x, c.y + s * 0.6)], stroke);
    painter.line_segment(
        [Pos2::new(c.x - s, c.y + s * 0.8), Pos2::new(c.x + s, c.y + s * 0.8)],
        stroke,
    );
}

pub fn upload(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(W, color);
    painter.line_segment([Pos2::new(c.x, c.y + s), Pos2::new(c.x, c.y - s * 0.6)], stroke);
    painter.line_segment([Pos2::new(c.x - s * 0.6, c.y), Pos2::new(c.x, c.y - s * 0.6)], stroke);
    painter.line_segment([Pos2::new(c.x + s * 0.6, c.y), Pos2::new(c.x, c.y - s * 0.6)], stroke);
    painter.line_segment(
        [Pos2::new(c.x - s, c.y + s * 0.8), Pos2::new(c.x + s, c.y + s * 0.8)],
        stroke,
    );
}

pub fn menu(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(W, color);
    for i in 0..3 {
        let y = (i as f32 * w).mul_add(0.6, c.y - w * 0.6);
        painter.line_segment([Pos2::new(c.x - w, y), Pos2::new(c.x + w, y)], stroke);
    }
}

pub fn dots_vertical(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.08;
    for i in -1..=1 {
        painter.circle_filled(Pos2::new(c.x, (i as f32 * s).mul_add(4.0, c.y)), s, color);
    }
}

pub fn sparkles(painter: &Painter, rect: Rect, color: Color32) {
    if rect.width() < 2.0 || rect.height() < 2.0 {
        return;
    }
    let c = rect.center();
    let s = (rect.width().min(rect.height()) * 0.3).max(1.0);
    let stroke = Stroke::new(W.max(0.1), color);
    let pts = vec![
        Pos2::new(c.x, c.y - s),
        Pos2::new(c.x + s * 0.25, c.y - s * 0.25),
        Pos2::new(c.x + s, c.y),
        Pos2::new(c.x + s * 0.25, c.y + s * 0.25),
        Pos2::new(c.x, c.y + s),
        Pos2::new(c.x - s * 0.25, c.y + s * 0.25),
        Pos2::new(c.x - s, c.y),
        Pos2::new(c.x - s * 0.25, c.y - s * 0.25),
    ];
    let mut path = pts.clone();
    if let Some(&first) = pts.first() {
        path.push(first);
    }
    painter.add(egui::Shape::line(path, stroke));
}

pub fn folder(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.32;
    let h = w * 0.75;
    let stroke = Stroke::new(W, color);
    painter.line_segment(
        [Pos2::new(c.x - w, c.y - h * 0.6), Pos2::new(c.x - w * 0.35, c.y - h * 0.6)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - w * 0.35, c.y - h * 0.6), Pos2::new(c.x - w * 0.15, c.y - h * 0.35)],
        stroke,
    );
    let body = [
        Pos2::new(c.x - w, c.y - h * 0.35),
        Pos2::new(c.x + w, c.y - h * 0.35),
        Pos2::new(c.x + w, c.y + h * 0.65),
        Pos2::new(c.x - w, c.y + h * 0.65),
    ];
    for i in 0..4 {
        painter.line_segment([body[i], body[(i + 1) % 4]], stroke);
    }
}

pub fn chat_color(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.38;
    let h = w * 0.85;
    let r = Rect::from_center_size(c, Vec2::new(w * 2.0, h * 2.0));
    let stroke = Stroke::new(W, color);
    painter.rect_stroke(r, Rounding::same(8.0), stroke);
    let tail = [
        Pos2::new(c.x - w * 0.35, c.y + h),
        Pos2::new(c.x - w * 0.1, c.y + h + w * 0.35),
        Pos2::new(c.x + w * 0.1, c.y + h),
    ];
    painter.add(egui::Shape::closed_line(tail.to_vec(), stroke));
}

// ---------------------------------------------------------------------------
// Premium gradient orb icons (Task 9)
// ---------------------------------------------------------------------------

fn paint_icon_gradient_bg(painter: &Painter, rect: Rect, top: Color32, bottom: Color32) {
    let center = rect.center();
    let radius = rect.width().min(rect.height()) / 2.0;
    if radius <= 0.0 {
        return;
    }
    let steps = 16;
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

pub fn book_icon(painter: &Painter, rect: Rect, theme: &Theme) {
    paint_icon_gradient_bg(painter, rect, theme.gradient_primary_to, theme.gradient_primary_from);
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.26;
    let h = w * 1.15;
    let stroke = Stroke::new(W, Color32::WHITE);
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::new(w * 2.0, h * 2.0)),
        Rounding::same(3.0),
        stroke,
    );
    painter.line_segment([Pos2::new(c.x, c.y - h), Pos2::new(c.x, c.y + h)], stroke);
    for i in 0..3 {
        let y = c.y - h * 0.25 + i as f32 * h * 0.35;
        painter.line_segment([Pos2::new(c.x - w * 0.7, y), Pos2::new(c.x - w * 0.1, y)], stroke);
        painter.line_segment([Pos2::new(c.x + w * 0.1, y), Pos2::new(c.x + w * 0.7, y)], stroke);
    }
}

pub fn trend_arrow_icon(painter: &Painter, rect: Rect, theme: &Theme) {
    if rect.width() < 2.0 || rect.height() < 2.0 {
        return;
    }
    paint_icon_gradient_bg(painter, rect, theme.gradient_cyan, theme.info);
    let c = rect.center();
    let s = (rect.width().min(rect.height()) * 0.28).max(1.0);
    let stroke = Stroke::new(W.max(0.1), Color32::WHITE);
    let pts = vec![
        Pos2::new(c.x - s, c.y + s * 0.3),
        Pos2::new(c.x - s * 0.2, c.y + s * 0.1),
        Pos2::new(c.x + s * 0.3, c.y - s * 0.2),
        Pos2::new(c.x + s, c.y - s * 0.6),
    ];
    painter.add(egui::Shape::line(pts.clone(), stroke));
    if let (Some(&tip), Some(&prev)) = (pts.last(), pts.get(pts.len().saturating_sub(2))) {
        let dx = tip.x - prev.x;
        let dy = tip.y - prev.y;
        let len = dx.hypot(dy).max(1.0);
        let nx = dx / len;
        let ny = dy / len;
        let a1 = Pos2::new(
            (s * 0.35).mul_add(-(nx * 0.87 - ny * 0.49), tip.x),
            (s * 0.35).mul_add(-(ny * 0.87 + nx * 0.49), tip.y),
        );
        let a2 = Pos2::new(
            (s * 0.35).mul_add(-(nx * 0.87 + ny * 0.49), tip.x),
            (s * 0.35).mul_add(-(ny * 0.87 - nx * 0.49), tip.y),
        );
        painter.line_segment([tip, a1], stroke);
        painter.line_segment([tip, a2], stroke);
    }
}

pub fn chat_bubble_icon(painter: &Painter, rect: Rect, theme: &Theme) {
    paint_icon_gradient_bg(painter, rect, theme.gradient_primary_to, theme.gradient_cyan);
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.32;
    let h = w * 0.85;
    let r = Rect::from_center_size(c, Vec2::new(w * 2.0, h * 2.0));
    let stroke = Stroke::new(W, Color32::WHITE);
    painter.rect_stroke(r, Rounding::same(7.0), stroke);
    let tail = [
        Pos2::new(c.x - w * 0.35, c.y + h),
        Pos2::new(c.x - w * 0.1, c.y + h + w * 0.35),
        Pos2::new(c.x + w * 0.1, c.y + h),
    ];
    painter.add(egui::Shape::closed_line(tail.to_vec(), stroke));
}

pub fn tool_wrench_icon(painter: &Painter, rect: Rect, theme: &Theme) {
    paint_icon_gradient_bg(painter, rect, theme.warning, theme.danger);
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(W, Color32::WHITE);
    painter.line_segment(
        [Pos2::new(c.x - s * 0.7, c.y + s * 0.7), Pos2::new(c.x + s * 0.4, c.y - s * 0.4)],
        stroke,
    );
    let jaw = [
        Pos2::new(c.x + s * 0.15, c.y - s * 0.7),
        Pos2::new(c.x + s * 0.5, c.y - s * 0.35),
        Pos2::new(c.x + s * 0.85, c.y - s * 0.7),
    ];
    painter.add(egui::Shape::line(jaw.to_vec(), stroke));
    painter.circle_stroke(Pos2::new(c.x - s * 0.75, c.y + s * 0.75), s * 0.22, stroke);
}

pub fn shield_icon(painter: &Painter, rect: Rect, theme: &Theme) {
    if rect.width() < 2.0 || rect.height() < 2.0 {
        return;
    }
    paint_icon_gradient_bg(painter, rect, theme.success, theme.info);
    let c = rect.center();
    let s = (rect.width().min(rect.height()) * 0.32).max(1.0);
    let stroke = Stroke::new(W.max(0.1), Color32::WHITE);
    let shield: Vec<Pos2> = vec![
        Pos2::new(c.x - s, c.y - s * 0.6),
        Pos2::new(c.x - s, c.y + s * 0.1),
        Pos2::new(c.x, c.y + s * 0.9),
        Pos2::new(c.x + s, c.y + s * 0.1),
        Pos2::new(c.x + s, c.y - s * 0.6),
        Pos2::new(c.x, c.y - s * 0.9),
    ];
    let mut path = shield.clone();
    if let Some(&first) = shield.first() {
        path.push(first);
    }
    painter.add(egui::Shape::line(path, stroke));
    painter.line_segment(
        [Pos2::new(c.x - s * 0.35, c.y), Pos2::new(c.x - s * 0.05, c.y + s * 0.3)],
        Stroke::new(W, Color32::WHITE),
    );
    painter.line_segment(
        [Pos2::new(c.x - s * 0.05, c.y + s * 0.3), Pos2::new(c.x + s * 0.45, c.y - s * 0.25)],
        Stroke::new(W, Color32::WHITE),
    );
}

pub fn robot_icon(painter: &Painter, rect: Rect, theme: &Theme) {
    paint_icon_gradient_bg(painter, rect, theme.gradient_purple, theme.gradient_primary_to);
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(W, Color32::WHITE);
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::splat(s * 2.0)),
        Rounding::same(5.0),
        stroke,
    );
    painter.circle_filled(Pos2::new(c.x - s * 0.45, c.y - s * 0.05), s * 0.12, Color32::WHITE);
    painter.circle_filled(Pos2::new(c.x + s * 0.45, c.y - s * 0.05), s * 0.12, Color32::WHITE);
    painter.line_segment(
        [Pos2::new(c.x - s * 0.35, c.y + s * 0.45), Pos2::new(c.x + s * 0.35, c.y + s * 0.45)],
        stroke,
    );
    painter.line_segment([Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y - s * 1.5)], stroke);
    painter.circle_filled(Pos2::new(c.x, c.y - s * 1.55), s * 0.15, Color32::WHITE);
}

pub fn sparkle_icon(painter: &Painter, rect: Rect, theme: &Theme) {
    if rect.width() < 2.0 || rect.height() < 2.0 {
        return;
    }
    paint_icon_gradient_bg(painter, rect, theme.pink, theme.purple);
    let c = rect.center();
    let s = (rect.width().min(rect.height()) * 0.32).max(1.0);
    let stroke = Stroke::new(W.max(0.1), Color32::WHITE);
    let pts = vec![
        Pos2::new(c.x, c.y - s),
        Pos2::new(c.x + s * 0.25, c.y - s * 0.25),
        Pos2::new(c.x + s, c.y),
        Pos2::new(c.x + s * 0.25, c.y + s * 0.25),
        Pos2::new(c.x, c.y + s),
        Pos2::new(c.x - s * 0.25, c.y + s * 0.25),
        Pos2::new(c.x - s, c.y),
        Pos2::new(c.x - s * 0.25, c.y - s * 0.25),
    ];
    let mut path = pts.clone();
    if let Some(&first) = pts.first() {
        path.push(first);
    }
    painter.add(egui::Shape::line(path, stroke));
}

/// Colorful gradient orb for skill cards.
/// Uses `color` as the base and blends to a lighter variant for a premium v4 look.
pub fn skill_orb(painter: &Painter, rect: Rect, color: Color32, label: &str) {
    let light = Theme::lerp(color, Color32::WHITE, 0.35);
    paint_icon_gradient_bg(painter, rect, light, color);
    let initial = label.chars().next().unwrap_or('A');
    painter.text(
        rect.center(),
        egui::Align2::CENTER_CENTER,
        initial.to_string(),
        FontId::proportional(rect.width().min(rect.height()) * 0.45),
        Color32::WHITE,
    );
}

/// Colored circle avatar with an initial letter.
pub fn avatar(painter: &Painter, rect: Rect, color: Color32, label: &str) {
    let r = rect.width().min(rect.height()) / 2.0;
    painter.circle_filled(rect.center(), r, color);
    let initial = label.chars().next().unwrap_or('A');
    painter.text(
        rect.center(),
        egui::Align2::CENTER_CENTER,
        initial.to_string(),
        FontId::proportional(r * 0.9),
        Color32::WHITE,
    );
}

/// Gradient circular avatar with an initial letter.
pub fn gradient_avatar(
    painter: &Painter,
    rect: Rect,
    top: Color32,
    bottom: Color32,
    label: &str,
) {
    paint_icon_gradient_bg(painter, rect, top, bottom);
    let initial = label.chars().next().unwrap_or('A');
    painter.text(
        rect.center(),
        egui::Align2::CENTER_CENTER,
        initial.to_string(),
        FontId::proportional(rect.width().min(rect.height()) * 0.45),
        Color32::WHITE,
    );
}
