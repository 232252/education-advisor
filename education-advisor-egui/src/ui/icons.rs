//! Hand-painted vector icons. No emoji, no icon fonts — every glyph is drawn
//! with egui primitive painters for crisp, consistent, lightweight visuals.

#![allow(dead_code)] // shared icon kit: glyphs are used across the evolving UI

use eframe::egui::{Color32, FontId, Painter, Pos2, Rect, Rounding, Stroke, Vec2};

use crate::theme::Theme;

pub fn dashboard(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(2.0, theme.text_dim);
    // 2x2 grid
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::splat(s * 2.0)),
        Rounding::same(3.0),
        stroke,
    );
    painter.line_segment([Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y + s)], stroke);
    painter.line_segment([Pos2::new(c.x - s, c.y), Pos2::new(c.x + s, c.y)], stroke);
}

pub fn chat(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.38;
    let h = w * 0.85;
    let r = Rect::from_center_size(c, Vec2::new(w * 2.0, h * 2.0));
    let stroke = Stroke::new(2.0, theme.text_dim);
    painter.rect_stroke(r, Rounding::same(8.0), stroke);
    // tail
    let tail = [
        Pos2::new(c.x - w * 0.35, c.y + h),
        Pos2::new(c.x - w * 0.1, c.y + h + w * 0.35),
        Pos2::new(c.x + w * 0.1, c.y + h),
    ];
    painter.add(egui::Shape::closed_line(tail.to_vec(), stroke));
}

pub fn students(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(2.0, theme.text_dim);
    // head
    painter.circle_stroke(Pos2::new(c.x, c.y - r * 0.35), r * 0.35, stroke);
    // shoulders
    let arc: Vec<Pos2> = (0..=12)
        .map(|i| {
            let a = std::f32::consts::PI * (i as f32 / 12.0 + 1.0);
            Pos2::new(
                (r * 0.9).mul_add(a.cos(), c.x),
                (r * 0.45).mul_add(a.sin(), c.y + r * 0.55),
            )
        })
        .collect();
    painter.add(egui::Shape::line(arc, stroke));
}

pub fn agent(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(2.0, theme.text_dim);
    // head square
    painter.rect_stroke(
        Rect::from_center_size(c, Vec2::splat(s * 2.0)),
        Rounding::same(6.0),
        stroke,
    );
    // eyes
    painter.circle_filled(
        Pos2::new(c.x - s * 0.45, c.y - s * 0.1),
        s * 0.12,
        theme.text_dim,
    );
    painter.circle_filled(
        Pos2::new(c.x + s * 0.45, c.y - s * 0.1),
        s * 0.12,
        theme.text_dim,
    );
    // mouth
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.35, c.y + s * 0.45),
            Pos2::new(c.x + s * 0.35, c.y + s * 0.45),
        ],
        stroke,
    );
    // antenna
    painter.line_segment(
        [Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y - s * 1.5)],
        stroke,
    );
    painter.circle_filled(Pos2::new(c.x, c.y - s * 1.55), s * 0.15, theme.text_dim);
}

pub fn history(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(2.0, theme.text_dim);
    painter.circle_stroke(c, r, stroke);
    // clock hands
    painter.line_segment([c, Pos2::new(c.x, c.y - r * 0.55)], stroke);
    painter.line_segment([c, Pos2::new(c.x + r * 0.45, c.y + r * 0.1)], stroke);
}

pub fn model(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let _stroke = Stroke::new(2.0, theme.text_dim);
    // hexagon-ish network
    let nodes = [
        Pos2::new(c.x, c.y - s),
        Pos2::new(c.x + s * 0.87, c.y - s * 0.5),
        Pos2::new(c.x + s * 0.87, c.y + s * 0.5),
        Pos2::new(c.x, c.y + s),
        Pos2::new(c.x - s * 0.87, c.y + s * 0.5),
        Pos2::new(c.x - s * 0.87, c.y - s * 0.5),
    ];
    for i in 0..6 {
        painter.line_segment(
            [nodes[i], nodes[(i + 1) % 6]],
            Stroke::new(1.5, theme.border_strong),
        );
        painter.line_segment([c, nodes[i]], Stroke::new(1.5, theme.border_strong));
    }
    for n in &nodes {
        painter.circle_filled(*n, s * 0.14, theme.text_dim);
    }
    painter.circle_filled(c, s * 0.18, theme.accent);
}

pub fn skills(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(2.0, theme.text_dim);
    // star
    let pts: Vec<Pos2> = (0..10)
        .map(|i| {
            let a = std::f32::consts::FRAC_PI_2 + i as f32 * std::f32::consts::PI / 5.0;
            let rad = if i % 2 == 0 { r } else { r * 0.45 };
            Pos2::new(c.x + rad * a.cos(), c.y - rad * a.sin())
        })
        .collect();
    let mut path = pts.clone();
    path.push(pts[0]);
    painter.add(egui::Shape::line(path, stroke));
}

pub fn scheduler(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(2.0, theme.text_dim);
    painter.circle_stroke(c, r, stroke);
    // hands
    painter.line_segment([c, Pos2::new(c.x, c.y - r * 0.55)], stroke);
    painter.line_segment([c, Pos2::new(c.x + r * 0.5, c.y)], stroke);
    // tick marks
    for i in 0..4 {
        let a = i as f32 * std::f32::consts::FRAC_PI_2;
        let p1 = Pos2::new(
            (r * 0.78).mul_add(a.cos(), c.x),
            (r * 0.78).mul_add(-a.sin(), c.y),
        );
        let p2 = Pos2::new(
            (r * 0.92).mul_add(a.cos(), c.x),
            (r * 0.92).mul_add(-a.sin(), c.y),
        );
        painter.line_segment([p1, p2], Stroke::new(2.0, theme.text_dim));
    }
}

pub fn rag(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.32;
    let h = w * 1.25;
    let r = Rect::from_center_size(c, Vec2::new(w * 2.0, h * 2.0));
    let stroke = Stroke::new(2.0, theme.text_dim);
    painter.rect_stroke(r, Rounding::same(3.0), stroke);
    // lines
    for i in 0..4 {
        let y = (i as f32 * h).mul_add(0.37, c.y - h * 0.55);
        painter.line_segment(
            [
                Pos2::new(c.x - w * 0.7, y),
                Pos2::new(c.x + w * (i as f32).mul_add(-0.12, 0.55), y),
            ],
            Stroke::new(1.5, theme.border_strong),
        );
    }
    // bookmark fold
    let fold = [
        Pos2::new(c.x + w * 0.5, c.y - h),
        Pos2::new(c.x + w, c.y - h),
        Pos2::new(c.x + w, c.y - h * 0.55),
    ];
    painter.add(egui::Shape::line(fold.to_vec(), stroke));
}

pub fn privacy(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.34;
    let stroke = Stroke::new(2.0, theme.text_dim);
    // body
    let body = Rect::from_center_size(Pos2::new(c.x, c.y + s * 0.2), Vec2::new(s * 1.6, s * 1.3));
    painter.rect_stroke(body, Rounding::same(3.0), stroke);
    // shackle
    let arc: Vec<Pos2> = (0..=10)
        .map(|i| {
            let a = std::f32::consts::PI + i as f32 * std::f32::consts::PI / 10.0;
            Pos2::new(
                (s * 0.55).mul_add(a.cos(), c.x),
                (s * 0.55).mul_add(a.sin(), c.y - s * 0.35),
            )
        })
        .collect();
    painter.add(egui::Shape::line(arc, stroke));
    // keyhole
    painter.circle_filled(Pos2::new(c.x, c.y + s * 0.25), s * 0.12, theme.text_dim);
    painter.line_segment(
        [Pos2::new(c.x, c.y + s * 0.4), Pos2::new(c.x, c.y + s * 0.7)],
        Stroke::new(2.0, theme.text_dim),
    );
}

pub fn settings(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.36;
    let stroke = Stroke::new(2.0, theme.text_dim);
    // 8-tooth gear
    let n = 8;
    let pts: Vec<Pos2> = (0..(n * 2))
        .map(|i| {
            let a = i as f32 * std::f32::consts::PI / n as f32;
            let rad = if i % 2 == 0 { r } else { r * 0.72 };
            Pos2::new(c.x + rad * a.cos(), c.y + rad * a.sin())
        })
        .collect();
    let mut path = pts.clone();
    path.push(pts[0]);
    painter.add(egui::Shape::line(path, stroke));
    painter.circle_stroke(c, r * 0.38, stroke);
}

pub fn search(painter: &Painter, rect: Rect, theme: &Theme) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(2.0, theme.text_dim);
    let center = Pos2::new(c.x - r * 0.2, c.y - r * 0.2);
    painter.circle_stroke(center, r, stroke);
    painter.line_segment(
        [
            Pos2::new(c.x + r * 0.45, c.y + r * 0.45),
            Pos2::new(c.x + r * 0.85, c.y + r * 0.85),
        ],
        stroke,
    );
}

pub fn plus(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(2.0, color);
    painter.line_segment([Pos2::new(c.x - s, c.y), Pos2::new(c.x + s, c.y)], stroke);
    painter.line_segment([Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y + s)], stroke);
}

pub fn cross(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(2.0, color);
    painter.line_segment(
        [Pos2::new(c.x - s, c.y - s), Pos2::new(c.x + s, c.y + s)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + s, c.y - s), Pos2::new(c.x - s, c.y + s)],
        stroke,
    );
}

pub fn edit(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(2.0, color);
    // pencil body
    painter.line_segment(
        [
            Pos2::new(c.x - s, c.y + s * 0.2),
            Pos2::new(c.x + s * 0.4, c.y - s * 1.2),
        ],
        stroke,
    );
    // eraser
    painter.line_segment(
        [
            Pos2::new(c.x - s, c.y + s * 0.2),
            Pos2::new(c.x - s * 0.6, c.y + s * 0.6),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.6, c.y + s * 0.6),
            Pos2::new(c.x - s * 0.2, c.y + s * 0.2),
        ],
        stroke,
    );
}

pub fn trash(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.28;
    let h = w * 1.1;
    let stroke = Stroke::new(2.0, color);
    // lid
    painter.line_segment(
        [
            Pos2::new(c.x - w, c.y - h * 0.6),
            Pos2::new(c.x + w, c.y - h * 0.6),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.35, c.y - h * 0.6),
            Pos2::new(c.x - w * 0.35, c.y - h * 0.85),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x + w * 0.35, c.y - h * 0.6),
            Pos2::new(c.x + w * 0.35, c.y - h * 0.85),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.35, c.y - h * 0.85),
            Pos2::new(c.x + w * 0.35, c.y - h * 0.85),
        ],
        stroke,
    );
    // body
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.8, c.y - h * 0.5),
            Pos2::new(c.x - w * 0.6, c.y + h * 0.7),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x + w * 0.8, c.y - h * 0.5),
            Pos2::new(c.x + w * 0.6, c.y + h * 0.7),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.6, c.y + h * 0.7),
            Pos2::new(c.x + w * 0.6, c.y + h * 0.7),
        ],
        stroke,
    );
    // stripes
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.25, c.y - h * 0.25),
            Pos2::new(c.x - w * 0.15, c.y + h * 0.35),
        ],
        Stroke::new(1.5, color),
    );
    painter.line_segment(
        [
            Pos2::new(c.x + w * 0.05, c.y - h * 0.25),
            Pos2::new(c.x + w * 0.15, c.y + h * 0.35),
        ],
        Stroke::new(1.5, color),
    );
}

pub fn refresh(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.32;
    let stroke = Stroke::new(2.0, color);
    // arc
    let pts: Vec<Pos2> = (0..=14)
        .map(|i| {
            let a = i as f32 * std::f32::consts::TAU / 14.0 + 0.5;
            Pos2::new(c.x + r * a.cos(), c.y + r * a.sin())
        })
        .collect();
    painter.add(egui::Shape::line(pts.clone(), stroke));
    // arrow head
    let tip = pts.last().copied().unwrap_or(c);
    let prev = pts[pts.len().saturating_sub(2)];
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

pub fn run(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let pts = vec![
        Pos2::new(c.x - s * 0.5, c.y - s),
        Pos2::new(c.x + s * 0.8, c.y),
        Pos2::new(c.x - s * 0.5, c.y + s),
    ];
    painter.add(egui::Shape::closed_line(pts, Stroke::new(2.0, color)));
}

pub fn stop(painter: &Painter, rect: Rect, color: Color32) {
    let r = rect.shrink(rect.width().min(rect.height()) * 0.32);
    painter.rect_stroke(r, Rounding::same(3.0), Stroke::new(2.0, color));
}

pub fn chevron_left(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(2.0, color);
    painter.line_segment(
        [
            Pos2::new(c.x + s * 0.4, c.y - s),
            Pos2::new(c.x - s * 0.4, c.y),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.4, c.y),
            Pos2::new(c.x + s * 0.4, c.y + s),
        ],
        stroke,
    );
}

pub fn chevron_right(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(2.0, color);
    painter.line_segment(
        [
            Pos2::new(c.x - s * 0.4, c.y - s),
            Pos2::new(c.x + s * 0.4, c.y),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x + s * 0.4, c.y),
            Pos2::new(c.x - s * 0.4, c.y + s),
        ],
        stroke,
    );
}

pub fn chevron_down(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(2.0, color);
    painter.line_segment(
        [
            Pos2::new(c.x - s, c.y - s * 0.4),
            Pos2::new(c.x, c.y + s * 0.4),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x, c.y + s * 0.4),
            Pos2::new(c.x + s, c.y - s * 0.4),
        ],
        stroke,
    );
}

pub fn dot(painter: &Painter, rect: Rect, color: Color32) {
    painter.circle_filled(rect.center(), rect.width().min(rect.height()) * 0.28, color);
}

pub fn bell(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(2.0, color);
    // bell body arc
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
    // top knob
    painter.circle_filled(Pos2::new(c.x, c.y - w * 0.85), w * 0.18, color);
    // bottom clapper
    painter.circle_filled(Pos2::new(c.x, c.y + w * 0.95), w * 0.2, color);
    // base line
    painter.line_segment(
        [
            Pos2::new(c.x - w, c.y + w * 0.9),
            Pos2::new(c.x + w, c.y + w * 0.9),
        ],
        stroke,
    );
}

pub fn sun(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.22;
    let stroke = Stroke::new(2.0, color);
    painter.circle_stroke(c, r, stroke);
    for i in 0..8 {
        let a = i as f32 * std::f32::consts::FRAC_PI_4;
        let p1 = Pos2::new(
            (r * 1.5).mul_add(a.cos(), c.x),
            (r * 1.5).mul_add(-a.sin(), c.y),
        );
        let p2 = Pos2::new(
            (r * 2.0).mul_add(a.cos(), c.x),
            (r * 2.0).mul_add(-a.sin(), c.y),
        );
        painter.line_segment([p1, p2], stroke);
    }
}

pub fn moon(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let r = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(2.0, color);
    // crescent
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
    let stroke = Stroke::new(2.5, color);
    painter.line_segment(
        [
            Pos2::new(c.x - s, c.y),
            Pos2::new(c.x - s * 0.15, c.y + s * 0.75),
        ],
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
    let stroke = Stroke::new(2.0, color);
    // funnel top
    painter.line_segment(
        [Pos2::new(c.x - w, c.y - w), Pos2::new(c.x + w, c.y - w)],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - w, c.y - w),
            Pos2::new(c.x - w * 0.35, c.y + w * 0.3),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x + w, c.y - w),
            Pos2::new(c.x + w * 0.35, c.y + w * 0.3),
        ],
        stroke,
    );
    // stem
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.35, c.y + w * 0.3),
            Pos2::new(c.x - w * 0.35, c.y + w * 0.9),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x + w * 0.35, c.y + w * 0.3),
            Pos2::new(c.x + w * 0.35, c.y + w * 0.9),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.35, c.y + w * 0.9),
            Pos2::new(c.x + w * 0.35, c.y + w * 0.9),
        ],
        stroke,
    );
}

pub fn download(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(2.0, color);
    // arrow down
    painter.line_segment(
        [Pos2::new(c.x, c.y - s), Pos2::new(c.x, c.y + s * 0.6)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - s * 0.6, c.y), Pos2::new(c.x, c.y + s * 0.6)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + s * 0.6, c.y), Pos2::new(c.x, c.y + s * 0.6)],
        stroke,
    );
    // tray
    painter.line_segment(
        [
            Pos2::new(c.x - s, c.y + s * 0.8),
            Pos2::new(c.x + s, c.y + s * 0.8),
        ],
        stroke,
    );
}

pub fn upload(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.28;
    let stroke = Stroke::new(2.0, color);
    // arrow up
    painter.line_segment(
        [Pos2::new(c.x, c.y + s), Pos2::new(c.x, c.y - s * 0.6)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x - s * 0.6, c.y), Pos2::new(c.x, c.y - s * 0.6)],
        stroke,
    );
    painter.line_segment(
        [Pos2::new(c.x + s * 0.6, c.y), Pos2::new(c.x, c.y - s * 0.6)],
        stroke,
    );
    // tray
    painter.line_segment(
        [
            Pos2::new(c.x - s, c.y + s * 0.8),
            Pos2::new(c.x + s, c.y + s * 0.8),
        ],
        stroke,
    );
}

pub fn menu(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(2.0, color);
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
    let c = rect.center();
    let s = rect.width().min(rect.height()) * 0.3;
    let stroke = Stroke::new(2.0, color);
    // four-point star
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
    path.push(pts[0]);
    painter.add(egui::Shape::line(path, stroke));
}

pub fn folder(painter: &Painter, rect: Rect, color: Color32) {
    let c = rect.center();
    let w = rect.width().min(rect.height()) * 0.32;
    let h = w * 0.75;
    let stroke = Stroke::new(2.0, color);
    // back tab
    painter.line_segment(
        [
            Pos2::new(c.x - w, c.y - h * 0.6),
            Pos2::new(c.x - w * 0.35, c.y - h * 0.6),
        ],
        stroke,
    );
    painter.line_segment(
        [
            Pos2::new(c.x - w * 0.35, c.y - h * 0.6),
            Pos2::new(c.x - w * 0.15, c.y - h * 0.35),
        ],
        stroke,
    );
    // folder body
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
    let stroke = Stroke::new(2.0, color);
    painter.rect_stroke(r, Rounding::same(8.0), stroke);
    // tail
    let tail = [
        Pos2::new(c.x - w * 0.35, c.y + h),
        Pos2::new(c.x - w * 0.1, c.y + h + w * 0.35),
        Pos2::new(c.x + w * 0.1, c.y + h),
    ];
    painter.add(egui::Shape::closed_line(tail.to_vec(), stroke));
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
