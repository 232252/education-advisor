//! Scheduler page: manage cron tasks, validate expressions, run on demand.

use chrono::Utc;
use eframe::egui::{self, Align, FontId, Layout, Pos2, Rect, Ui, Vec2};
use uuid::Uuid;

use crate::app::App;
use crate::models::ScheduledTask;
use crate::ui::icons;
use crate::ui::widgets::{empty_state, ghost_button, glass_card, panel_title, primary_button};

pub fn show(app: &mut App, ui: &mut Ui) {
    panel_title(ui, &app.theme, "定时任务");

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("使用 5 段 cron 表达式调度代理自动执行")
                .font(FontId::proportional(12.0))
                .color(app.theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if primary_button(ui, &app.theme, "新建任务").clicked() {
                app.ui_state.editing_task = Some(ScheduledTask {
                    id: Uuid::new_v4(),
                    name: String::new(),
                    cron_expr: "0 8 * * 1".into(),
                    agent_id: app.active_agent.clone(),
                    prompt: String::new(),
                    enabled: true,
                    last_run: None,
                    next_run: None,
                    created_at: Utc::now(),
                });
            }
        });
    });

    ui.add_space(8.0);

    let tasks = app.tasks.read().clone();
    if tasks.is_empty() {
        glass_card(ui, &app.theme, |ui| {
            empty_state(ui, &app.theme, icons::scheduler, "暂无定时任务");
        });
    } else {
        egui::ScrollArea::vertical().show(ui, |ui| {
            for t in &tasks {
                task_row(app, ui, t);
                ui.add_space(6.0);
            }
        });
    }

    if app.ui_state.editing_task.is_some() {
        edit_dialog(app, ui);
    }
}

fn task_row(app: &mut App, ui: &mut Ui, t: &ScheduledTask) {
    glass_card(ui, &app.theme, |ui| {
        ui.horizontal_top(|ui| {
            ui.vertical(|ui| {
                ui.horizontal(|ui| {
                    let dot = if t.enabled {
                        app.theme.success
                    } else {
                        app.theme.text_faint
                    };
                    let (r, _) = ui.allocate_exact_size(Vec2::new(8.0, 8.0), egui::Sense::hover());
                    ui.painter().circle_filled(r.center(), 4.0, dot);
                    ui.label(
                        egui::RichText::new(&t.name)
                            .font(FontId::proportional(14.0))
                            .strong()
                            .color(app.theme.text),
                    );
                });
                ui.label(
                    egui::RichText::new(format!(
                        "cron: {}  ·  代理: {}",
                        t.cron_expr,
                        agent_name(&t.agent_id)
                    ))
                    .font(FontId::proportional(11.0))
                    .color(app.theme.text_dim),
                );
                ui.label(
                    egui::RichText::new(crate::util::truncate(&t.prompt, 60))
                        .font(FontId::proportional(11.0))
                        .color(app.theme.text_faint),
                );
                if let Some(lr) = t.last_run {
                    ui.label(
                        egui::RichText::new(format!("上次运行: {}", lr.format("%m-%d %H:%M")))
                            .font(FontId::proportional(10.0))
                            .color(app.theme.text_faint),
                    );
                }
            });
            ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                if ghost_button(ui, &app.theme, "立即运行").clicked() {
                    let _ = app
                        .runtime
                        .tx
                        .send(crate::runtime::Command::RunTaskNow(t.id));
                }
                if ghost_button(ui, &app.theme, "编辑").clicked() {
                    app.ui_state.editing_task = Some(t.clone());
                }
                if ghost_button(ui, &app.theme, "删除").clicked() {
                    let _ = app
                        .runtime
                        .tx
                        .send(crate::runtime::Command::DeleteTask(t.id));
                }
            });
        });
    });
}

fn agent_name(id: &str) -> &str {
    crate::agents::find(id).map_or(id, |a| a.name)
}

fn edit_dialog(app: &mut App, ui: &mut Ui) {
    let mut open = true;
    let mut to_save: Option<ScheduledTask> = None;
    egui::Window::new("编辑任务")
        .open(&mut open)
        .resizable(false)
        .show(ui.ctx(), |ui| {
            let t = app.ui_state.editing_task.as_mut().unwrap();
            egui::Grid::new("task_grid")
                .num_columns(2)
                .spacing(Vec2::new(8.0, 6.0))
                .show(ui, |ui| {
                    ui.label("名称");
                    ui.text_edit_singleline(&mut t.name);
                    ui.end_row();
                    ui.label("Cron 表达式");
                    ui.text_edit_singleline(&mut t.cron_expr);
                    ui.end_row();
                    ui.label("代理");
                    let mut selected = t.agent_id.clone();
                    egui::ComboBox::from_id_source("task_agent")
                        .selected_text(agent_name(&selected))
                        .show_ui(ui, |ui| {
                            for a in crate::agents::all_agents() {
                                ui.selectable_value(&mut selected, a.id.to_string(), a.name);
                            }
                        });
                    t.agent_id = selected;
                    ui.end_row();
                    ui.label("提示词");
                    ui.text_edit_multiline(&mut t.prompt);
                    ui.end_row();
                    ui.label("启用");
                    ui.checkbox(&mut t.enabled, "");
                    ui.end_row();
                });
            // validate cron
            match crate::scheduler::validate(&t.cron_expr) {
                Ok(()) => {
                    ui.horizontal(|ui| {
                        let icon_rect = Rect::from_min_size(
                            Pos2::new(ui.cursor().left(), ui.cursor().center().y - 6.0),
                            Vec2::splat(12.0),
                        );
                        icons::check(ui.painter(), icon_rect, app.theme.success);
                        ui.add_space(14.0);
                        ui.label(
                            egui::RichText::new("表达式有效")
                                .font(FontId::proportional(11.0))
                                .color(app.theme.success),
                        );
                    });
                    if let Ok(next) = crate::scheduler::next_fire(&t.cron_expr, Utc::now()) {
                        ui.label(
                            egui::RichText::new(format!(
                                "下次触发: {}",
                                next.format("%Y-%m-%d %H:%M")
                            ))
                            .font(FontId::proportional(11.0))
                            .color(app.theme.text_dim),
                        );
                    }
                }
                Err(e) => {
                    ui.horizontal(|ui| {
                        let icon_rect = Rect::from_min_size(
                            Pos2::new(ui.cursor().left(), ui.cursor().center().y - 6.0),
                            Vec2::splat(12.0),
                        );
                        icons::cross(ui.painter(), icon_rect, app.theme.danger);
                        ui.add_space(14.0);
                        ui.label(
                            egui::RichText::new(e.clone())
                                .font(FontId::proportional(11.0))
                                .color(app.theme.danger),
                        );
                    });
                }
            }
            ui.horizontal(|ui| {
                if primary_button(ui, &app.theme, "保存").clicked() {
                    let t = app.ui_state.editing_task.take().unwrap();
                    to_save = Some(t);
                }
                if ghost_button(ui, &app.theme, "取消").clicked() {
                    app.ui_state.editing_task = None;
                }
            });
        });
    if let Some(t) = to_save {
        let _ = app.runtime.tx.send(crate::runtime::Command::SaveTask(t));
    }
    if !open {
        app.ui_state.editing_task = None;
    }
}
