//! Skills page: agent tool skills registry and capability toggles.
//!
//! Skills are persisted to `Settings.enabled_skills` so they survive restarts.

use eframe::egui::{self, Align, Color32, FontId, Layout, Sense, Ui, Vec2};

use crate::app::App;
use crate::ui::icons;
use crate::ui::widgets::{card, empty_state, section_title};

#[derive(Debug, Clone, Copy)]
struct Skill {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    color: Color32,
}

const SKILLS: [Skill; 4] = [
    Skill {
        id: "lookup_student",
        name: "学生档案查询",
        description: "按姓名搜索并返回学生基本信息与风险等级",
        color: Color32::from_rgb(96, 165, 250),
    },
    Skill {
        id: "get_grades",
        name: "成绩查询",
        description: "根据学生 UUID 查询历史成绩记录",
        color: Color32::from_rgb(74, 222, 128),
    },
    Skill {
        id: "list_risk_students",
        name: "风险学生识别",
        description: "列出高/危机风险学生，支持分级干预",
        color: Color32::from_rgb(248, 113, 113),
    },
    Skill {
        id: "count_students",
        name: "全局统计",
        description: "统计学生总数、风险分布与平均 GPA",
        color: Color32::from_rgb(250, 204, 21),
    },
];

pub fn show(app: &mut App, ui: &mut Ui) {
    section_title(ui, &app.theme, "技能管理");

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("AI 代理可调用的工具技能列表")
                .font(FontId::proportional(12.0))
                .color(app.theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(
                egui::RichText::new(format!("{} 个技能", SKILLS.len()))
                    .font(FontId::proportional(12.0))
                    .color(app.theme.accent),
            );
        });
    });

    ui.add_space(8.0);

    if SKILLS.is_empty() {
        card(ui, &app.theme, |ui| {
            empty_state(ui, &app.theme, icons::skills, "暂无技能");
        });
        return;
    }

    for skill in &SKILLS {
        let mut enabled = is_skill_enabled(app, skill.id);
        card(ui, &app.theme, |ui| {
            ui.horizontal_top(|ui| {
                // avatar circle
                let (rect, _) = ui.allocate_exact_size(Vec2::splat(40.0), Sense::hover());
                icons::avatar(ui.painter(), rect.shrink(4.0), skill.color, skill.name);

                ui.vertical(|ui| {
                    ui.label(
                        egui::RichText::new(skill.name)
                            .font(FontId::proportional(14.0))
                            .strong()
                            .color(app.theme.text),
                    );
                    ui.label(
                        egui::RichText::new(skill.description)
                            .font(FontId::proportional(11.0))
                            .color(app.theme.text_dim),
                    );
                    ui.label(
                        egui::RichText::new(format!("ID: {}", skill.id))
                            .font(FontId::proportional(9.0))
                            .color(app.theme.text_faint),
                    );
                });

                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if ui.checkbox(&mut enabled, "启用").changed() {
                        // 通过 Command 持久化，避免闭包内可变借用冲突
                        let _ = app.runtime.tx.send(crate::runtime::Command::SaveSettings({
                            let mut s = app.settings.clone();
                            if enabled {
                                s.enabled_skills.insert(skill.id.to_string());
                            } else {
                                s.enabled_skills.remove(skill.id);
                            }
                            s
                        }));
                    }
                });
            });
        });
        ui.add_space(6.0);
    }
}

fn is_skill_enabled(app: &App, skill_id: &str) -> bool {
    if app.settings.enabled_skills.is_empty() {
        true
    } else {
        app.settings.enabled_skills.contains(skill_id)
    }
}

fn _set_skill_enabled(app: &mut App, skill_id: &str, enabled: bool) {
    if enabled {
        app.settings.enabled_skills.insert(skill_id.to_string());
    } else {
        app.settings.enabled_skills.remove(skill_id);
    }
    let _ = app
        .runtime
        .tx
        .send(crate::runtime::Command::SaveSettings(app.settings.clone()));
}
