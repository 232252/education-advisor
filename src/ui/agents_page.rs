//! Agents page: grid of all 18 agents with capability radar and quick chat.

use eframe::egui::{
    self, Align, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Stroke, Ui, Vec2,
};

use crate::app::App;
use crate::theme::Theme;
use crate::ui::icons;
use crate::ui::widgets::{badge, glass_card, group_header, hover_lift_card, section_title};
use crate::agents::AgentDef;

pub fn show(app: &mut App, ui: &mut Ui) {
    section_title(ui, &app.theme, "AI 代理");

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("18 个专业代理协同工作，覆盖教育管理全场景")
                .font(FontId::proportional(12.0))
                .color(app.theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(
                egui::RichText::new(format!("当前活跃: {}", active_name(app)))
                    .font(FontId::proportional(12.0))
                    .color(app.theme.accent),
            );
        });
    });

    ui.add_space(8.0);

    let agents = crate::agents::all_agents();
    egui::ScrollArea::vertical().show(ui, |ui| {
        let mut teaching: Vec<&AgentDef> = Vec::new();
        let mut safety: Vec<&AgentDef> = Vec::new();
        let mut admin: Vec<&AgentDef> = Vec::new();
        for a in agents {
            let (group, _) = agent_group(a, &app.theme);
            match group {
                "教学" => teaching.push(a),
                "安全" => safety.push(a),
                _ => admin.push(a),
            }
        }

        render_group(app, ui, "教学", app.theme.gradient_purple, &teaching);
        ui.add_space(24.0);
        render_group(app, ui, "安全", app.theme.danger, &safety);
        ui.add_space(24.0);
        render_group(app, ui, "行政", app.theme.gradient_cyan, &admin);

        ui.add_space(8.0);
        // capability radar for active agent
        if let Some(a) = crate::agents::find(&app.active_agent) {
            glass_card(ui, &app.theme, |ui| {
                ui.horizontal(|ui| {
                    let avatar_rect = Rect::from_min_size(
                        Pos2::new(ui.cursor().left(), ui.cursor().center().y - 14.0),
                        Vec2::splat(28.0),
                    );
                    let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
                    icons::avatar(ui.painter(), avatar_rect, color, a.name);
                    ui.add_space(34.0);
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(a.name)
                                .font(FontId::proportional(16.0))
                                .strong()
                                .color(app.theme.text),
                        );
                        ui.label(
                            egui::RichText::new(a.description)
                                .font(FontId::proportional(12.0))
                                .color(app.theme.text_dim),
                        );
                    });
                });
                ui.add_space(4.0);
                let axes = ["专业度", "响应", "共情", "严谨", "效率", "协作"];
                // deterministic pseudo-values from agent id hash
                let hash = hash_str(a.id);
                let values: Vec<f32> = (0..6)
                    .map(|i| {
                        let h = (hash >> (i * 5)) & 0x1f;
                        (h as f32 / 31.0).mul_add(0.5, 0.5)
                    })
                    .collect();
                let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
                crate::charts::radar_chart(
                    ui,
                    &app.theme,
                    "能力画像",
                    &axes,
                    &values,
                    color,
                    220.0,
                );
            });
        }
    });
}

fn active_name(app: &App) -> &str {
    crate::agents::find(&app.active_agent).map_or("—", |a| a.name)
}

/// Returns the function group for an agent and its representative theme color.
fn agent_group(agent: &AgentDef, theme: &Theme) -> (&'static str, Color32) {
    let id = agent.id;
    let cat = agent.category;
    if cat.contains("教学")
        || id == "academic"
        || id == "curriculum"
        || id == "assessment"
        || id == "counseling"
        || id == "counselor"
        || id == "psychology"
        || id == "research"
    {
        ("教学", theme.gradient_purple)
    } else if cat.contains("安全")
        || id == "attendance"
        || id == "discipline"
        || id == "discipline-officer"
        || id == "safety"
        || id == "risk-alert"
        || id == "class-monitor"
    {
        ("安全", theme.danger)
    } else {
        ("行政", theme.gradient_cyan)
    }
}

fn render_group(
    app: &mut App,
    ui: &mut Ui,
    title: &'static str,
    color: Color32,
    agents: &[&AgentDef],
) {
    group_header(ui, &app.theme, color, title, &format!("{} 个", agents.len()));
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = Vec2::new(14.0, 14.0);
        for agent in agents {
            let (group, _) = agent_group(agent, &app.theme);
            agent_card(app, ui, agent, group, color);
        }
    });
}

fn agent_card(app: &mut App, ui: &mut Ui, agent: &AgentDef, group: &'static str, color: Color32) {
    let active = app.active_agent == agent.id;
    let theme = &app.theme;
    let (top, bottom) = group_gradient_colors(group, color, theme);

    let resp = ui
        .allocate_ui_with_layout(
            Vec2::new(200.0_f32.min(ui.available_width()), 138.0),
            Layout::top_down(Align::LEFT),
            |ui| {
                hover_lift_card(ui, theme, 1.0, |ui| {
                    let content = ui.max_rect();
                    ui.spacing_mut().item_spacing = Vec2::ZERO;

                    // Top row: gradient avatar on the left, group pill on the right.
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing = Vec2::ZERO;
                        let (avatar_rect, _) =
                            ui.allocate_exact_size(Vec2::splat(44.0), Sense::hover());
                        icons::gradient_avatar(
                            ui.painter(),
                            avatar_rect,
                            top,
                            bottom,
                            agent.name,
                        );
                        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                            badge(ui, theme, group, color);
                        });
                    });

                    ui.add_space(8.0);
                    ui.label(
                        egui::RichText::new(agent.name)
                            .font(FontId::proportional(14.0))
                            .strong()
                            .color(theme.text),
                    );
                    ui.add_space(2.0);
                    let desc = crate::util::truncate(agent.description, 22);
                    ui.add(
                        egui::Label::new(
                            egui::RichText::new(desc)
                                .font(FontId::proportional(11.0))
                                .color(theme.text_dim),
                        )
                        .wrap(false),
                    );
                    ui.add_space(10.0);

                    // Bottom colored strip.
                    let (strip_rect, _) =
                        ui.allocate_exact_size(Vec2::new(content.width(), 3.0), Sense::hover());
                    ui.painter()
                        .rect_filled(strip_rect, Rounding::same(1.5), color);

                    // Active / default border.
                    let card_rect = content.expand(16.0);
                    let stroke = if active {
                        Stroke::new(1.5, theme.accent)
                    } else {
                        Stroke::new(1.0, theme.border)
                    };
                    ui.painter()
                        .rect_stroke(card_rect, Rounding::same(16.0), stroke);
                })
            },
        )
        .inner;

    if resp.clicked() {
        app.active_agent = agent.id.to_string();
    }
    // Bug #15 — 之前 `!resp.clicked()` 把双击分支给屏蔽了，导致双击
    // 永远不进入对话。egui 在双击的第二次按下时同时报告 `clicked()` 与
    // `double_clicked()`，因此正确做法是优先用 `double_clicked()`。
    if resp.double_clicked() {
        let student_id = app.selected_student;
        let title = if let Some(sid) = student_id {
            let students = app.students.read();
            let name = students
                .iter()
                .find(|s| s.id == sid)
                .map_or("", |s| s.name.as_str());
            if name.is_empty() {
                format!("与 {} 对话", agent.name)
            } else {
                format!("{} · {}", name, agent.name)
            }
        } else {
            format!("与 {} 对话", agent.name)
        };
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::NewConversation {
                agent_id: agent.id.to_string(),
                student_id,
                title,
            });
        app.navigate(crate::app::Page::Chat);
    }
}

fn group_gradient_colors(group: &'static str, _color: Color32, theme: &Theme) -> (Color32, Color32) {
    match group {
        "教学" => (theme.gradient_purple, theme.purple),
        "安全" => (theme.danger, Color32::from_rgb(255, 100, 50)),
        _ => (theme.gradient_cyan, theme.info),
    }
}

fn hash_str(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}
