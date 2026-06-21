//! Modal dialog for editing a single student record, plus the blank-student
//! factory used by the "+ 新增学生" button.

use chrono::{NaiveDate, Utc};
use eframe::egui::{self, FontId, Ui};
use uuid::Uuid;

use crate::app::App;
use crate::models::{RiskLevel, Student};
use crate::ui::widgets::{ghost_button, primary_button};

/// Render the edit dialog if `editing_student` is Some.
pub fn show_dialog(app: &mut App, ui: &mut Ui) {
    if app.ui_state.editing_student.is_none() {
        return;
    }

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
                    .spacing([16.0, 10.0])
                    .show(ui, |ui| {
                        edit_label(ui, &theme, "姓名 *");
                        ui.text_edit_singleline(&mut s.name);
                        ui.end_row();

                        edit_label(ui, &theme, "性别");
                        let genders = ["男", "女", "其他"];
                        let mut gender_idx = s
                            .gender
                            .as_ref()
                            .and_then(|g| genders.iter().position(|&x| x == g.as_str()))
                            .unwrap_or(0);
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
                        let mut enroll = s
                            .enrollment_date
                            .map_or_else(String::new, |d| d.to_string());
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
                        s.guardian_relation = if grel.is_empty() {
                            None
                        } else {
                            Some(grel)
                        };
                        ui.end_row();

                        edit_label(ui, &theme, "监护人电话");
                        let mut gcontact = s.guardian_contact.clone().unwrap_or_default();
                        if gcontact.starts_with("enc:") {
                            gcontact = app
                                .cipher
                                .decrypt_str(&gcontact[4..])
                                .unwrap_or(gcontact);
                        }
                        ui.text_edit_singleline(&mut gcontact);
                        s.guardian_contact = if gcontact.is_empty() {
                            None
                        } else {
                            Some(gcontact)
                        };
                        ui.end_row();

                        edit_label(ui, &theme, "紧急联系人");
                        let mut emerg = s.emergency_contact.clone().unwrap_or_default();
                        ui.text_edit_singleline(&mut emerg);
                        s.emergency_contact = if emerg.is_empty() {
                            None
                        } else {
                            Some(emerg)
                        };
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

/// A blank `Student` record with sensible defaults, used as the seed for the
/// "+ 新增学生" button.
pub fn new_blank_student() -> Student {
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

fn edit_label(ui: &mut Ui, theme: &crate::theme::Theme, text: &str) {
    ui.label(
        egui::RichText::new(text)
            .font(FontId::proportional(12.0))
            .color(theme.text_dim),
    );
}
