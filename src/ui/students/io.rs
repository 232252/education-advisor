//! Import / Export side panels for the Students page.

use eframe::egui::{self, FontId, Ui};

use crate::app::App;
use crate::ui::widgets::{glass_card, ghost_button, panel_title, primary_button};

/// Render the import / export panels if their respective toggles are on.
/// (They appear under the header but above the list, hence the
/// "`show_panels`" name.)
pub fn show_panels(app: &mut App, ui: &mut Ui) {
    if app.ui_state.show_import {
        ui.add_space(4.0);
        import(app, ui);
    }
    if app.ui_state.show_export_preview {
        ui.add_space(4.0);
        export(app, ui);
    }
}

fn import(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    glass_card(ui, &theme, |ui| {
        panel_title(ui, &theme, "批量导入学生");
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
                let _ = app
                    .runtime
                    .tx
                    .send(crate::runtime::Command::ImportStudentsCsv(text));
                app.ui_state.show_import = false;
            }
            if ghost_button(ui, &theme, "示例数据").clicked() {
                app.ui_state.import_text = "name,gender,grade,class,id_number,risk,gpa\n\
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

fn export(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    glass_card(ui, &theme, |ui| {
        panel_title(ui, &theme, "导出学生数据");
        ui.horizontal(|ui| {
            ui.radio_value(
                &mut app.ui_state.export_scope,
                crate::models::ExportScope::All,
                "全部学生",
            );
            ui.radio_value(
                &mut app.ui_state.export_scope,
                crate::models::ExportScope::SelectedStudent,
                "当前学生",
            );
        });
        let students = app.students.read().clone();
        let csv = crate::students::export_csv(
            &students,
            &app.ui_state.grades,
            app.ui_state.export_scope,
            app.selected_student,
        );
        let mut view = csv.clone();
        ui.add(egui::TextEdit::multiline(&mut view).desired_rows(5));
        ui.horizontal(|ui| {
            if primary_button(ui, &theme, "保存到文件").clicked() {
                if let Some(path) = rfd::FileDialog::new()
                    .add_filter("CSV", &["csv"])
                    .save_file()
                {
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
