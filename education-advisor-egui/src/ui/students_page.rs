//! Students page: professional-grade student档案 with comprehensive fields,
//! tabbed layout, modern visual design, and full data interoperability.

use chrono::{NaiveDate, Utc};
use eframe::egui::{
    self, Align, Align2, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Ui, Vec2,
};
use uuid::Uuid;

use crate::app::App;
use crate::models::{ExportScope, GradeEntry, RiskLevel, Student};
use crate::ui::icons;
use crate::ui::widgets::{
    badge, card, danger_button, divider, empty_state, ghost_button, primary_button, search_input,
    section_title, tab_switcher, text_input, tool_button,
};

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();

    // ── Header with title and action bar ──
    ui.horizontal(|ui| {
        section_title(ui, &theme, "学生档案");
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.add_space(4.0);
            if tool_button(ui, &theme, "导出", icons::download).clicked() {
                app.ui_state.show_export_preview = !app.ui_state.show_export_preview;
            }
            if tool_button(ui, &theme, "导入", icons::upload).clicked() {
                app.ui_state.show_import = !app.ui_state.show_import;
            }
            if primary_button(ui, &theme, "+ 新增学生").clicked() {
                app.ui_state.editing_student = Some(new_blank_student());
            }
        });
    });

    // ── Import / Export panels ──
    if app.ui_state.show_import {
        ui.add_space(4.0);
        import_panel(app, ui);
    }
    if app.ui_state.show_export_preview {
        ui.add_space(4.0);
        export_panel(app, ui);
    }

    ui.add_space(8.0);

    let avail = ui.available_rect_before_wrap();
    let list_w = (avail.width() * 0.35).clamp(280.0, 380.0);

    ui.horizontal_top(|ui| {
        // ═══════════════════════════════════════
        //  LEFT: Student List
        // ═══════════════════════════════════════
        ui.vertical(|ui| {
            ui.set_width(list_w);
            card(ui, &theme, |ui| {
                // Search
                ui.horizontal(|ui| {
                    let w = ui.available_width();
                    search_input(ui, &theme, &mut app.ui_state.student_filter, "搜索姓名、学号、班级...", w);
                });
                ui.add_space(8.0);

                let students = app.students.read().clone();
                let filter = app.ui_state.student_filter.to_lowercase();
                let filtered: Vec<Student> = students
                    .into_iter()
                    .filter(|s| {
                        filter.is_empty()
                            || s.name.to_lowercase().contains(&filter)
                            || s.class.to_lowercase().contains(&filter)
                            || s.id_number.as_ref().is_some_and(|n| n.to_lowercase().contains(&filter))
                    })
                    .collect();

                egui::ScrollArea::vertical()
                    .max_height(ui.available_height() - 4.0)
                    .show(ui, |ui| {
                        if filtered.is_empty() {
                            empty_state(ui, &theme, icons::students, "暂无学生数据");
                        }
                        for s in &filtered {
                            student_list_row(app, ui, s);
                        }
                    });
            });
        });

        ui.add_space(12.0);

        // ═══════════════════════════════════════
        //  RIGHT: Detail Panel
        // ═══════════════════════════════════════
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width());
            let sel = app.selected_student;
            let students = app.students.read().clone();
            let student = sel.and_then(|id| students.into_iter().find(|s| s.id == id));

            if let Some(student) = student {
                detail_panel(app, ui, student);
            } else {
                card(ui, &theme, |ui| {
                    empty_state(ui, &theme, icons::students, "选择左侧学生查看完整档案");
                });
            }
        });
    });

    // Edit dialog overlay
    if app.ui_state.editing_student.is_some() {
        edit_dialog(app, ui);
    }
}

// ─────────────────────────────────────────────
// Student List Row
// ─────────────────────────────────────────────
fn student_list_row(app: &mut App, ui: &mut Ui, s: &Student) {
    let theme = &app.theme;
    let selected = app.selected_student == Some(s.id);
    let w = ui.available_width();
    let (rect, resp) = ui.allocate_exact_size(Vec2::new(w, 72.0), Sense::click());

    // Background
    if selected {
        ui.painter().rect_filled(rect, Rounding::same(14.0), theme.accent_dim);
        let bar = Rect::from_min_size(rect.min, Vec2::new(3.0, rect.height()));
        ui.painter().rect_filled(bar, Rounding::same(2.0), theme.accent);
    } else if resp.hovered() {
        ui.painter().rect_filled(rect, Rounding::same(14.0), theme.surface_hover);
    }

    // Avatar with risk color
    let av_center = Pos2::new(rect.min.x + 28.0, rect.center().y);
    ui.painter().circle_filled(av_center, 22.0, theme.risk_color(s.risk_level));
    let initial = s.name.chars().next().unwrap_or('?');
    ui.painter().text(
        av_center,
        Align2::CENTER_CENTER,
        initial.to_string(),
        FontId::proportional(14.0),
        Color32::WHITE,
    );

    // Name + meta
    ui.painter().text(
        Pos2::new(rect.min.x + 58.0, rect.min.y + 18.0),
        Align2::LEFT_CENTER,
        &s.name,
        FontId::proportional(14.0),
        theme.text,
    );

    let meta = format!("{} · {} · 学号: {}", s.grade, s.class, s.id_number.as_deref().unwrap_or("—"));
    ui.painter().text(
        Pos2::new(rect.min.x + 58.0, rect.min.y + 38.0),
        Align2::LEFT_CENTER,
        meta,
        FontId::proportional(10.0),
        theme.text_faint,
    );

    // GPA badge
    if let Some(gpa) = s.gpa {
        let gpa_text = format!("GPA {gpa:.2}");
        let gpa_color = if gpa >= 3.5 { theme.success } else if gpa >= 2.5 { theme.warning } else { theme.danger };
        let galley = ui.ctx().fonts(|f| f.layout_no_wrap(gpa_text.clone(), FontId::proportional(10.0), gpa_color));
        let badge_w = galley.rect.width() + 16.0;
        let badge_h = 22.0;
        let badge_rect = Rect::from_min_size(
            Pos2::new(rect.max.x - badge_w - 10.0, rect.center().y - badge_h / 2.0),
            Vec2::new(badge_w, badge_h),
        );
        ui.painter().rect_filled(badge_rect, Rounding::same(8.0), theme.translucent(gpa_color, 0.12));
        ui.painter().galley(
            badge_rect.center() - galley.rect.size() * 0.5,
            galley,
            gpa_color,
        );
    }

    // Risk badge
    let risk_color = theme.risk_color(s.risk_level);
    let risk_text = s.risk_level.label();
    let r_galley = ui.ctx().fonts(|f| f.layout_no_wrap(risk_text.to_string(), FontId::proportional(9.0), risk_color));
    let r_w = r_galley.rect.width() + 12.0;
    let r_h = 18.0;
    let r_rect = Rect::from_min_size(
        Pos2::new(rect.max.x - r_w - 10.0, rect.min.y + 8.0),
        Vec2::new(r_w, r_h),
    );
    ui.painter().rect_filled(r_rect, Rounding::same(6.0), theme.translucent(risk_color, 0.15));
    ui.painter().galley(
        r_rect.center() - r_galley.rect.size() * 0.5,
        r_galley,
        risk_color,
    );

    if resp.clicked() {
        app.selected_student = Some(s.id);
        let _ = app.runtime.tx.send(crate::runtime::Command::LoadGrades(s.id));
    }
}

// ─────────────────────────────────────────────
// Detail Panel with Tabs
// ─────────────────────────────────────────────
fn detail_panel(app: &mut App, ui: &mut Ui, student: Student) {
    let theme = app.theme.clone();

    // Header Card
    card(ui, &theme, |ui| {
        ui.horizontal_top(|ui| {
            // Large avatar
            let (av, _) = ui.allocate_exact_size(Vec2::splat(72.0), Sense::hover());
            ui.painter().circle_filled(av.center(), 36.0, theme.risk_color(student.risk_level));
            let initial = student.name.chars().next().unwrap_or('?');
            ui.painter().text(
                av.center(),
                Align2::CENTER_CENTER,
                initial.to_string(),
                FontId::proportional(28.0),
                Color32::WHITE,
            );

            ui.vertical(|ui| {
                ui.label(
                    egui::RichText::new(&student.name)
                        .font(FontId::proportional(22.0))
                        .strong()
                        .color(theme.text),
                );
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new(format!("{} · {} · {}", student.grade, student.class,
                            student.id_number.as_deref().unwrap_or("暂无学号")))
                            .font(FontId::proportional(12.0))
                            .color(theme.text_dim),
                    );
                });
            });

            ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                badge(ui, &theme, student.risk_level.label(), theme.risk_color(student.risk_level));
            });
        });

        ui.add_space(8.0);
        divider(ui, &theme);
        ui.add_space(8.0);

        // Quick action buttons
        ui.horizontal(|ui| {
            if tool_button(ui, &theme, "编辑档案", icons::edit).clicked() {
                app.ui_state.editing_student = Some(student.clone());
            }
            if tool_button(ui, &theme, "AI 咨询", icons::chat_color).clicked() {
                let title = format!("关于「{}」的学业咨询", student.name);
                let _ = app.runtime.tx.send(crate::runtime::Command::NewConversation {
                    agent_id: app.active_agent.clone(),
                    student_id: Some(student.id),
                    title,
                });
                app.navigate(crate::app::Page::Chat);
            }
            if tool_button(ui, &theme, "添加成绩", icons::edit).clicked() {
                app.ui_state.student_detail_tab = 1; // Switch to grades tab
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if danger_button(ui, &theme, "删除").clicked() {
                    let _ = app.runtime.tx.send(crate::runtime::Command::DeleteStudent(student.id));
                    app.selected_student = None;
                }
            });
        });
    });

    ui.add_space(10.0);

    // Tabs
    let tabs = ["基本信息", "成绩记录", "家庭信息", "备注标签"];
    if let Some(new_tab) = tab_switcher(ui, &theme, &tabs, app.ui_state.student_detail_tab) {
        app.ui_state.student_detail_tab = new_tab;
    }
    ui.add_space(8.0);

    match app.ui_state.student_detail_tab {
        0 => tab_basic_info(app, ui, &student),
        1 => tab_grades(app, ui, &student),
        2 => tab_family_info(app, ui, &student),
        3 => tab_notes_tags(app, ui, &student),
        _ => {}
    }
}

fn tab_basic_info(app: &mut App, ui: &mut Ui, student: &Student) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        egui::Grid::new("basic_info_grid")
            .num_columns(4)
            .spacing(Vec2::new(24.0, 12.0))
            .show(ui, |ui| {
                info_field(ui, &theme, "姓名", &student.name);
                info_field(ui, &theme, "性别", student.gender.as_deref().unwrap_or("—"));
                info_field(ui, &theme, "学号", student.id_number.as_deref().unwrap_or("—"));
                info_field(ui, &theme, "年级", &student.grade);
                ui.end_row();

                info_field(ui, &theme, "班级", &student.class);
                info_field(ui, &theme, "出生日期",
                    &student.birth_date.map_or_else(|| "—".into(), |d| d.to_string()));
                info_field(ui, &theme, "入学日期",
                    &student.enrollment_date.map_or_else(|| "—".into(), |d| d.to_string()));
                info_field(ui, &theme, "GPA",
                    &student.gpa.map_or_else(|| "—".into(), |g| format!("{g:.2}")));
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
                ui.painter().rect_filled(rect, Rounding::same(8.0), bg);
                ui.painter().text(
                    rect.center(),
                    Align2::CENTER_CENTER,
                    level.label(),
                    FontId::proportional(11.0),
                    if is_current { Color32::WHITE } else { color },
                );
            }
        });
    });
}

fn tab_grades(app: &mut App, ui: &mut Ui, student: &Student) {
    let theme = app.theme.clone();

    // Grade chart
    let grades = app.ui_state.grades.get(&student.id).cloned().unwrap_or_default();
    if !grades.is_empty() {
        let series: Vec<(&str, Vec<f32>)> = vec![("成绩", grades.iter().map(|g| g.score).collect())];
        crate::charts::line_chart(ui, &theme, &format!("{} 的成绩趋势", student.name), &series, theme.success, 180.0);
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
            empty_state(ui, &theme, icons::skills, "暂无成绩记录");
        } else {
            egui::Grid::new("grades_grid")
                .num_columns(4)
                .spacing(Vec2::new(40.0, 10.0))
                .show(ui, |ui| {
                    ui.label(egui::RichText::new("科目").font(FontId::proportional(11.0)).strong().color(theme.text_dim));
                    ui.label(egui::RichText::new("分数").font(FontId::proportional(11.0)).strong().color(theme.text_dim));
                    ui.label(egui::RichText::new("考试日期").font(FontId::proportional(11.0)).strong().color(theme.text_dim));
                    ui.label(egui::RichText::new("状态").font(FontId::proportional(11.0)).strong().color(theme.text_dim));
                    ui.end_row();
                    divider(ui, &theme);
                    ui.end_row();

                    for g in grades.iter().rev().take(20) {
                        ui.label(egui::RichText::new(&g.subject).font(FontId::proportional(12.0)).color(theme.text));
                        let score_color = if g.score >= 90.0 { theme.success } else if g.score >= 60.0 { theme.warning } else { theme.danger };
                        ui.label(egui::RichText::new(format!("{:.0}", g.score)).font(FontId::proportional(12.0)).strong().color(score_color));
                        ui.label(egui::RichText::new(g.exam_date.to_string()).font(FontId::proportional(11.0)).color(theme.text_faint));
                        let status = if g.score >= 60.0 { "及格" } else { "不及格" };
                        let status_color = if g.score >= 60.0 { theme.success } else { theme.danger };
                        badge(ui, &theme, status, status_color);
                        ui.end_row();
                    }
                });
        }
    });
}

fn tab_family_info(app: &mut App, ui: &mut Ui, student: &Student) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        egui::Grid::new("family_grid")
            .num_columns(2)
            .spacing(Vec2::new(40.0, 14.0))
            .show(ui, |ui| {
                info_field(ui, &theme, "监护人姓名", student.guardian_name.as_deref().unwrap_or("—"));
                info_field(ui, &theme, "与监护人关系", student.guardian_relation.as_deref().unwrap_or("—"));
                ui.end_row();

                info_field(ui, &theme, "监护人电话",
                    &student.guardian_contact.as_ref().map_or_else(|| "—".to_string(), |c| {
                        if c.starts_with("enc:") { "[已加密]".to_string() } else { c.clone() }
                    }));
                info_field(ui, &theme, "紧急联系人", student.emergency_contact.as_deref().unwrap_or("—"));
                ui.end_row();

                info_field(ui, &theme, "家庭住址", student.home_address.as_deref().unwrap_or("—"));
                ui.end_row();
            });
    });
}

fn tab_notes_tags(app: &mut App, ui: &mut Ui, student: &Student) {
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
                ui.label(egui::RichText::new("暂无标签").font(FontId::proportional(12.0)).color(theme.text_faint));
            }
            for t in &student.tags {
                badge(ui, &theme, t, theme.info);
            }
        });
        ui.add_space(8.0);
        ui.horizontal(|ui| {
            text_input(ui, &theme, &mut app.ui_state.tag_input, "输入新标签...", 160.0);
            ui.add_space(6.0);
            if primary_button(ui, &theme, "添加").clicked() && !app.ui_state.tag_input.trim().is_empty() {
                let tag = app.ui_state.tag_input.trim().to_string();
                app.ui_state.tag_input.clear();
                let mut updated = student.clone();
                if !updated.tags.contains(&tag) {
                    updated.tags.push(tag);
                    updated.updated_at = Utc::now();
                    let _ = app.runtime.tx.send(crate::runtime::Command::SaveStudent(updated));
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
            updated.notes = if notes.trim().is_empty() { None } else { Some(notes) };
            updated.updated_at = Utc::now();
            let _ = app.runtime.tx.send(crate::runtime::Command::SaveStudent(updated));
        }
    });
}

// ─────────────────────────────────────────────
// Helper: Info field label + value
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// Import Panel
// ─────────────────────────────────────────────
fn import_panel(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("批量导入学生")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.add_space(4.0);
        ui.label(
            egui::RichText::new("CSV 格式: name,gender,grade,class,id_number,risk,gpa")
                .font(FontId::proportional(10.0))
                .color(theme.text_faint),
        );
        ui.add_space(6.0);
        ui.add(egui::TextEdit::multiline(&mut app.ui_state.import_text).desired_rows(5));
        ui.horizontal(|ui| {
            if primary_button(ui, &theme, "导入").clicked() {
                let text = std::mem::take(&mut app.ui_state.import_text);
                let _ = app.runtime.tx.send(crate::runtime::Command::ImportStudentsCsv(text));
                app.ui_state.show_import = false;
            }
            if ghost_button(ui, &theme, "示例数据").clicked() {
                app.ui_state.import_text =
                    "name,gender,grade,class,id_number,risk,gpa\n\
                     张三,男,高三,1班,2021001,low,3.8\n\
                     李四,女,高二,2班,2022002,medium,3.2\n\
                     王五,男,高一,3班,2023003,high,2.1\n"
                        .into();
            }
            if ghost_button(ui, &theme, "关闭").clicked() {
                app.ui_state.show_import = false;
            }
        });
    });
}

// ─────────────────────────────────────────────
// Export Panel
// ─────────────────────────────────────────────
fn export_panel(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        ui.label(
            egui::RichText::new("导出学生数据")
                .font(FontId::proportional(13.0))
                .strong()
                .color(theme.text),
        );
        ui.horizontal(|ui| {
            ui.radio_value(&mut app.ui_state.export_scope, ExportScope::All, "全部学生");
            ui.radio_value(&mut app.ui_state.export_scope, ExportScope::SelectedStudent, "当前学生");
        });
        let students = app.students.read().clone();
        let csv = crate::students::export_csv(&students, &app.ui_state.grades, app.ui_state.export_scope, app.selected_student);
        let mut view = csv.clone();
        ui.add(egui::TextEdit::multiline(&mut view).desired_rows(5));
        ui.horizontal(|ui| {
            if primary_button(ui, &theme, "保存到文件").clicked() {
                if let Some(path) = rfd::FileDialog::new().add_filter("CSV", &["csv"]).save_file() {
                    if std::fs::write(&path, &csv).is_ok() {
                        app.push_toast(crate::runtime::ToastKind::Success, "导出成功");
                    } else {
                        app.push_toast(crate::runtime::ToastKind::Error, "导出失败");
                    }
                }
            }
            if ghost_button(ui, &theme, "关闭").clicked() {
                app.ui_state.show_export_preview = false;
            }
        });
    });
}

// ─────────────────────────────────────────────
// Edit Dialog
// ─────────────────────────────────────────────
fn edit_dialog(app: &mut App, ui: &mut Ui) {
    let mut open = true;
    let mut to_save: Option<Student> = None;
    let theme = app.theme.clone();

    egui::Window::new("编辑学生档案")
        .open(&mut open)
        .resizable(false)
        .collapsible(false)
        .min_width(520.0)
        .show(ui.ctx(), |ui| {
            let s = app.ui_state.editing_student.as_mut().unwrap();

            egui::ScrollArea::vertical().show(ui, |ui| {
                egui::Grid::new("edit_grid")
                    .num_columns(2)
                    .spacing(Vec2::new(16.0, 10.0))
                    .show(ui, |ui| {
                        edit_label(ui, &theme, "姓名 *");
                        ui.text_edit_singleline(&mut s.name);
                        ui.end_row();

                        edit_label(ui, &theme, "性别");
                        let genders = ["男", "女", "其他"];
                        let mut gender_idx = s.gender.as_ref().and_then(|g| genders.iter().position(|&x| x == g.as_str())).unwrap_or(0);
                        egui::ComboBox::from_id_source("gender_combo")
                            .selected_text(s.gender.as_deref().unwrap_or("男"))
                            .show_ui(ui, |ui| {
                                for (i, &g) in genders.iter().enumerate() {
                                    ui.selectable_value(&mut gender_idx, i, g);
                                }
                            });
                        s.gender = Some(genders[gender_idx].to_string());
                        ui.end_row();

                        edit_label(ui, &theme, "学号");
                        let mut num = s.id_number.clone().unwrap_or_default();
                        ui.text_edit_singleline(&mut num);
                        s.id_number = if num.is_empty() { None } else { Some(num) };
                        ui.end_row();

                        edit_label(ui, &theme, "年级 *");
                        ui.text_edit_singleline(&mut s.grade);
                        ui.end_row();

                        edit_label(ui, &theme, "班级 *");
                        ui.text_edit_singleline(&mut s.class);
                        ui.end_row();

                        edit_label(ui, &theme, "出生日期");
                        let mut birth = s.birth_date.map_or_else(String::new, |d| d.to_string());
                        ui.text_edit_singleline(&mut birth);
                        s.birth_date = NaiveDate::parse_from_str(&birth, "%Y-%m-%d").ok();
                        ui.end_row();

                        edit_label(ui, &theme, "入学日期");
                        let mut enroll = s.enrollment_date.map_or_else(String::new, |d| d.to_string());
                        ui.text_edit_singleline(&mut enroll);
                        s.enrollment_date = NaiveDate::parse_from_str(&enroll, "%Y-%m-%d").ok();
                        ui.end_row();

                        edit_label(ui, &theme, "GPA");
                        let mut gpa = s.gpa.unwrap_or(0.0);
                        ui.add(egui::Slider::new(&mut gpa, 0.0..=4.0).step_by(0.1));
                        s.gpa = Some(gpa);
                        ui.end_row();

                        edit_label(ui, &theme, "风险等级");
                        let mut idx = s.risk_level as i32;
                        egui::ComboBox::from_id_source("risk_combo")
                            .selected_text(s.risk_level.label())
                            .show_ui(ui, |ui| {
                                for r in RiskLevel::all() {
                                    ui.selectable_value(&mut idx, r as i32, r.label());
                                }
                            });
                        s.risk_level = RiskLevel::all()[idx as usize];
                        ui.end_row();

                        edit_label(ui, &theme, "监护人姓名");
                        let mut gname = s.guardian_name.clone().unwrap_or_default();
                        ui.text_edit_singleline(&mut gname);
                        s.guardian_name = if gname.is_empty() { None } else { Some(gname) };
                        ui.end_row();

                        edit_label(ui, &theme, "监护人关系");
                        let mut grel = s.guardian_relation.clone().unwrap_or_default();
                        ui.text_edit_singleline(&mut grel);
                        s.guardian_relation = if grel.is_empty() { None } else { Some(grel) };
                        ui.end_row();

                        edit_label(ui, &theme, "监护人电话");
                        let mut gcontact = s.guardian_contact.clone().unwrap_or_default();
                        if gcontact.starts_with("enc:") {
                            gcontact = app.cipher.decrypt_str(&gcontact[4..]).unwrap_or(gcontact);
                        }
                        ui.text_edit_singleline(&mut gcontact);
                        s.guardian_contact = if gcontact.is_empty() { None } else { Some(gcontact) };
                        ui.end_row();

                        edit_label(ui, &theme, "紧急联系人");
                        let mut emerg = s.emergency_contact.clone().unwrap_or_default();
                        ui.text_edit_singleline(&mut emerg);
                        s.emergency_contact = if emerg.is_empty() { None } else { Some(emerg) };
                        ui.end_row();

                        edit_label(ui, &theme, "家庭住址");
                        let mut addr = s.home_address.clone().unwrap_or_default();
                        ui.text_edit_singleline(&mut addr);
                        s.home_address = if addr.is_empty() { None } else { Some(addr) };
                        ui.end_row();
                    });
            });

            ui.add_space(12.0);
            ui.horizontal(|ui| {
                if primary_button(ui, &theme, "保存").clicked() {
                    let mut s = app.ui_state.editing_student.take().unwrap();
                    s.updated_at = Utc::now();
                    to_save = Some(s);
                }
                if ghost_button(ui, &theme, "取消").clicked() {
                    app.ui_state.editing_student = None;
                }
            });
        });

    if let Some(s) = to_save {
        let _ = app.runtime.tx.send(crate::runtime::Command::SaveStudent(s));
    }
    if !open {
        app.ui_state.editing_student = None;
    }
}

fn edit_label(ui: &mut Ui, theme: &crate::theme::Theme, text: &str) {
    ui.label(
        egui::RichText::new(text)
            .font(FontId::proportional(12.0))
            .color(theme.text_dim),
    );
}

fn new_blank_student() -> Student {
    Student {
        id: Uuid::new_v4(),
        name: String::new(),
        gender: None,
        grade: "高一".into(),
        class: "1班".into(),
        id_number: None,
        birth_date: None,
        enrollment_date: None,
        guardian_name: None,
        guardian_contact: None,
        guardian_relation: None,
        home_address: None,
        emergency_contact: None,
        risk_level: RiskLevel::Low,
        gpa: None,
        tags: vec![],
        notes: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
    }
}
