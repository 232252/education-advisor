//! Student list panel: the left column with search, scrollable list, and the
//! right detail panel (delegated to [`super::detail`]).

use eframe::egui::{
    self, Align, Align2, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Ui, Vec2,
};

use crate::app::App;
use crate::models::Student;
use crate::ui::widgets::{card, empty_state, search_input};

/// Render the two-column list + detail layout.
pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();

    // ── Header with title and action bar ──
    ui.horizontal(|ui| {
        crate::ui::widgets::section_title(ui, &theme, "学生档案");
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.add_space(4.0);
            if crate::ui::widgets::tool_button(ui, &theme, "导出", crate::ui::icons::download)
                .clicked()
            {
                app.ui_state.show_export_preview = !app.ui_state.show_export_preview;
            }
            if crate::ui::widgets::tool_button(ui, &theme, "导入", crate::ui::icons::upload)
                .clicked()
            {
                app.ui_state.show_import = !app.ui_state.show_import;
            }
            if crate::ui::widgets::primary_button(ui, &theme, "+ 新增学生").clicked() {
                app.ui_state.editing_student = Some(super::edit::new_blank_student());
            }
        });
    });

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
                ui.horizontal(|ui| {
                    let w = ui.available_width();
                    search_input(
                        ui,
                        &theme,
                        &mut app.ui_state.student_filter,
                        "搜索姓名、学号、班级...",
                        w,
                    );
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
                            || s.id_number
                                .as_ref()
                                .is_some_and(|n| n.to_lowercase().contains(&filter))
                    })
                    .collect();

                egui::ScrollArea::vertical()
                    .max_height(ui.available_height() - 4.0)
                    .show(ui, |ui| {
                        if filtered.is_empty() {
                            empty_state(ui, &theme, crate::ui::icons::students, "暂无学生数据");
                        }
                        for s in &filtered {
                            row(app, ui, s);
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
                super::detail::show(app, ui, student);
            } else {
                card(ui, &theme, |ui| {
                    empty_state(
                        ui,
                        &theme,
                        crate::ui::icons::students,
                        "选择左侧学生查看完整档案",
                    );
                });
            }
        });
    });
}

/// A single clickable row in the list. Emits a `LoadGrades` command on click
/// so the detail panel can render the grades tab instantly.
fn row(app: &mut App, ui: &mut Ui, s: &Student) {
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

    let meta = format!(
        "{} · {} · 学号: {}",
        s.grade,
        s.class,
        s.id_number.as_deref().unwrap_or("—")
    );
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
        let gpa_color = if gpa >= 3.5 {
            theme.success
        } else if gpa >= 2.5 {
            theme.warning
        } else {
            theme.danger
        };
        let galley = ui.ctx().fonts(|f| {
            f.layout_no_wrap(gpa_text.clone(), FontId::proportional(10.0), gpa_color)
        });
        let badge_w = galley.rect.width() + 16.0;
        let badge_h = 22.0;
        let badge_rect = Rect::from_min_size(
            Pos2::new(rect.max.x - badge_w - 10.0, rect.center().y - badge_h / 2.0),
            Vec2::new(badge_w, badge_h),
        );
        ui.painter().rect_filled(
            badge_rect,
            Rounding::same(8.0),
            theme.translucent(gpa_color, 0.12),
        );
        ui.painter()
            .galley(badge_rect.center() - galley.rect.size() * 0.5, galley, gpa_color);
    }

    // Risk badge
    let risk_color = theme.risk_color(s.risk_level);
    let risk_text = s.risk_level.label();
    let r_galley = ui.ctx().fonts(|f| {
        f.layout_no_wrap(risk_text.to_string(), FontId::proportional(9.0), risk_color)
    });
    let r_w = r_galley.rect.width() + 12.0;
    let r_h = 18.0;
    let r_rect = Rect::from_min_size(
        Pos2::new(rect.max.x - r_w - 10.0, rect.min.y + 8.0),
        Vec2::new(r_w, r_h),
    );
    ui.painter()
        .rect_filled(r_rect, Rounding::same(6.0), theme.translucent(risk_color, 0.15));
    ui.painter()
        .galley(r_rect.center() - r_galley.rect.size() * 0.5, r_galley, risk_color);

    if resp.clicked() {
        app.selected_student = Some(s.id);
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::LoadGrades(s.id));
    }
}
