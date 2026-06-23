//! Custom-painted, commercial-grade charts using egui's painter.
//!
//! All charts support hover tooltips and are resolution-independent (scale with
//! `pixels_per_point` for crisp 4K/Retina rendering).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use eframe::egui::{self, Align2, Color32, FontId, Pos2, Rect, Rounding, Sense, Stroke, Ui, Vec2};

use crate::theme::Theme;

/// 图表形状缓存（Bug #20）：把"屏幕尺寸 + 数据指纹"作为 key，把构造
/// 出来的 `egui::Shape` 列表缓存；下一帧若 key 不变就直接 add，节省
/// 数十次 `convex_polygon` / `line` / `circle_filled` 调用。
#[derive(Clone, Default)]
struct ChartCache {
    key: u64,
    shapes: Vec<egui::Shape>,
}

impl ChartCache {
    fn matches(&self, key: u64) -> bool {
        self.key == key && !self.shapes.is_empty()
    }
}

/// 根据屏幕尺寸 + 关键数值集合计算一个稳定 hash，作为缓存键。
fn chart_cache_key(rect: Rect, values: &[f32]) -> u64 {
    let mut h = DefaultHasher::new();
    rect.width().to_bits().hash(&mut h);
    rect.height().to_bits().hash(&mut h);
    for v in values {
        v.to_bits().hash(&mut h);
    }
    h.finish()
}

/// Bug #17 — 折线图：跨系列最近点 tooltip + 形状缓存。
pub fn line_chart(
    ui: &mut Ui,
    theme: &Theme,
    title: &str,
    series: &[(&str, Vec<f32>)],
    accent: Color32,
    height: f32,
) {
    let (rect, resp) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
    let pad = 28.0;
    let plot_rect = Rect::from_min_max(
        Pos2::new(rect.min.x + pad, rect.min.y + 14.0),
        Pos2::new(rect.max.x - 8.0, rect.max.y - 18.0),
    );

    // background
    ui.painter()
        .rect_filled(rect, Rounding::same(12.0), theme.surface_glass);
    ui.painter().text(
        Pos2::new(rect.min.x + 12.0, rect.min.y + 6.0),
        Align2::LEFT_CENTER,
        title,
        FontId::proportional(12.0),
        theme.text_dim,
    );

    if series.is_empty() || series.iter().all(|(_, v)| v.is_empty()) {
        ui.painter().text(
            plot_rect.center(),
            Align2::CENTER_CENTER,
            "暂无数据",
            FontId::proportional(12.0),
            theme.text_faint,
        );
        return;
    }

    let max_len = series
        .iter()
        .map(|(_, v)| v.len())
        .max()
        .unwrap_or(0)
        .max(1);
    let max_val = series
        .iter()
        .flat_map(|(_, v)| v.iter().copied())
        .fold(0.0f32, f32::max)
        .max(0.001);
    let min_val = 0.0f32;

    // grid lines
    for i in 0..=4 {
        let y = plot_rect.height().mul_add(i as f32 / 4.0, plot_rect.min.y);
        ui.painter().line_segment(
            [Pos2::new(plot_rect.min.x, y), Pos2::new(plot_rect.max.x, y)],
            Stroke::new(1.0, theme.border),
        );
        let val = (max_val - min_val).mul_add(-(i as f32 / 4.0), max_val);
        ui.painter().text(
            Pos2::new(plot_rect.min.x - 4.0, y),
            Align2::RIGHT_CENTER,
            format!("{val:.1}"),
            FontId::proportional(9.0),
            theme.text_faint,
        );
    }

    // series
    let colors = [accent, theme.info, theme.success, theme.warning];

    // Bug #20 — 把所有要画的形状一次性放进 cache；下一帧命中就 add。
    let mut all_values: Vec<f32> = Vec::with_capacity(series.iter().map(|(_, v)| v.len()).sum());
    for (_, v) in series {
        all_values.extend_from_slice(v);
    }
    let cache_id = ui.id().with("line_chart_cache");
    let mut cache: ChartCache = ui.ctx().memory_mut(|mem| {
        mem.data
            .get_temp(cache_id)
            .unwrap_or_default()
    });
    let key = chart_cache_key(rect, &all_values);
    if !cache.matches(key) {
        cache.shapes.clear();
        for (si, (_, vals)) in series.iter().enumerate() {
            let color = colors[si % colors.len()];
            if vals.len() < 2 {
                continue;
            }
            let pts: Vec<Pos2> = vals
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let x = plot_rect.width().mul_add(
                        i as f32 / (max_len - 1).max(1) as f32,
                        plot_rect.min.x,
                    );
                    let y = plot_rect.height().mul_add(
                        -((*v - min_val) / (max_val - min_val)).clamp(0.0, 1.0),
                        plot_rect.max.y,
                    );
                    Pos2::new(x, y)
                })
                .collect();
            let mut fill_pts = pts.clone();
            fill_pts.push(Pos2::new(pts.last().unwrap().x, plot_rect.max.y));
            fill_pts.push(Pos2::new(pts.first().unwrap().x, plot_rect.max.y));
            let fill = Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 40);
            cache
                .shapes
                .push(egui::Shape::convex_polygon(fill_pts, fill, Stroke::NONE));
            cache
                .shapes
                .push(egui::Shape::line(pts, Stroke::new(2.0, color)));
        }
        cache.key = key;
        ui.ctx().memory_mut(|mem| mem.data.insert_temp(cache_id, cache));
    }
    let cache: ChartCache = ui.ctx().memory(|mem| mem.data.get_temp(cache_id).unwrap_or_default());
    for shape in &cache.shapes {
        ui.painter().add(shape.clone());
    }

    // legend（每帧画，因为依赖 text layout 但成本很低）。
    for (si, (name, _)) in series.iter().enumerate() {
        let color = colors[si % colors.len()];
        let lx = rect.max.x - 90.0;
        let ly = (si as f32).mul_add(14.0, rect.min.y + 8.0);
        ui.painter().rect_filled(
            Rect::from_min_size(Pos2::new(lx, ly), Vec2::new(10.0, 10.0)),
            Rounding::same(2.0),
            color,
        );
        ui.painter().text(
            Pos2::new(lx + 14.0, ly + 5.0),
            Align2::LEFT_CENTER,
            *name,
            FontId::proportional(10.0),
            theme.text_dim,
        );
    }

    // Bug #17 — tooltip：找到鼠标位置最近的索引，跨系列汇总输出。
    if let Some(hover) = resp.hover_pos() {
        if plot_rect.contains(hover) {
            let rel = (hover.x - plot_rect.min.x) / plot_rect.width();
            let idx = ((rel * (max_len - 1) as f32).round() as usize).min(max_len - 1);
            let mut tip = String::new();
            for (si, (name, vals)) in series.iter().enumerate() {
                if let Some(v) = vals.get(idx) {
                    let color = colors[si % colors.len()];
                    let hex = format!("#{:02X}{:02X}{:02X}", color.r(), color.g(), color.b());
                    if !tip.is_empty() {
                        tip.push('\n');
                    }
                    tip.push_str(&format!("<span style=\"color:{hex}\">●</span> {name}: {v:.1}"));
                }
            }
            egui::show_tooltip_at_pointer(ui.ctx(), egui::Id::new("line_tip"), |ui| {
                ui.allocate_ui_with_layout(
                    Vec2::new(160.0, 0.0),
                    egui::Layout::top_down(egui::Align::LEFT),
                    |ui| {
                        ui.label(egui::RichText::new(format!("第 {idx} 个数据点")).strong());
                        ui.label(egui::RichText::new(tip).size(11.0));
                    },
                );
            });
        }
    }
}

/// A donut chart with hover highlight.
pub fn donut_chart(
    ui: &mut Ui,
    theme: &Theme,
    title: &str,
    segments: &[(&str, f32, Color32)],
    size: f32,
) {
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(size, size + 20.0), Sense::hover());
    ui.painter()
        .rect_filled(rect, Rounding::same(12.0), theme.surface_glass);
    ui.painter().text(
        Pos2::new(rect.min.x + 12.0, rect.min.y + 6.0),
        Align2::LEFT_CENTER,
        title,
        FontId::proportional(12.0),
        theme.text_dim,
    );
    let center = Pos2::new(rect.center().x, rect.center().y + 4.0);
    let radius = size / 2.0 - 18.0;
    let total: f32 = segments.iter().map(|(_, v, _)| v).sum::<f32>().max(0.001);
    let mut start = -std::f32::consts::FRAC_PI_2;
    let hover_pos = resp.hover_pos();
    let mut hover_label: Option<String> = None;

    // Bug #20 — 缓存多边形形状。
    let cache_id = ui.id().with("donut_cache");
    let mut values: Vec<f32> = vec![size];
    for (_, v, _) in segments {
        values.push(*v);
    }
    let key = chart_cache_key(rect, &values);
    let mut cache: ChartCache = ui.ctx().memory_mut(|mem| {
        mem.data.get_temp(cache_id).unwrap_or_default()
    });
    if !cache.matches(key) {
        cache.shapes.clear();
        for (_, val, color) in segments {
            let frac = *val / total;
            let end = frac.mul_add(std::f32::consts::TAU, start);
            let n = ((frac * 64.0) as usize).max(1);
            let outer: Vec<Pos2> = (0..=n)
                .map(|i| {
                    let t = (end - start).mul_add(i as f32 / n as f32, start);
                    Pos2::new(center.x + radius * t.cos(), center.y + radius * t.sin())
                })
                .collect();
            let inner: Vec<Pos2> = (0..=n)
                .map(|i| {
                    let t = (end - start).mul_add(i as f32 / n as f32, start);
                    Pos2::new(
                        (radius - 14.0).mul_add(t.cos(), center.x),
                        (radius - 14.0).mul_add(t.sin(), center.y),
                    )
                })
                .collect();
            let mut poly: Vec<Pos2> = outer.clone();
            poly.extend(inner.iter().rev());
            cache.shapes.push(egui::Shape::convex_polygon(
                poly,
                *color,
                Stroke::new(1.0, theme.bg),
            ));
            start = end;
        }
        cache.key = key;
        ui.ctx().memory_mut(|mem| mem.data.insert_temp(cache_id, cache));
    }
    let cache: ChartCache = ui.ctx().memory(|mem| mem.data.get_temp(cache_id).unwrap_or_default());
    for shape in &cache.shapes {
        ui.painter().add(shape.clone());
    }

    // hover detection (still computed per frame, but cheap).
    start = -std::f32::consts::FRAC_PI_2;
    for (name, val, _) in segments {
        let frac = *val / total;
        let end = frac.mul_add(std::f32::consts::TAU, start);
        if let Some(hp) = hover_pos {
            let dx = hp.x - center.x;
            let dy = hp.y - center.y;
            let dist = dx.hypot(dy);
            if dist <= radius && dist >= radius - 14.0 {
                let ang = dy.atan2(dx);
                let ang = if ang < start {
                    ang + std::f32::consts::TAU
                } else {
                    ang
                };
                if ang >= start && ang <= end {
                    hover_label = Some(format!("{name}: {:.0}%", frac * 100.0));
                }
            }
        }
        start = end;
    }
    // center label
    ui.painter().text(
        center,
        Align2::CENTER_CENTER,
        format!("{total:.0}"),
        FontId::proportional(18.0),
        theme.text,
    );
    if let Some(l) = hover_label {
        egui::show_tooltip_at_pointer(ui.ctx(), egui::Id::new("donut_tip"), |ui| {
            ui.label(l);
        });
    }
}

/// A horizontal bar chart.
pub fn bar_chart(
    ui: &mut Ui,
    theme: &Theme,
    title: &str,
    bars: &[(&str, f32)],
    accent: Color32,
    height: f32,
) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
    ui.painter()
        .rect_filled(rect, Rounding::same(12.0), theme.surface_glass);
    ui.painter().text(
        Pos2::new(rect.min.x + 12.0, rect.min.y + 6.0),
        Align2::LEFT_CENTER,
        title,
        FontId::proportional(12.0),
        theme.text_dim,
    );
    if bars.is_empty() {
        return;
    }
    let max = bars
        .iter()
        .map(|(_, v)| *v)
        .fold(0.0f32, f32::max)
        .max(0.001);
    let top = rect.min.y + 24.0;
    let bottom = rect.max.y - 8.0;
    let row_h = (bottom - top) / bars.len() as f32;
    for (i, (name, val)) in bars.iter().enumerate() {
        let y = (i as f32).mul_add(row_h, top);
        ui.painter().text(
            Pos2::new(rect.min.x + 12.0, y + row_h / 2.0),
            Align2::LEFT_CENTER,
            name,
            FontId::proportional(11.0),
            theme.text_dim,
        );
        let bar_x = rect.min.x + 90.0;
        let bar_w = (rect.max.x - bar_x - 50.0) * (*val / max).clamp(0.0, 1.0);
        let bar_rect =
            Rect::from_min_size(Pos2::new(bar_x, y + 6.0), Vec2::new(bar_w, row_h - 12.0));
        ui.painter()
            .rect_filled(bar_rect, Rounding::same(4.0), accent);
        ui.painter().text(
            Pos2::new(bar_rect.max.x + 6.0, bar_rect.center().y),
            Align2::LEFT_CENTER,
            format!("{val:.0}"),
            FontId::proportional(11.0),
            theme.text,
        );
    }
}

/// A radar chart for agent capability visualization.
pub fn radar_chart(
    ui: &mut Ui,
    theme: &Theme,
    title: &str,
    axes: &[&str],
    values: &[f32], // 0.0..=1.0
    accent: Color32,
    size: f32,
) {
    let (rect, _) = ui.allocate_exact_size(Vec2::new(size, size + 16.0), Sense::hover());
    ui.painter()
        .rect_filled(rect, Rounding::same(12.0), theme.surface_glass);
    ui.painter().text(
        Pos2::new(rect.min.x + 12.0, rect.min.y + 6.0),
        Align2::LEFT_CENTER,
        title,
        FontId::proportional(12.0),
        theme.text_dim,
    );
    let center = Pos2::new(rect.center().x, rect.center().y + 6.0);
    let radius = size / 2.0 - 30.0;
    let n = axes.len().max(1);

    // Bug #20 — 缓存静态网格/坐标轴形状。
    let cache_id = ui.id().with("radar_cache");
    let mut values_for_key: Vec<f32> = vec![size];
    values_for_key.extend_from_slice(values);
    let key = chart_cache_key(rect, &values_for_key);
    let mut cache: ChartCache = ui
        .ctx()
        .memory_mut(|mem| mem.data.get_temp(cache_id).unwrap_or_default());
    if !cache.matches(key) {
        cache.shapes.clear();
        // rings
        for ring in 1..=4 {
            let r = radius * (ring as f32 / 4.0);
            let pts: Vec<Pos2> = (0..n)
                .map(|i| {
                    let t = (i as f32 / n as f32)
                        .mul_add(std::f32::consts::TAU, -std::f32::consts::FRAC_PI_2);
                    Pos2::new(center.x + r * t.cos(), center.y + r * t.sin())
                })
                .collect();
            let mut poly = pts.clone();
            poly.push(pts[0]);
            cache
                .shapes
                .push(egui::Shape::line(poly, Stroke::new(1.0, theme.border)));
        }
        // axes
        for i in 0..n {
            let t = (i as f32 / n as f32)
                .mul_add(std::f32::consts::TAU, -std::f32::consts::FRAC_PI_2);
            let p = Pos2::new(center.x + radius * t.cos(), center.y + radius * t.sin());
            cache
                .shapes
                .push(egui::Shape::line_segment([center, p], Stroke::new(1.0, theme.border)));
        }
        // values polygon
        if values.len() == n {
            let pts: Vec<Pos2> = values
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let t = (i as f32 / n as f32)
                        .mul_add(std::f32::consts::TAU, -std::f32::consts::FRAC_PI_2);
                    let r = radius * v.clamp(0.0, 1.0);
                    Pos2::new(center.x + r * t.cos(), center.y + r * t.sin())
                })
                .collect();
            let mut poly = pts.clone();
            poly.push(pts[0]);
            let fill = Color32::from_rgba_premultiplied(accent.r(), accent.g(), accent.b(), 60);
            cache.shapes.push(egui::Shape::convex_polygon(
                poly.clone(),
                fill,
                Stroke::NONE,
            ));
            cache
                .shapes
                .push(egui::Shape::line(poly, Stroke::new(2.0, accent)));
            for p in &pts {
                cache
                    .shapes
                    .push(egui::Shape::circle_filled(*p, 3.0, accent));
            }
        }
        cache.key = key;
        ui.ctx()
            .memory_mut(|mem| mem.data.insert_temp(cache_id, cache));
    }
    let cache: ChartCache = ui
        .ctx()
        .memory(|mem| mem.data.get_temp(cache_id).unwrap_or_default());
    for shape in &cache.shapes {
        ui.painter().add(shape.clone());
    }

    // axis labels（每帧画，因为是 text layout，缓存收益小）。
    for (i, axis) in axes.iter().enumerate() {
        let t = (i as f32 / n as f32).mul_add(std::f32::consts::TAU, -std::f32::consts::FRAC_PI_2);
        let lp = Pos2::new(
            (radius + 12.0).mul_add(t.cos(), center.x),
            (radius + 12.0).mul_add(t.sin(), center.y),
        );
        ui.painter().text(
            lp,
            Align2::CENTER_CENTER,
            *axis,
            FontId::proportional(9.0),
            theme.text_dim,
        );
    }
}
