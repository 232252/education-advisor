//! Student detail panel: the right-hand header + tab switcher. The four tab
//! bodies are rendered by [`super::tabs`].

use eframe::egui::{self, Align, Align2, Color32, FontId, Layout, Sense, Ui, Vec2};

use crate::app::App;
use crate::models::Student;
use crate::ui::widgets::{badge, card, danger_button, divider, tab_switcher, tool_button};

/// Render the detail header and the currently-selected tab body.
pub fn show(app: &mut App, ui: &mut Ui, student: Student) {
    let theme = app.theme.clone();

    // Header Card
    card(ui, &theme, |ui| {
        ui.horizontal_top(|ui| {
            // Large avatar
            let (av, _) = ui.allocate_exact_size(Vec2::splat(72.0), Sense::hover());
            ui.painter()
                .circle_filled(av.center(), 36.0, theme.risk_color(student.risk_level));
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
                        egui::RichText::new(format!(
                            "{} · {} · {}",
                            student.grade,
                            student.class,
                            student.id_number.as_deref().unwrap_or("暂无学号")
                        ))
                        .font(FontId::proportional(12.0))
                        .color(theme.text_dim),
                    );
                });
            });

            ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                badge(
                    ui,
                    &theme,
                    student.risk_level.label(),
                    theme.risk_color(student.risk_level),
                );
            });
        });

        ui.add_space(8.0);
        divider(ui, &theme);
        ui.add_space(8.0);

        // Quick action buttons
        ui.horizontal(|ui| {
            if tool_button(ui, &theme, "编辑档案", crate::ui::icons::edit).clicked() {
                app.ui_state.editing_student = Some(student.clone());
            }
            if tool_button(ui, &theme, "AI 咨询", crate::ui::icons::chat_color).clicked() {
                let title = format!("关于「{}」的学业咨询", student.name);
                let _ = app
                    .runtime
                    .tx
                    .send(crate::runtime::Command::NewConversation {
                        agent_id: app.active_agent.clone(),
                        student_id: Some(student.id),
                        title,
                    });
                app.navigate(crate::app::Page::Chat);
            }
            if tool_button(ui, &theme, "添加成绩", crate::ui::icons::edit).clicked() {
                app.ui_state.student_detail_tab = 1; // Switch to grades tab
            }
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if danger_button(ui, &theme, "删除").clicked() {
                    let _ = app
                        .runtime
                        .tx
                        .send(crate::runtime::Command::DeleteStudent(student.id));
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
        0 => super::tabs::basic_info(app, ui, &student),
        1 => super::tabs::grades(app, ui, &student),
        2 => super::tabs::family_info(app, ui, &student),
        3 => super::tabs::notes_tags(app, ui, &student),
        _ => {}
    }
}
