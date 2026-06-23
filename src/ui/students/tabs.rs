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
        // Bug #6 — 风险等级按钮无响应：
        //   1) 用 `allocate_exact_size(.., Sense::click())` 拿到 `resp`
        //   2) 点击非当前等级 → 克隆学生、更新 `risk_level` 与 `updated_at`
        //   3) 发送 `SaveStudent` 命令到 runtime；DB 写完会回灌
        //      `Event::Students(...)`，下一帧 detail.rs 拉到的学生就带新等级
        //   4) 顺便推一条 toast 给用户即时反馈，避免「按了没反应」的疑虑
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
                if resp.clicked() && !is_current {
                    let mut updated = student.clone();
                    updated.risk_level = level;
                    updated.updated_at = Utc::now();
                    let _ = app
                        .runtime
                        .tx
                        .send(crate::runtime::Command::SaveStudent(updated));
                    app.push_toast(
                        crate::runtime::ToastKind::Success,
                        format!("已将「{}」的风险等级更新为 {}", student.name, level.label()),
                    );
                }
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

    // ── 切换学生时先把上一位学生的草稿落盘（Bug #1） ───────────
    if let Some(prev) = app.ui_state.notes_focus_student {
        if prev != student.id {
            flush_notes_draft(app, prev);
            app.ui_state.notes_focus_student = None;
        }
    }

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
        // Bug #16 — tag_input 改为按学生隔离，切换学生不会残留上次输入。
        let tag_buf = app.ui_state.tag_input.entry(student.id).or_default();
        let mut local = std::mem::take(tag_buf);
        ui.horizontal(|ui| {
            text_input(ui, &theme, &mut local, "输入新标签...", 160.0);
            ui.add_space(6.0);
            if primary_button(ui, &theme, "添加").clicked() && !local.trim().is_empty() {
                let tag = local.trim().to_string();
                local.clear();
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
        *app.ui_state.tag_input.entry(student.id).or_default() = local;
    });

    ui.add_space(10.0);

    // Notes — 草稿模式：键入只更新 in-memory 缓存；失焦时再写盘。
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("备注")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(8.0);
        // 取草稿优先；没有则用当前 student.notes 作为初值。
        if !app.ui_state.notes_draft.contains_key(&student.id) {
            app.ui_state
                .notes_draft
                .insert(student.id, student.notes.clone().unwrap_or_default());
        }
        let mut notes = app
            .ui_state
            .notes_draft
            .get(&student.id)
            .cloned()
            .unwrap_or_default();
        let edit = egui::TextEdit::multiline(&mut notes)
            .desired_width(ui.available_width())
            .desired_rows(4)
            .hint_text("输入学生备注信息...");
        let resp = ui.add(edit);
        if resp.has_focus() {
            app.ui_state.notes_focus_student = Some(student.id);
        }
        if resp.changed() {
            // Bug #1：只更新草稿，**不**触发 SaveStudent。
            app.ui_state.notes_draft.insert(student.id, notes.clone());
            app.ui_state.notes_dirty.insert(student.id, true);
        }
        if resp.lost_focus() {
            // Bug #1：失焦落盘一次，**不**改 updated_at，只改 notes_modified_at。
            flush_notes_draft(app, student.id);
            app.ui_state.notes_focus_student = None;
        }
        // 草稿状态指示
        if app
            .ui_state
            .notes_dirty
            .get(&student.id)
            .copied()
            .unwrap_or(false)
        {
            ui.add_space(4.0);
            ui.label(
                egui::RichText::new("● 未保存（失焦时自动保存）")
                    .font(FontId::proportional(10.0))
                    .color(theme.warning),
            );
        }
    });
}

/// Bug #1 — 把指定学生的备注草稿写入 DB。
/// 关键改动：只更新 `notes` 与 `notes_modified_at`，**绝不**触碰 `updated_at`，
/// 避免学生列表在每次按键时抖一下。
fn flush_notes_draft(app: &mut App, student_id: Uuid) {
    let dirty = app
        .ui_state
        .notes_dirty
        .get(&student_id)
        .copied()
        .unwrap_or(false);
    if !dirty {
        return;
    }
    let Some(draft) = app.ui_state.notes_draft.get(&student_id).cloned() else {
        return;
    };
    let Some(snapshot) = app
        .students
        .read()
        .iter()
        .find(|s| s.id == student_id)
        .cloned()
    else {
        return;
    };
    let mut updated = snapshot;
    let new_notes = if draft.trim().is_empty() {
        None
    } else {
        Some(draft)
    };
    if updated.notes == new_notes {
        // 内容没有实质变化（只有空白之类），仍然清 dirty 避免下次重复刷。
        app.ui_state.notes_dirty.insert(student_id, false);
        return;
    }
    updated.notes = new_notes;
    updated.notes_modified_at = Some(Utc::now());
    // 注意：updated_at 不动。
    let _ = app
        .runtime
        .tx
        .send(crate::runtime::Command::SaveStudent(updated));
    app.ui_state.notes_dirty.insert(student_id, false);
}
