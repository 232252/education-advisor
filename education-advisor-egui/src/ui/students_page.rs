//! Students page: list, search, CRUD, per-student grades, CSV import, and a
//! one-click "ask agent" shortcut that wires the student into a new chat.

use chrono::Utc;
use eframe::egui::{self, Align, Align2, FontId, Layout, Pos2, Ui, Vec2};
use uuid::Uuid;

use crate::app::App;
use crate::models::{Student, RiskLevel, GradeEntry, ExportScope};
use crate::ui::widgets::{card, empty_state, ghost_button, primary_button, section_title};

pub fn show(app: &mut App, ui: &mut Ui) {
    section_title(ui, &app.theme, "学生档案");

    ui.horizontal(|ui| {
        ui.label(egui::RichText::new("🔍").font(FontId::proportional(14.0)));
        ui.text_edit_singleline(&mut app.ui_state.student_filter);
        ui.label(
            egui::RichText::new("筛选姓名/班级")
                .font(FontId::proportional(11.0))
                .color(app.theme.text_faint),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if ghost_button(ui, &app.theme, "导出").clicked() {
                app.ui_state.show_export_preview = !app.ui_state.show_export_preview;
            }
            if ghost_button(ui, &app.theme, "导入 Excel").clicked() {
                if let Some(path) = rfd::FileDialog::new().add_filter("Excel", &["xlsx", "xls"]).pick_file() {
                    if let Ok(bytes) = std::fs::read(&path) {
                        match crate::students::import_excel(&bytes) {
                            Ok(text) => {
                                let _ = app.runtime.tx.send(crate::runtime::Command::ImportStudentsCsv(text));
                            }
                            Err(e) => app.push_toast(crate::runtime::ToastKind::Error, format!("Excel 解析失败: {e}")),
                        }
                    }
                }
            }
            if ghost_button(ui, &app.theme, "导入 CSV").clicked() {
                app.ui_state.show_import = !app.ui_state.show_import;
            }
            if primary_button(ui, &app.theme, "新增学生").clicked() {
                app.ui_state.editing_student = Some(Student {
                    id: Uuid::new_v4(),
                    name: String::new(),
                    grade: "高一".into(),
                    class: "1班".into(),
                    birth_date: None,
                    guardian_contact: None,
                    risk_level: RiskLevel::Low,
                    gpa: None,
                    tags: vec![],
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                });
            }
        });
    });

    if app.ui_state.show_import {
        ui.add_space(4.0);
        card(ui, &app.theme, |ui| {
            ui.label(
                egui::RichText::new("粘贴 CSV（表头: name,grade,class,risk,gpa）")
                    .font(FontId::proportional(12.0))
                    .color(app.theme.text_dim),
            );
            ui.text_edit_multiline(&mut app.ui_state.import_text);
            ui.horizontal(|ui| {
                if primary_button(ui, &app.theme, "导入").clicked() {
                    let text = std::mem::take(&mut app.ui_state.import_text);
                    let _ = app
                        .runtime
                        .tx
                        .send(crate::runtime::Command::ImportStudentsCsv(text));
                    app.ui_state.show_import = false;
                }
                if ghost_button(ui, &app.theme, "示例").clicked() {
                    app.ui_state.import_text = "name,grade,class,risk,gpa\n孙悦,高三,1班,low,3.7\n周杰,高二,2班,high,2.5\n".into();
                }
            });
        });
    }

    if app.ui_state.show_export_preview {
        ui.add_space(4.0);
        export_panel(app, ui);
    }

    ui.add_space(8.0);

    // two-column: list + detail
    let avail = ui.available_width();
    let list_w = (avail * 0.42).min(420.0);

    ui.horizontal_top(|ui| {
        // list
        ui.vertical(|ui| {
            ui.set_min_width(list_w);
            card(ui, &app.theme, |ui| {
                let students = app.students.read().clone();
                let filter = app.ui_state.student_filter.to_lowercase();
                let filtered: Vec<Student> = students
                    .into_iter()
                    .filter(|s| {
                        filter.is_empty()
                            || s.name.to_lowercase().contains(&filter)
                            || s.class.to_lowercase().contains(&filter)
                    })
                    .collect();
                egui::ScrollArea::vertical()
                    .max_height(ui.available_height() - 8.0)
                    .show(ui, |ui| {
                        if filtered.is_empty() {
                            empty_state(ui, &app.theme, "🎓", "暂无学生，点击「新增学生」");
                        }
                        for s in &filtered {
                            let selected = app.selected_student == Some(s.id);
                            let (rect, resp) = ui.allocate_exact_size(
                                Vec2::new(ui.available_width(), 56.0),
                                egui::Sense::click(),
                            );
                            if selected {
                                ui.painter().rect_filled(rect, egui::Rounding::same(10.0), app.theme.accent_dim);
                            } else if resp.hovered() {
                                ui.painter().rect_filled(rect, egui::Rounding::same(10.0), app.theme.surface);
                            }
                            // avatar circle with initial
                            let av = Pos2::new(rect.min.x + 22.0, rect.center().y);
                            ui.painter().circle_filled(av, 16.0, app.theme.risk_color(s.risk_level));
                            let initial = s.name.chars().next().unwrap_or('?');
                            ui.painter().text(
                                av,
                                Align2::CENTER_CENTER,
                                initial,
                                FontId::proportional(14.0),
                                app.theme.bg,
                            );
                            ui.painter().text(
                                Pos2::new(rect.min.x + 48.0, rect.min.y + 10.0),
                                Align2::LEFT_CENTER,
                                &s.name,
                                FontId::proportional(13.0),
                                app.theme.text,
                            );
                            ui.painter().text(
                                Pos2::new(rect.min.x + 48.0, rect.min.y + 28.0),
                                Align2::LEFT_CENTER,
                                format!("{} · {}", s.grade, s.class),
                                FontId::proportional(10.0),
                                app.theme.text_faint,
                            );
                            ui.painter().text(
                                Pos2::new(rect.max.x - 8.0, rect.center().y),
                                Align2::RIGHT_CENTER,
                                s.risk_level.label(),
                                FontId::proportional(11.0),
                                app.theme.risk_color(s.risk_level),
                            );
                            if resp.clicked() {
                                app.selected_student = Some(s.id);
                                let _ = app.runtime.tx.send(crate::runtime::Command::LoadGrades(s.id));
                            }
                        }
                    });
            });
        });

        ui.add_space(8.0);

        // detail
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width());
            let sel = app.selected_student;
            let students = app.students.read().clone();
            let student = sel.and_then(|id| students.into_iter().find(|s| s.id == id));
            let Some(student) = student else {
                card(ui, &app.theme, |ui| {
                    empty_state(ui, &app.theme, "👈", "选择左侧学生查看档案");
                });
                return;
            };
            detail(app, ui, student);
        });
    });
}

fn detail(app: &mut App, ui: &mut Ui, student: Student) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        ui.horizontal_top(|ui| {
            // big avatar
            let (av, _) = ui.allocate_exact_size(Vec2::splat(56.0), egui::Sense::hover());
            ui.painter().circle_filled(av.center(), 28.0, app.theme.risk_color(student.risk_level));
            let initial = student.name.chars().next().unwrap_or('?');
            ui.painter().text(av.center(), Align2::CENTER_CENTER, initial, FontId::proportional(24.0), app.theme.bg);
            ui.vertical(|ui| {
                ui.label(egui::RichText::new(&student.name).font(FontId::proportional(20.0)).strong().color(app.theme.text));
                ui.label(egui::RichText::new(format!("{} · {}", student.grade, student.class)).font(FontId::proportional(12.0)).color(app.theme.text_dim));
            });
            ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                crate::ui::widgets::badge(ui, &theme, student.risk_level.label(), app.theme.risk_color(student.risk_level));
            });
        });

        ui.add_space(6.0);
        ui.separator();
        ui.add_space(6.0);

        let decrypted_contact = student.guardian_contact.as_ref().map_or_else(|| "—".to_string(), |c| {
            if let Some(rest) = c.strip_prefix("enc:") {
                app.cipher.decrypt_str(rest).unwrap_or_else(|_| "[解密失败]".to_string())
            } else {
                c.clone()
            }
        });

        egui::Grid::new("student_meta").num_columns(2).spacing(Vec2::new(12.0, 6.0)).show(ui, |ui| {
            ui.label(egui::RichText::new("GPA").font(FontId::proportional(12.0)).color(app.theme.text_dim));
            ui.label(egui::RichText::new(student.gpa.map_or_else(|| "—".into(), |g| format!("{g:.2}"))).font(FontId::proportional(13.0)).color(app.theme.text));
            ui.end_row();
            ui.label(egui::RichText::new("出生日期").font(FontId::proportional(12.0)).color(app.theme.text_dim));
            ui.label(egui::RichText::new(student.birth_date.map_or_else(|| "—".into(), |d| d.to_string())).font(FontId::proportional(13.0)).color(app.theme.text));
            ui.end_row();
            ui.label(egui::RichText::new("监护人电话").font(FontId::proportional(12.0)).color(app.theme.text_dim));
            ui.label(egui::RichText::new(decrypted_contact).font(FontId::proportional(13.0)).color(app.theme.text));
            ui.end_row();
            ui.label(egui::RichText::new("标签").font(FontId::proportional(12.0)).color(app.theme.text_dim));
            ui.horizontal(|ui| {
                if student.tags.is_empty() {
                    ui.label(egui::RichText::new("—").font(FontId::proportional(12.0)).color(app.theme.text_faint));
                }
                for t in &student.tags {
                    crate::ui::widgets::badge(ui, &theme, t, app.theme.info);
                }
            });
            ui.end_row();
        });

        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.add(egui::TextEdit::singleline(&mut app.ui_state.tag_input).desired_width(120.0).hint_text("新标签"));
            if ghost_button(ui, &app.theme, "添加标签").clicked() && !app.ui_state.tag_input.trim().is_empty() {
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

        ui.add_space(8.0);
        ui.horizontal(|ui| {
            if primary_button(ui, &app.theme, "编辑").clicked() {
                app.ui_state.editing_student = Some(student.clone());
            }
            if ghost_button(ui, &app.theme, "咨询代理").clicked() {
                let title = format!("关于「{}」的咨询", student.name);
                let _ = app.runtime.tx.send(crate::runtime::Command::NewConversation {
                    agent_id: app.active_agent.clone(),
                    student_id: Some(student.id),
                    title,
                });
                app.navigate(crate::app::Page::Chat);
            }
            if ghost_button(ui, &app.theme, "删除").clicked() {
                let _ = app.runtime.tx.send(crate::runtime::Command::DeleteStudent(student.id));
                app.selected_student = None;
            }
        });
    });

    ui.add_space(8.0);

    // grades chart
    let grades = app.ui_state.grades.get(&student.id).cloned().unwrap_or_default();
    let series: Vec<(&str, Vec<f32>)> = vec![("成绩", grades.iter().map(|g| g.score).collect())];
    crate::charts::line_chart(ui, &app.theme, &format!("{} 的成绩", student.name), &series, app.theme.success, 160.0);

    ui.add_space(8.0);
    card(ui, &app.theme, |ui| {
        section_title(ui, &app.theme, "添加成绩");
        ui.horizontal(|ui| {
            ui.text_edit_singleline(&mut app.ui_state.new_grade_subject);
            ui.add(egui::TextEdit::singleline(&mut app.ui_state.new_grade_score).desired_width(60.0));
            if primary_button(ui, &app.theme, "添加").clicked() {
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
        ui.label(egui::RichText::new("科目 / 分数（满分100）").font(FontId::proportional(10.0)).color(app.theme.text_faint));
    });

    // edit dialog
    if app.ui_state.editing_student.is_some() {
        edit_dialog(app, ui);
    }
}

fn edit_dialog(app: &mut App, ui: &mut Ui) {
    let mut open = true;
    let mut to_save: Option<Student> = None;
    egui::Window::new("编辑学生")
        .open(&mut open)
        .resizable(false)
        .collapsible(false)
        .show(ui.ctx(), |ui| {
            let s = app.ui_state.editing_student.as_mut().unwrap();
            egui::Grid::new("edit_grid").num_columns(2).spacing(Vec2::new(8.0, 6.0)).show(ui, |ui| {
                ui.label("姓名");
                ui.text_edit_singleline(&mut s.name);
                ui.end_row();
                ui.label("年级");
                ui.text_edit_singleline(&mut s.grade);
                ui.end_row();
                ui.label("班级");
                ui.text_edit_singleline(&mut s.class);
                ui.end_row();
                ui.label("GPA");
                let mut gpa = s.gpa.unwrap_or(0.0);
                ui.add(egui::Slider::new(&mut gpa, 0.0..=4.0).step_by(0.1));
                s.gpa = Some(gpa);
                ui.end_row();
                ui.label("风险");
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
                ui.label("出生日期");
                let mut birth_text = s.birth_date.map_or_else(String::new, |d| d.to_string());
                ui.text_edit_singleline(&mut birth_text);
                s.birth_date = chrono::NaiveDate::parse_from_str(&birth_text, "%Y-%m-%d").ok();
                ui.end_row();
                ui.label("监护人电话");
                let raw = s.guardian_contact.get_or_insert_with(String::new);
                let mut display = raw.strip_prefix("enc:").and_then(|rest| app.cipher.decrypt_str(rest).ok()).unwrap_or_else(|| raw.clone());
                ui.text_edit_singleline(&mut display);
                if display.is_empty() {
                    s.guardian_contact = None;
                } else {
                    s.guardian_contact = Some(display);
                }
                ui.end_row();
            });
            ui.horizontal(|ui| {
                if primary_button(ui, &app.theme, "保存").clicked() {
                    let mut s = app.ui_state.editing_student.take().unwrap();
                    s.updated_at = Utc::now();
                    to_save = Some(s);
                }
                if ghost_button(ui, &app.theme, "取消").clicked() {
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

fn export_panel(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        ui.label(egui::RichText::new("导出学生与成绩").font(FontId::proportional(13.0)).strong().color(theme.text));
        ui.horizontal(|ui| {
            ui.label(egui::RichText::new("范围").font(FontId::proportional(12.0)).color(theme.text_dim));
            ui.radio_value(&mut app.ui_state.export_scope, ExportScope::All, "全部");
            ui.radio_value(&mut app.ui_state.export_scope, ExportScope::SelectedStudent, "当前学生");
        });
        let students = app.students.read().clone();
        let scope = app.ui_state.export_scope;
        let selected = app.selected_student;
        let grades_map = &app.ui_state.grades;
        let csv = crate::students::export_csv(&students, grades_map, scope, selected);
        let mut csv_view = csv.clone();
        ui.add(egui::TextEdit::multiline(&mut csv_view).desired_rows(6));
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
