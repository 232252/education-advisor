//! Agent execution history: a timeline of all AI turns with tool-call details.

use eframe::egui::{
    self, Align, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Stroke, Ui, Vec2,
};

use crate::app::App;
use crate::models::{Role, ToolStatus};
use crate::ui::icons;
use crate::ui::widgets::{card, empty_state, ghost_button, section_title};

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    section_title(ui, &theme, "执行历史");

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("所有 AI 代理的会话与工具调用时间线")
                .font(FontId::proportional(12.0))
                .color(theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if ghost_button(ui, &theme, "刷新").clicked() {
                let _ = app
                    .runtime
                    .tx
                    .send(crate::runtime::Command::LoadConversations);
            }
        });
    });

    ui.add_space(8.0);

    let convs = app.conversations.read().clone();
    if convs.is_empty() {
        card(ui, &theme, |ui| {
            empty_state(ui, &theme, icons::history, "暂无执行记录");
        });
        return;
    }

    // Bug #18 — 分页：原版 `.take(50)` 把后面所有会话直接丢掉。
    // 现在按 `history_page_size` 分页，配合上/下一页按钮。
    if app.ui_state.history_page_size == 0 {
        app.ui_state.history_page_size = 20;
    }
    let total = convs.len();
    let page_size = app.ui_state.history_page_size;
    let total_pages = total.div_ceil(page_size).max(1);
    if app.ui_state.history_page >= total_pages {
        app.ui_state.history_page = total_pages - 1;
    }
    let start = app.ui_state.history_page * page_size;
    let end = (start + page_size).min(total);

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new(format!(
                "第 {} / {} 页（{start}–{end} / 共 {total} 条）",
                app.ui_state.history_page + 1,
                total_pages
            ))
            .font(FontId::proportional(11.0))
            .color(theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if ghost_button(ui, &theme, "下一页 ›").clicked()
                && app.ui_state.history_page + 1 < total_pages
            {
                app.ui_state.history_page += 1;
            }
            if ghost_button(ui, &theme, "‹ 上一页").clicked()
                && app.ui_state.history_page > 0
            {
                app.ui_state.history_page -= 1;
            }
        });
    });
    ui.add_space(4.0);

    egui::ScrollArea::vertical().show(ui, |ui| {
        for c in convs.iter().take(end).skip(start) {
            card(ui, &theme, |ui| {
                ui.horizontal_top(|ui| {
                    let agent = crate::agents::find(&c.agent_id);
                    let avatar_rect = Rect::from_min_size(
                        Pos2::new(ui.cursor().left(), ui.cursor().center().y - 12.0),
                        Vec2::splat(24.0),
                    );
                    if let Some(a) = agent {
                        let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
                        icons::avatar(ui.painter(), avatar_rect, color, a.name);
                    } else {
                        icons::agent(ui.painter(), avatar_rect, &theme);
                    }
                    ui.add_space(28.0);
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(&c.title)
                                .font(FontId::proportional(14.0))
                                .strong()
                                .color(theme.text),
                        );
                        ui.label(
                            egui::RichText::new(format!(
                                "{} · {}",
                                agent.map_or_else(|| c.agent_id.as_str(), |a| a.name),
                                c.updated_at.format("%Y-%m-%d %H:%M")
                            ))
                            .font(FontId::proportional(11.0))
                            .color(theme.text_dim),
                        );
                    });
                    ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                        if ghost_button(ui, &theme, "查看").clicked() {
                            app.selected_conversation = Some(c.id);
                            let _ = app
                                .runtime
                                .tx
                                .send(crate::runtime::Command::LoadMessages(c.id));
                            app.navigate(crate::app::Page::Chat);
                        }
                    });
                });

                // tool-call summary for this conversation
                let total_tools: usize = app
                    .messages
                    .get(&c.id)
                    .map(|m| m.iter().map(|mm| mm.tool_calls.len()).sum())
                    .unwrap_or(0);
                if total_tools > 0 {
                    ui.add_space(6.0);
                    ui.separator();
                    ui.add_space(4.0);
                    ui.label(
                        egui::RichText::new(format!("工具调用: {total_tools}"))
                            .font(FontId::proportional(11.0))
                            .color(theme.text_faint),
                    );
                    if let Some(msgs) = app.messages.get(&c.id) {
                        for m in msgs.iter().filter(|m| m.role == Role::Assistant) {
                            for tc in &m.tool_calls {
                                tool_call_badge(ui, tc, &theme);
                            }
                        }
                    }
                }
            });
            ui.add_space(6.0);
        }
    });
}

fn tool_call_badge(
    ui: &mut Ui,
    tc: &crate::models::ToolCallRecord,
    theme: &crate::theme::Theme,
) {
    let color = match tc.status {
        ToolStatus::Pending | ToolStatus::Running => theme.warning,
        ToolStatus::Success => theme.success,
        ToolStatus::Failed => theme.danger,
    };
    let text = format!("{} {}", tc.name, crate::util::fmt_duration(tc.duration_ms));
    let galley = ui
        .painter()
        .layout(text, FontId::proportional(10.0), color, 300.0);
    let pad = Vec2::new(8.0, 3.0);
    let icon_w = 14.0;
    let size = Vec2::new(
        pad.x.mul_add(2.0, galley.size().x) + icon_w + 4.0,
        pad.y.mul_add(2.0, galley.size().y),
    );
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    let bg = eframe::egui::Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), 30);
    ui.painter().rect_filled(rect, Rounding::same(8.0), bg);
    ui.painter()
        .rect_stroke(rect, Rounding::same(8.0), Stroke::new(1.0, color));
    let icon_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + pad.x, rect.center().y - 6.0),
        Vec2::splat(12.0),
    );
    match tc.status {
        ToolStatus::Pending | ToolStatus::Running => {
            ui.painter()
                .circle_stroke(icon_rect.center(), 5.0, Stroke::new(1.5, color));
        }
        ToolStatus::Success => icons::check(ui.painter(), icon_rect, color),
        ToolStatus::Failed => icons::cross(ui.painter(), icon_rect, color),
    }
    ui.painter().galley(
        Pos2::new(rect.min.x + pad.x + icon_w + 4.0, rect.min.y + pad.y),
        galley,
        color,
    );
}
