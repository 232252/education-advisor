//! The four content tabs rendered by the student detail panel:
//! 0. basic info, 1. grades, 2. family, 3. notes & tags.

use chrono::Utc;
use eframe::egui::{self, FontId, Sense, Ui, Vec2};
use uuid::Uuid;

use crate::app::App;
use crate::models::{GradeEntry, RiskLevel, Student};
use crate::ui::widgets::{badge, card, divider, empty_state, primary_button, text_input};

// ── Helpers ─────────────────────────────────────────────────────────────

fn info_field(ui: &mut Ui, theme: &crate::theme::Theme, label: &str, value: &str) {
    ui.vertical(|ui| {
        ui.label(
            egui::RichText::new(label)
                .font(FontId::proportional(10.0))
                .color(theme.text_faint),
        );
        ui.label(
            egui::RichText::new(value)
                .font(FontId::proportional(13.0))
                .color(theme.text),
        );
    });
}

// ── Tab 0: basic info ───────────────────────────────────────────────────

pub fn basic_info(app: &mut App, ui: &mut Ui, student: &Student) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        egui::Grid::new("basic_info_grid")
            .num_columns(4)
            .spacing(Vec2::new(24.0, 12.0))
            .show(ui, |ui| {
                info_field(ui, &theme, "姓名", &student.name);
                info_field(ui, &theme, "性别", student.gender.as_deref().unwrap_or("—"));
                info_field(
                    ui,
                    &theme,
                    "学号",
                    student.id_number.as_deref().unwrap_or("—"),
                );
                info_field(ui, &theme, "年级", &student.grade);
                ui.end_row();

                info_field(ui, &theme, "班级", &student.class);
                info_field(
                    ui,
                    &theme,
                    "出生日期",
                    &student
                        .birth_date
                        .map_or_else(|| "—".into(), |d| d.to_string()),
                );
                info_field(
                    ui,
                    &theme,
                    "入学日期",
                    &student
                        .enrollment_date
                        .map_or_else(|| "—".into(), |d| d.to_string()),
                );
                info_field(
                    ui,
                    &theme,
                    "GPA",
                    &student
                        .gpa
                        .map_or_else(|| "—".into(), |g| format!("{g:.2}")),
                );
                ui.end_row();
            });

        ui.add_space(12.0);

        // Risk level visualization
        ui.label(
            egui::RichText::new("风险等级评估")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            for level in RiskLevel::all() {
                let is_current = student.risk_level == level;
                let color = theme.risk_color(level);
                let (rect, resp) = ui.allocate_exact_size(Vec2::new(80.0, 32.0), Sense::click());
                let bg = if is_current {
                    color
                } else if resp.hovered() {
                    theme.translucent(color, 0.2)
                } else {
                    theme.translucent(color, 0.08)
                };
                ui.painter()
                    .rect_filled(rect, egui::Rounding::same(8.0), bg);
                ui.painter().text(
                    rect.center(),
                    egui::Align2::CENTER_CENTER,
                    level.label(),
                    FontId::proportional(11.0),
                    if is_current {
                        egui::Color32::WHITE
                    } else {
                        color
                    },
                );
            }
        });
    });
}

// ── Tab 1: grades ───────────────────────────────────────────────────────

pub fn grades(app: &mut App, ui: &mut Ui, student: &Student) {
    let theme = app.theme.clone();

    // Grade chart
    let grades = app
        .ui_state
        .grades
        .get(&student.id)
        .cloned()
        .unwrap_or_default();
    if !grades.is_empty() {
        let series: Vec<(&str, Vec<f32>)> =
            vec![("成绩", grades.iter().map(|g| g.score).collect())];
        crate::charts::line_chart(
            ui,
            &theme,
            &format!("{} 的成绩趋势", student.name),
            &series,
            theme.success,
            180.0,
        );
        ui.add_space(10.0);
    }

    // Add grade form
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("添加新成绩")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            let w = (ui.available_width() - 120.0) / 2.0;
            text_input(ui, &theme, &mut app.ui_state.new_grade_subject, "科目", w);
            ui.add_space(8.0);
            text_input(ui, &theme, &mut app.ui_state.new_grade_score, "分数", w);
            ui.add_space(8.0);
            if primary_button(ui, &theme, "添加").clicked() {
                if let Ok(score) = app.ui_state.new_grade_score.trim().parse::<f32>() {
                    let g = GradeEntry {
                        id: Uuid::new_v4(),
                        student_id: student.id,
                        subject: std::mem::take(&mut app.ui_state.new_grade_subject),
                        score,
                        max_score: 100.0,
                        exam_date: Utc::now().date_naive(),
                        recorded_at: Utc::now(),
                    };
                    let _ = app.runtime.tx.send(crate::runtime::Command::AddGrade(g));
                    app.ui_state.new_grade_score.clear();
                }
            }
        });
    });

    ui.add_space(10.0);

    // Grade list
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("成绩记录")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(8.0);

        if grades.is_empty() {
            empty_state(ui, &theme, crate::ui::icons::skills, "暂无成绩记录");
        } else {
            egui::Grid::new("grades_grid")
                .num_columns(4)
                .spacing(Vec2::new(40.0, 10.0))
                .show(ui, |ui| {
                    ui.label(
                        egui::RichText::new("科目")
                            .font(FontId::proportional(11.0))
                            .strong()
                            .color(theme.text_dim),
                    );
                    ui.label(
                        egui::RichText::new("分数")
                            .font(FontId::proportional(11.0))
                            .strong()
                            .color(theme.text_dim),
                    );
                    ui.label(
                        egui::RichText::new("考试日期")
                            .font(FontId::proportional(11.0))
                            .strong()
                            .color(theme.text_dim),
                    );
                    ui.label(
                        egui::RichText::new("状态")
                            .font(FontId::proportional(11.0))
                            .strong()
                            .color(theme.text_dim),
                    );
                    ui.end_row();
                    divider(ui, &theme);
                    ui.end_row();

                    for g in grades.iter().rev().take(20) {
                        ui.label(
                            egui::RichText::new(&g.subject)
                                .font(FontId::proportional(12.0))
                                .color(theme.text),
                        );
                        let score_color = if g.score >= 90.0 {
                            theme.success
                        } else if g.score >= 60.0 {
                            theme.warning
                        } else {
                            theme.danger
                        };
                        ui.label(
                            egui::RichText::new(format!("{:.0}", g.score))
                                .font(FontId::proportional(12.0))
                                .strong()
                                .color(score_color),
                        );
                        ui.label(
                            egui::RichText::new(g.exam_date.to_string())
                                .font(FontId::proportional(11.0))
                                .color(theme.text_faint),
                        );
                        let status = if g.score >= 60.0 {
                            "及格"
                        } else {
                            "不及格"
                        };
                        let status_color = if g.score >= 60.0 {
                            theme.success
                        } else {
                            theme.danger
                        };
                        badge(ui, &theme, status, status_color);
                        ui.end_row();
                    }
                });
        }
    });
}

// ── Tab 2: family info ──────────────────────────────────────────────────

pub fn family_info(app: &mut App, ui: &mut Ui, student: &Student) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        egui::Grid::new("family_grid")
            .num_columns(2)
            .spacing(Vec2::new(40.0, 14.0))
            .show(ui, |ui| {
                info_field(
                    ui,
                    &theme,
                    "监护人姓名",
                    student.guardian_name.as_deref().unwrap_or("—"),
                );
                info_field(
                    ui,
                    &theme,
                    "与监护人关系",
                    student.guardian_relation.as_deref().unwrap_or("—"),
                );
                ui.end_row();

                info_field(
                    ui,
                    &theme,
                    "监护人电话",
                    &student.guardian_contact.as_ref().map_or_else(
                        || "—".to_string(),
                        |c| {
                            if c.starts_with("enc:") {
                                "[已加密]".to_string()
                            } else {
                                c.clone()
                            }
                        },
                    ),
                );
                info_field(
                    ui,
                    &theme,
                    "紧急联系人",
                    student.emergency_contact.as_deref().unwrap_or("—"),
                );
                ui.end_row();

                info_field(
                    ui,
                    &theme,
                    "家庭住址",
                    student.home_address.as_deref().unwrap_or("—"),
                );
                ui.end_row();
            });
    });
}

// ── Tab 3: notes & tags ─────────────────────────────────────────────────

pub fn notes_tags(app: &mut App, ui: &mut Ui, student: &Student) {
    let theme = app.theme.clone();

    // Tags
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("标签")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(8.0);
        ui.horizontal_wrapped(|ui| {
            if student.tags.is_empty() {
                ui.label(
                    egui::RichText::new("暂无标签")
                        .font(FontId::proportional(12.0))
                        .color(theme.text_faint),
                );
            }
            for t in &student.tags {
                badge(ui, &theme, t, theme.info);
            }
        });
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            text_input(
                ui,
                &theme,
                &mut app.ui_state.tag_input,
                "输入新标签...",
                160.0,
            );
            ui.add_space(6.0);
            if primary_button(ui, &theme, "添加").clicked()
                && !app.ui_state.tag_input.trim().is_empty()
            {
                let tag = app.ui_state.tag_input.trim().to_string();
                app.ui_state.tag_input.clear();
                let mut updated = student.clone();
                if !updated.tags.contains(&tag) {
                    updated.tags.push(tag);
                    updated.updated_at = Utc::now();
                    let _ = app
                        .runtime
                        .tx
                        .send(crate::runtime::Command::SaveStudent(updated));
                }
            }
        });
    });

    ui.add_space(10.0);

    // Notes
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("备注")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(8.0);
        let mut notes = student.notes.clone().unwrap_or_default();
        let edit = egui::TextEdit::multiline(&mut notes)
            .desired_width(ui.available_width())
            .desired_rows(4)
            .hint_text("输入学生备注信息...");
        let resp = ui.add(edit);
        if resp.changed() {
            let mut updated = student.clone();
            updated.notes = if notes.trim().is_empty() {
                None
            } else {
                Some(notes)
            };
            updated.updated_at = Utc::now();
            let _ = app
                .runtime
                .tx
                .send(crate::runtime::Command::SaveStudent(updated));
        }
    });
}
