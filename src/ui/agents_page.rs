//! Agents page: grid of all 18 agents with capability radar and quick chat.

use eframe::egui::{
    self, Align, Align2, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Stroke, Ui, Vec2,
};

use crate::app::App;
use crate::ui::icons;
use crate::ui::widgets::{card, section_title};

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
        // Group by category while preserving the canonical agent order
        // (the `AGENTS` array is hand-curated, so we mustn't lose it
        // through a sort). `dedup` on the iterator is stable.
        let mut categories: Vec<&str> = Vec::new();
        for a in agents.iter() {
            if !categories.contains(&a.category) {
                categories.push(a.category);
            }
        }
        for cat in categories {
            ui.label(
                egui::RichText::new(cat)
                    .font(FontId::proportional(13.0))
                    .strong()
                    .color(app.theme.text_dim),
            );
            ui.add_space(2.0);
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = Vec2::new(10.0, 10.0);
                for agent in agents.iter().filter(|a| a.category == cat) {
                    agent_card(app, ui, agent);
                }
            });
            ui.add_space(8.0);
        }

        ui.add_space(8.0);
        // capability radar for active agent
        if let Some(a) = crate::agents::find(&app.active_agent) {
            card(ui, &app.theme, |ui| {
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

fn agent_card(app: &mut App, ui: &mut Ui, agent: &crate::agents::AgentDef) {
    let active = app.active_agent == agent.id;
    let width = 200.0_f32.min(ui.available_width());
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(width, 110.0), Sense::click());
    let hover = resp.hovered() || active;
    let bg = if active {
        app.theme.accent_dim
    } else if hover {
        app.theme.surface
    } else {
        app.theme.surface_glass
    };
    ui.painter().rect_filled(rect, Rounding::same(14.0), bg);
    ui.painter().rect_stroke(
        rect,
        Rounding::same(14.0),
        Stroke::new(
            1.0,
            if active {
                app.theme.accent
            } else {
                app.theme.border
            },
        ),
    );

    let color = Color32::from_rgb(agent.color[0], agent.color[1], agent.color[2]);
    // avatar circle
    let avatar_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + 12.0, rect.min.y + 12.0),
        Vec2::splat(32.0),
    );
    icons::avatar(ui.painter(), avatar_rect, color, agent.name);

    ui.painter().text(
        Pos2::new(rect.min.x + 52.0, rect.min.y + 22.0),
        Align2::LEFT_CENTER,
        agent.name,
        FontId::proportional(14.0),
        app.theme.text,
    );
    ui.painter().text(
        Pos2::new(rect.min.x + 52.0, rect.min.y + 40.0),
        Align2::LEFT_CENTER,
        agent.category,
        FontId::proportional(10.0),
        app.theme.text_faint,
    );
    // description (2 lines)
    let desc = crate::util::truncate(agent.description, 22);
    ui.painter().text(
        Pos2::new(rect.min.x + 14.0, rect.min.y + 64.0),
        Align2::LEFT_CENTER,
        desc,
        FontId::proportional(11.0),
        app.theme.text_dim,
    );

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

fn hash_str(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}
