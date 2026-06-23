//! Dashboard: KPI cards + charts overview.

use std::time::Instant;

use eframe::egui::{self, FontId, Rect, Ui, Vec2};

use crate::app::{App, Page};
use crate::ui::icons;
use crate::ui::widgets::{
    capsule_progress, empty_state, empty_state_with_cta, ghost_button, glass_card, kpi_card,
    section_title,
};

type KpiCardDef<'a> = (
    &'a str,
    String,
    fn(&eframe::egui::Painter, Rect, &crate::theme::Theme),
    eframe::egui::Color32,
);

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    section_title(ui, &theme, "总览");

    // KPI 行：按屏幕宽度自适应（窄屏 2 列，宽屏 4 列）。
    let avail_w = ui.available_width();
    let (cols, card_w) = if avail_w < 720.0 {
        (2usize, ((avail_w - 8.0) / 2.0).max(140.0))
    } else if avail_w < 1100.0 {
        (2, ((avail_w - 24.0) / 2.0).max(160.0))
    } else {
        (4, ((avail_w - 24.0) / 4.0).max(160.0))
    };

    let stats = app.stats.read();
    let s = stats.as_ref();
    let total = s.map_or(0, |s| s.total_students);
    let avg = s.map_or(0.0, |s| s.avg_gpa);
    let convs = s.map_or(0, |s| s.conversations_today);
    let tools = s.map_or(0, |s| s.tool_calls_total);
    let risk = s.map_or([0; 4], |s| s.risk_distribution);
    let grade_trend: Vec<f32> = s
        .map(|s| s.grade_trend.iter().map(|(_, v)| *v * 100.0).collect())
        .unwrap_or_default();
    let agent_activity = s.map(|s| s.agent_activity.clone()).unwrap_or_default();
    drop(stats);

    // KPI 卡片错落入场动画：记录首次渲染时间，每张卡片延迟 0.08s。
    let entrance_start = ui.ctx().memory_mut(|mem| {
        *mem.data
            .get_temp_mut_or_insert_with(ui.id().with("dashboard_entrance"), Instant::now)
    });
    let elapsed_ms = entrance_start.elapsed().as_millis() as f32;

    let cards: [KpiCardDef; 4] = [
        (
            "学生总数",
            total.to_string(),
            icons::book_icon,
            theme.gradient_primary_to,
        ),
        (
            "平均 GPA",
            format!("{avg:.2}"),
            icons::trend_arrow_icon,
            theme.success,
        ),
        (
            "今日对话",
            convs.to_string(),
            icons::chat_bubble_icon,
            theme.info,
        ),
        (
            "工具调用",
            tools.to_string(),
            icons::tool_wrench_icon,
            theme.warning,
        ),
    ];

    for (row_idx, row) in cards.chunks(cols).enumerate() {
        ui.horizontal(|ui| {
            let gap = 8.0;
            ui.spacing_mut().item_spacing = Vec2::new(gap, 8.0);
            for (col_idx, (label, value, icon, accent)) in row.iter().enumerate() {
                let idx = row_idx * cols + col_idx;
                let delay = idx as f32 * 80.0;
                let entrance = crate::charts::animated_value(1.0, elapsed_ms - delay);
                kpi_card(
                    ui,
                    &theme,
                    label,
                    value,
                    *icon,
                    *accent,
                    card_w,
                    entrance,
                );
            }
        });
    }

    ui.add_space(8.0);

    // charts row
    ui.horizontal_top(|ui| {
        // left: grade trend + risk distribution
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width() / 2.0);

            glass_card(ui, &theme, |ui| {
                section_title(ui, &theme, "成绩趋势");
                crate::charts::smooth_area_chart(
                    ui,
                    &theme,
                    "平均得分率%",
                    &grade_trend,
                    theme.accent,
                    180.0,
                );
            });

            ui.add_space(8.0);

            glass_card(ui, &theme, |ui| {
                section_title(ui, &theme, "风险分布");
                let total_risk = risk.iter().sum::<usize>().max(1) as f32;
                let segs: [(eframe::egui::Color32, f32); 4] = [
                    (theme.success, risk[0] as f32),
                    (theme.warning, risk[1] as f32),
                    (
                        eframe::egui::Color32::from_rgb(255, 140, 86),
                        risk[2] as f32,
                    ),
                    (theme.danger, risk[3] as f32),
                ];
                crate::charts::capsule_stacked_bar(ui, &theme, &segs, total_risk);

                ui.add_space(12.0);
                let labels = ["低", "中", "高", "危机"];
                for (i, (label, color)) in labels.iter().zip(segs.iter().map(|(c, _)| *c)).enumerate() {
                    ui.horizontal(|ui| {
                        ui.label(
                            egui::RichText::new(*label)
                                .font(FontId::proportional(12.0))
                                .color(theme.text),
                        );
                        capsule_progress(
                            ui,
                            &theme,
                            risk[i] as f32,
                            total_risk,
                            color,
                            true,
                        );
                    });
                    ui.add_space(6.0);
                }
            });
        });

        ui.add_space(8.0);

        // right: agent activity bar + radar
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width());

            glass_card(ui, &theme, |ui| {
                section_title(ui, &theme, "代理活跃度");
                let bars: Vec<(&str, f32)> = agent_activity
                    .iter()
                    .map(|(k, v)| {
                        let name = crate::agents::find(k).map_or(k.as_str(), |a| a.name);
                        (name, *v as f32)
                    })
                    .collect();
                if bars.is_empty() {
                    empty_state(ui, &theme, icons::agent, "暂无代理活动数据");
                } else {
                    crate::charts::bar_chart(ui, &theme, " ", &bars, theme.info, 180.0);
                }
            });

            ui.add_space(8.0);

            glass_card(ui, &theme, |ui| {
                section_title(ui, &theme, "总管代理能力");
                let axes = ["调度", "共情", "分析", "执行", "校验", "沟通"];
                let values = [0.9, 0.6, 0.85, 0.8, 0.7, 0.85];
                crate::charts::radar_chart(
                    ui,
                    &theme,
                    "",
                    &axes,
                    &values,
                    theme.accent,
                    200.0,
                );
            });
        });
    });

    ui.add_space(8.0);

    // recent conversations
    glass_card(ui, &theme, |ui| {
        section_title(ui, &theme, "最近对话");
        let convs = app.conversations.read().clone();
        if convs.is_empty() {
            empty_state_with_cta(
                ui,
                &theme,
                icons::chat_bubble_icon,
                "还没有对话，点击上方“新对话”开启您的第一位 AI 代理！",
                "AI 代理将协助您管理学生、分析风险、生成周报",
                "去对话",
                || app.navigate(Page::Chat),
            );
        } else {
            for c in convs.iter().take(6) {
                ui.horizontal(|ui| {
                    let agent = crate::agents::find(&c.agent_id);
                    let (icon_rect, _) =
                        ui.allocate_exact_size(Vec2::splat(24.0), egui::Sense::hover());
                    icons::agent(ui.painter(), icon_rect, &theme);
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(&c.title)
                                .font(FontId::proportional(13.0))
                                .color(theme.text),
                        );
                        ui.label(
                            egui::RichText::new(c.updated_at.format("%m-%d %H:%M").to_string())
                                .font(FontId::proportional(10.0))
                                .color(theme.text_faint),
                        );
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if let Some(a) = agent {
                            ui.label(
                                egui::RichText::new(a.name)
                                    .font(FontId::proportional(11.0))
                                    .color(theme.accent),
                            );
                        }
                    });
                });
                ui.separator();
            }
        }
    });

    // refresh button
    ui.with_layout(egui::Layout::right_to_left(egui::Align::TOP), |ui| {
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
