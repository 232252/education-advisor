//! Dashboard: KPI cards + charts overview (DeepSeek-style dark sci-fi UI).
//!
//! Mirrors the reference HTML dashboard:
//! - KPI grid (4 columns, gap 16px): 学生总数 / 需关注学生 / 平均 GPA / 今日任务
//! - Chart grid: full-width trend chart + donut + radar (2 columns)
//! - Bottom grid (2fr 1fr): AI 代理活动流 + 知识库状态

use std::time::Instant;

use eframe::egui::{self, Align2, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Ui, Vec2};

use crate::app::App;
use crate::ui::icons;
use crate::ui::widgets::{capsule_progress, glass_card, ghost_button, kpi_card, panel_title};

type KpiCardDef<'a> = (
    &'a str,
    String,
    fn(&eframe::egui::Painter, Rect, &crate::theme::Theme),
    eframe::egui::Color32,
);

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();

    // Read stats
    let stats = app.stats.read();
    let s = stats.as_ref();
    let total = s.map_or(0, |s| s.total_students);
    let avg = s.map_or(0.0, |s| s.avg_gpa);
    let convs = s.map_or(0, |s| s.conversations_today);
    let risk = s.map_or([0; 4], |s| s.risk_distribution);
    let attention = risk[2] + risk[3]; // high + critical
    let grade_trend: Vec<f32> = s
        .map(|s| s.grade_trend.iter().map(|(_, v)| *v * 100.0).collect())
        .unwrap_or_default();
    let agent_activity = s.map(|s| s.agent_activity.clone()).unwrap_or_default();
    drop(stats);

    // ── KPI grid (4 columns, gap 16px; 2 columns if narrow) ──
    let avail_w = ui.available_width();
    let (cols, card_w) = if avail_w < 720.0 {
        (2, ((avail_w - 16.0) / 2.0).max(160.0))
    } else {
        (4, ((avail_w - 48.0) / 4.0).max(160.0))
    };

    // Staggered entrance animation: each card delayed 80ms.
    let entrance_start = ui.ctx().memory_mut(|mem| {
        *mem.data
            .get_temp_mut_or_insert_with(ui.id().with("dashboard_entrance"), Instant::now)
    });
    let elapsed_ms = entrance_start.elapsed().as_millis() as f32;

    let cards: [KpiCardDef; 4] = [
        ("学生总数", total.to_string(), icons::circle_check, theme.cyan),
        ("需关注学生", attention.to_string(), icons::triangle_warning, theme.purple),
        ("平均 GPA", format!("{avg:.1}"), icons::arrow_up, theme.accent),
        ("今日任务", convs.to_string(), icons::clock, Color32::from_rgb(226, 232, 240)),
    ];

    for (row_idx, row) in cards.chunks(cols).enumerate() {
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(16.0, 16.0);
            for (col_idx, (label, value, icon, accent)) in row.iter().enumerate() {
                let idx = row_idx * cols + col_idx;
                let delay = idx as f32 * 80.0;
                let entrance = crate::charts::animated_value(1.0, elapsed_ms - delay);
                kpi_card(ui, &theme, label, value, *icon, *accent, card_w, entrance);
            }
        });
    }

    ui.add_space(20.0);

    // ── Chart grid: full-width trend chart panel (~320px) ──
    glass_card(ui, &theme, |ui| {
        panel_title(ui, &theme, "活跃度趋势");
        crate::charts::smooth_area_chart(ui, &theme, "", &grade_trend, theme.accent, 260.0);
    });

    ui.add_space(20.0);

    // ── Pie + Radar (2 columns, gap 20px, ~300px each) ──
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing = Vec2::new(20.0, 0.0);
        let gap = 20.0;
        let half_w = ((ui.available_width() - gap) / 2.0).max(160.0);

        ui.vertical(|ui| {
            ui.set_width(half_w);
            glass_card(ui, &theme, |ui| {
                panel_title(ui, &theme, "风险分布");
                let segments: [(&str, f32, Color32); 4] = [
                    ("低风险", risk[0] as f32, theme.success),
                    ("中风险", risk[1] as f32, theme.warning),
                    ("高风险", risk[2] as f32, Color32::from_rgb(249, 115, 22)),
                    ("危机", risk[3] as f32, theme.danger),
                ];
                crate::charts::donut_chart(ui, &theme, "", &segments, 220.0);
            });
        });

        ui.vertical(|ui| {
            ui.set_width(half_w);
            glass_card(ui, &theme, |ui| {
                panel_title(ui, &theme, "学生多维评估");
                let axes = ["学术能力", "综合素质", "心理状态", "出勤率", "社交活跃"];
                let values = [0.85, 0.75, 0.80, 0.92, 0.70];
                crate::charts::radar_chart(ui, &theme, "", &axes, &values, theme.accent, 220.0);
            });
        });
    });

    ui.add_space(20.0);

    // ── Bottom grid: 2fr 1fr (AI activity stream + knowledge base status) ──
    ui.horizontal_top(|ui| {
        ui.spacing_mut().item_spacing = Vec2::new(20.0, 0.0);
        let gap = 20.0;
        let avail = ui.available_width();
        let left_w = ((avail - gap) * 2.0 / 3.0).max(200.0);
        let right_w = ((avail - gap) / 3.0).max(160.0);

        // Left: AI 代理活动流
        ui.vertical(|ui| {
            ui.set_width(left_w);
            glass_card(ui, &theme, |ui| {
                panel_title(ui, &theme, "AI 代理活动流");
                if agent_activity.is_empty() {
                    // Placeholder items when no real activity data.
                    let placeholders: [(&str, &str); 5] = [
                        ("risk-alert", "刚刚"),
                        ("academic", "2分钟前"),
                        ("psychology", "5分钟前"),
                        ("counselor", "10分钟前"),
                        ("weekly-reporter", "15分钟前"),
                    ];
                    for (agent_id, time) in placeholders.iter() {
                        if let Some(agent) = crate::agents::find(agent_id) {
                            let color = Color32::from_rgb(
                                agent.color[0],
                                agent.color[1],
                                agent.color[2],
                            );
                            activity_item(ui, &theme, color, agent.name, time);
                            ui.add_space(6.0);
                        }
                    }
                } else {
                    for (agent_id, count) in agent_activity.iter().take(6) {
                        let agent = crate::agents::find(agent_id);
                        let name = agent.map_or(agent_id.as_str(), |a| a.name);
                        let color = agent
                            .map(|a| Color32::from_rgb(a.color[0], a.color[1], a.color[2]))
                            .unwrap_or(theme.accent);
                        let time = format!("{count} 次");
                        activity_item(ui, &theme, color, name, &time);
                        ui.add_space(6.0);
                    }
                }
            });
        });

        // Right: 知识库状态
        ui.vertical(|ui| {
            ui.set_width(right_w);
            glass_card(ui, &theme, |ui| {
                panel_title(ui, &theme, "知识库状态");
                kb_progress(ui, &theme, "扫描文件", 43.0, 100.0);
                kb_progress(ui, &theme, "索引建立", 28.0, 50.0);
                kb_progress(ui, &theme, "向量入库", 15.0, 30.0);
                kb_progress(ui, &theme, "文档解析", 36.0, 80.0);
            });
        });
    });

    // Refresh button
    ui.with_layout(Layout::right_to_left(egui::Align::TOP), |ui| {
        if ghost_button(ui, &theme, "刷新数据").clicked() {
            let _ = app.runtime.tx.send(crate::runtime::Command::LoadStats);
            let _ = app.runtime.tx.send(crate::runtime::Command::LoadStudents);
            let _ = app
                .runtime
                .tx
                .send(crate::runtime::Command::LoadConversations);
            app.push_toast(crate::runtime::ToastKind::Info, "正在刷新数据…");
        }
    });
}

/// A single activity item: colored glowing dot + agent name + time.
/// Mirrors the reference: `padding 8px 12px; background: rgba(255,255,255,0.03);
/// border-radius: 12px` with an 8px glowing dot, 13px name, 12px time.
fn activity_item(
    ui: &mut Ui,
    theme: &crate::theme::Theme,
    color: Color32,
    name: &str,
    time: &str,
) {
    let height = 32.0;
    let (rect, _) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), height), Sense::hover());
    // Background: rgba(255,255,255,0.03)
    let bg = Color32::from_rgba_premultiplied(255, 255, 255, 8);
    ui.painter().rect_filled(rect, Rounding::same(12.0), bg);

    let pad_x = 12.0;
    let center_y = rect.center().y;

    // Glowing dot: 8px glow + 4px core (box-shadow: 0 0 8px color).
    let dot_x = rect.min.x + pad_x + 4.0;
    let glow = Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 60);
    ui.painter()
        .circle_filled(Pos2::new(dot_x, center_y), 8.0, glow);
    ui.painter()
        .circle_filled(Pos2::new(dot_x, center_y), 4.0, color);

    // Agent name (13px, #94a3b8 = theme.text_dim)
    ui.painter().text(
        Pos2::new(rect.min.x + pad_x + 16.0, center_y),
        Align2::LEFT_CENTER,
        name,
        FontId::proportional(13.0),
        theme.text_dim,
    );

    // Time (12px, #64748b = theme.text_faint)
    ui.painter().text(
        Pos2::new(rect.max.x - pad_x, center_y),
        Align2::RIGHT_CENTER,
        time,
        FontId::proportional(12.0),
        theme.text_faint,
    );
}

/// Knowledge base progress row: label (left) + X/Y (right) + capsule progress bar.
fn kb_progress(
    ui: &mut Ui,
    theme: &crate::theme::Theme,
    label: &str,
    value: f32,
    max: f32,
) {
    let (rect, _) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), 18.0), Sense::hover());
    // Label (13px, left)
    ui.painter().text(
        rect.min,
        Align2::LEFT_TOP,
        label,
        FontId::proportional(13.0),
        theme.text_dim,
    );
    // Value X/Y (12px, right)
    ui.painter().text(
        Pos2::new(rect.max.x, rect.min.y),
        Align2::RIGHT_TOP,
        format!("{}/{}", value as i32, max as i32),
        FontId::proportional(12.0),
        theme.text_faint,
    );
    ui.add_space(6.0);
    // 4px track with blue→purple gradient fill.
    capsule_progress(ui, theme, value, max, theme.purple, false);
    ui.add_space(14.0);
}
