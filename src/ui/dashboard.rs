//! Dashboard: KPI cards + charts overview.

use eframe::egui::{self, FontId, Ui, Vec2};

use crate::app::App;
use crate::ui::icons;
use crate::ui::widgets::{card, empty_state, ghost_button, section_title, stat_card};

pub fn show(app: &mut App, ui: &mut Ui) {
    section_title(ui, &app.theme, "总览");

    // KPI 行：Bug #5 — 硬编码 4 列改为按屏幕宽度自适应（窄屏 2 列）。
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
    drop(stats);
    let cards: [(&str, String, fn(&eframe::egui::Painter, eframe::egui::Rect, &crate::theme::Theme), eframe::egui::Color32); 4] = [
        (
            "学生总数",
            total.to_string(),
            icons::students,
            app.theme.accent,
        ),
        (
            "平均 GPA",
            format!("{avg:.2}"),
            icons::chat,
            app.theme.success,
        ),
        (
            "今日对话",
            convs.to_string(),
            icons::history,
            app.theme.info,
        ),
        (
            "工具调用",
            tools.to_string(),
            icons::skills,
            app.theme.warning,
        ),
    ];
    for row in cards.chunks(cols) {
        ui.horizontal(|ui| {
            let gap = 8.0;
            ui.spacing_mut().item_spacing = Vec2::new(gap, 8.0);
            for (label, value, icon, accent) in row {
                stat_card(ui, &app.theme, label, value, *icon, *accent, card_w);
            }
        });
    }

    ui.add_space(8.0);

    // charts row
    ui.horizontal_top(|ui| {
        // left: grade trend + risk donut
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width() / 2.0);
            let stats = app.stats.read();
            let trend: Vec<f32> = stats
                .as_ref()
                .map(|s| s.grade_trend.iter().map(|(_, v)| *v * 100.0).collect())
                .unwrap_or_default();
            let labels: Vec<String> = stats
                .as_ref()
                .map(|s| s.grade_trend.iter().map(|(m, _)| m.clone()).collect())
                .unwrap_or_default();
            // build a single series; chart takes &str name
            let series: Vec<(&str, Vec<f32>)> = vec![("平均得分率%", trend)];
            crate::charts::line_chart(ui, &app.theme, "成绩趋势", &series, app.theme.accent, 180.0);
            ui.add_space(8.0);
            // risk donut
            let rd = stats.as_ref().map_or([0; 4], |s| s.risk_distribution);
            let segs: Vec<(&str, f32, eframe::egui::Color32)> = vec![
                ("低", rd[0] as f32, app.theme.success),
                ("中", rd[1] as f32, app.theme.warning),
                (
                    "高",
                    rd[2] as f32,
                    eframe::egui::Color32::from_rgb(255, 140, 86),
                ),
                ("危机", rd[3] as f32, app.theme.danger),
            ];
            crate::charts::donut_chart(ui, &app.theme, "风险分布", &segs, 200.0);
            let _ = labels;
        });

        ui.add_space(8.0);

        // right: agent activity bar + radar
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width());
            let stats = app.stats.read();
            let bars: Vec<(&str, f32)> = stats
                .as_ref()
                .map(|s| {
                    s.agent_activity
                        .iter()
                        .map(|(k, v)| {
                            let name = crate::agents::find(k).map_or(k.as_str(), |a| a.name);
                            (name, *v as f32)
                        })
                        .collect()
                })
                .unwrap_or_default();
            crate::charts::bar_chart(ui, &app.theme, "代理活跃度", &bars, app.theme.info, 180.0);
            ui.add_space(8.0);
            // radar of main agent capabilities (illustrative)
            let axes = ["调度", "共情", "分析", "执行", "校验", "沟通"];
            let values = [0.9, 0.6, 0.85, 0.8, 0.7, 0.85];
            crate::charts::radar_chart(
                ui,
                &app.theme,
                "总管代理能力",
                &axes,
                &values,
                app.theme.accent,
                200.0,
            );
        });
    });

    ui.add_space(8.0);

    // recent conversations
    card(ui, &app.theme, |ui| {
        section_title(ui, &app.theme, "最近对话");
        let convs = app.conversations.read().clone();
        if convs.is_empty() {
            empty_state(
                ui,
                &app.theme,
                icons::chat,
                "还没有对话，去「对话」页开始吧",
            );
        } else {
            for c in convs.iter().take(6) {
                ui.horizontal(|ui| {
                    let agent = crate::agents::find(&c.agent_id);
                    let (icon_rect, _) =
                        ui.allocate_exact_size(Vec2::splat(24.0), egui::Sense::hover());
                    icons::agent(ui.painter(), icon_rect, &app.theme);
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(&c.title)
                                .font(FontId::proportional(13.0))
                                .color(app.theme.text),
                        );
                        ui.label(
                            egui::RichText::new(c.updated_at.format("%m-%d %H:%M").to_string())
                                .font(FontId::proportional(10.0))
                                .color(app.theme.text_faint),
                        );
                    });
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if let Some(a) = agent {
                            ui.label(
                                egui::RichText::new(a.name)
                                    .font(FontId::proportional(11.0))
                                    .color(app.theme.accent),
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
        if ghost_button(ui, &app.theme, "刷新数据").clicked() {
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
