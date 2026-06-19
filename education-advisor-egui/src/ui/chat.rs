//! Chat page: conversation list, streaming message view, tool-call timeline,
//! and an agent selector. This is the live surface of the AI loop.

use eframe::egui::{
    self, Align, Align2, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Stroke, Ui, Vec2,
};
use uuid::Uuid;

use crate::app::App;
use crate::models::{Message, Role, ToolStatus};
use crate::ui::icons;
use crate::ui::widgets::{
    card, empty_state, ghost_button, primary_button, section_title, text_input,
};

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    section_title(ui, &theme, "对话");

    let avail = ui.available_width();
    let list_w = 260.0_f32.min(avail * 0.28);

    ui.horizontal_top(|ui| {
        // conversation list
        ui.vertical(|ui| {
            ui.set_min_width(list_w);
            ui.set_max_width(list_w);
            card(ui, &theme, |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new("会话")
                            .font(FontId::proportional(13.0))
                            .strong()
                            .color(theme.text),
                    );
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if primary_button(ui, &theme, "新建").clicked() {
                            new_conversation(app);
                        }
                    });
                });
                ui.add_space(6.0);

                // new-conversation quick form
                ui.horizontal(|ui| {
                    let mut selected = app.ui_state.new_conversation_agent.clone();
                    egui::ComboBox::from_id_source("new_conv_agent")
                        .selected_text(agent_name(&selected))
                        .width(ui.available_width() * 0.45)
                        .show_ui(ui, |ui| {
                            for a in crate::agents::all_agents() {
                                ui.selectable_value(&mut selected, a.id.to_string(), a.name);
                            }
                        });
                    app.ui_state.new_conversation_agent = selected;
                    ui.add_space(4.0);
                    let _ = text_input(
                        ui,
                        &theme,
                        &mut app.ui_state.new_conversation_title,
                        "标题（可选）",
                        ui.available_width(),
                    );
                });

                ui.separator();
                let convs = app.conversations.read().clone();
                egui::ScrollArea::vertical()
                    .max_height(ui.available_height() - 4.0)
                    .show(ui, |ui| {
                        if convs.is_empty() {
                            empty_state(ui, &theme, icons::chat, "点击「新建」开始对话");
                        }
                        for c in &convs {
                            conversation_row(app, ui, c, &theme);
                        }
                    });
            });
        });

        ui.add_space(8.0);

        // chat view
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width());
            let sel = app.selected_conversation;
            let Some(conv_id) = sel else {
                card(ui, &theme, |ui| {
                    empty_state(ui, &theme, icons::chat, "选择或新建一个会话");
                });
                return;
            };
            chat_view(app, ui, conv_id);
        });
    });
}

fn new_conversation(app: &mut App) {
    let agent_id = if app.ui_state.new_conversation_agent.is_empty() {
        app.active_agent.clone()
    } else {
        app.ui_state.new_conversation_agent.clone()
    };
    let title = if app.ui_state.new_conversation_title.is_empty() {
        format!("新对话 {}", chrono::Utc::now().format("%H:%M"))
    } else {
        app.ui_state.new_conversation_title.clone()
    };
    let student_id = app.selected_student;
    let _ = app
        .runtime
        .tx
        .send(crate::runtime::Command::NewConversation {
            agent_id,
            student_id,
            title,
        });
    app.ui_state.new_conversation_title.clear();
}

fn conversation_row(
    app: &mut App,
    ui: &mut Ui,
    c: &crate::models::Conversation,
    theme: &crate::theme::Theme,
) {
    let selected = app.selected_conversation == Some(c.id);
    let row_h = 48.0;
    let (rect, resp) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), row_h), Sense::click());
    if selected {
        ui.painter()
            .rect_filled(rect, Rounding::same(8.0), theme.accent_dim);
    } else if resp.hovered() {
        ui.painter()
            .rect_filled(rect, Rounding::same(8.0), theme.surface);
    }

    let agent = crate::agents::find(&c.agent_id);
    let avatar_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + 8.0, rect.center().y - 10.0),
        Vec2::splat(20.0),
    );
    if let Some(a) = agent {
        let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
        icons::avatar(ui.painter(), avatar_rect, color, a.name);
    } else {
        icons::agent(ui.painter(), avatar_rect, theme);
    }

    let text_w = rect.width() - 72.0;
    ui.painter().text(
        Pos2::new(rect.min.x + 32.0, rect.min.y + 8.0),
        Align2::LEFT_CENTER,
        crate::util::truncate(&c.title, 16),
        FontId::proportional(12.0),
        theme.text,
    );
    let meta_text = if let Some(sid) = c.student_id {
        let students = app.students.read();
        let name = students.iter().find(|s| s.id == sid).map_or("未知学生", |s| s.name.as_str());
        format!("{} · {}", name, c.updated_at.format("%m-%d %H:%M"))
    } else {
        c.updated_at.format("%m-%d %H:%M").to_string()
    };
    ui.painter().text(
        Pos2::new(rect.min.x + 32.0, rect.min.y + 26.0),
        Align2::LEFT_CENTER,
        meta_text,
        FontId::proportional(9.0),
        theme.text_faint,
    );

    // inline delete button
    let del_rect = Rect::from_min_size(
        Pos2::new(rect.max.x - 26.0, rect.center().y - 10.0),
        Vec2::splat(20.0),
    );
    let del_resp = ui.allocate_rect(del_rect, Sense::click());
    let del_color = if del_resp.hovered() {
        theme.danger
    } else {
        theme.text_faint
    };
    icons::trash(ui.painter(), del_rect, del_color);
    if del_resp.clicked() {
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::DeleteConversation(c.id));
        if app.selected_conversation == Some(c.id) {
            app.selected_conversation = None;
        }
    }

    if resp.clicked() && !del_resp.clicked() {
        app.selected_conversation = Some(c.id);
        let _ = app
            .runtime
            .tx
            .send(crate::runtime::Command::LoadMessages(c.id));
    }
    let _ = text_w;
}

fn agent_name(id: &str) -> String {
    crate::agents::find(id).map_or_else(|| id.to_string(), |a| a.name.to_string())
}

fn chat_view(app: &mut App, ui: &mut Ui, conv_id: Uuid) {
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        ui.vertical(|ui| {
            // header: agent selector
            ui.horizontal(|ui| {
                let convs = app.conversations.read().clone();
                let agent_id = convs
                    .iter()
                    .find(|c| c.id == conv_id)
                    .map_or_else(|| app.active_agent.clone(), |c| c.agent_id.clone());
                app.active_agent.clone_from(&agent_id);
                let agent = crate::agents::find(&agent_id);
                let avatar_rect = Rect::from_min_size(
                    Pos2::new(ui.cursor().left(), ui.cursor().center().y - 10.0),
                    Vec2::splat(20.0),
                );
                if let Some(a) = agent {
                    let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
                    icons::avatar(ui.painter(), avatar_rect, color, a.name);
                    ui.add_space(26.0);
                    ui.label(
                        egui::RichText::new(a.name)
                            .font(FontId::proportional(14.0))
                            .strong()
                            .color(app.theme.text),
                    );
                } else {
                    icons::agent(ui.painter(), avatar_rect, &app.theme);
                    ui.add_space(26.0);
                    ui.label(
                        egui::RichText::new("代理")
                            .font(FontId::proportional(14.0))
                            .strong()
                            .color(app.theme.text),
                    );
                }
                // 若会话绑定了学生，显示快捷跳转（提前读取避免闭包内借用冲突）
                let bound_student_name: Option<String> = {
                    let convs = app.conversations.read();
                    convs.iter().find(|c| c.id == conv_id).and_then(|c| {
                        c.student_id.and_then(|sid| {
                            let students = app.students.read();
                            students.iter().find(|s| s.id == sid).map(|s| s.name.clone())
                        })
                    })
                };
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if let Some(name) = &bound_student_name {
                        if ghost_button(ui, &app.theme, name).clicked() {
                            // 提前读取 sid，避免在闭包内同时持有读锁和可变引用
                            let sid_opt = {
                                let convs = app.conversations.read();
                                convs.iter().find(|c| c.id == conv_id).and_then(|c| c.student_id)
                            };
                            if let Some(sid) = sid_opt {
                                app.selected_student = Some(sid);
                                app.navigate(crate::app::Page::Students);
                            }
                        }
                    }
                    let streaming = app.streaming.get(&conv_id).is_some_and(|s| s.active);
                    if streaming {
                        ui.spinner();
                        ui.label(
                            egui::RichText::new("生成中…")
                                .font(FontId::proportional(11.0))
                                .color(app.theme.accent),
                        );
                    }
                });
            });
            ui.separator();

            // messages
            let messages = app.messages.get(&conv_id).cloned().unwrap_or_default();
            let stream = app.streaming.get(&conv_id).cloned();
            egui::ScrollArea::vertical()
                .stick_to_bottom(true)
                .max_height(ui.available_height() - 60.0)
                .show(ui, |ui| {
                    if messages.is_empty() && stream.as_ref().map_or(true, |s| s.buffer.is_empty())
                    {
                        empty_state(ui, &app.theme, icons::agent, "输入消息开始与 AI 代理对话");
                    }
                    for m in &messages {
                        message_bubble(app, ui, m);
                    }
                    // live streaming bubble
                    if let Some(s) = &stream {
                        if s.active || !s.buffer.is_empty() {
                            streaming_bubble(app, ui, s);
                        }
                    }
                });

            ui.separator();
            // input
            ui.horizontal(|ui| {
                let resp = ui.add(
                    egui::TextEdit::multiline(&mut app.chat_input)
                        .desired_width(ui.available_width() - 90.0)
                        .desired_rows(1)
                        .hint_text("输入消息，Enter 发送，Shift+Enter 换行…"),
                );
                if resp.lost_focus()
                    && ui.input(|i| i.key_pressed(egui::Key::Enter))
                    && !ui.input(|i| i.modifiers.shift)
                {
                    if !app.chat_input.trim().is_empty() {
                        send(app, conv_id);
                    }
                    resp.request_focus();
                }
                let streaming = app.streaming.get(&conv_id).is_some_and(|s| s.active);
                if streaming {
                    if ghost_button(ui, &app.theme, "停止").clicked() {
                        let _ = app
                            .runtime
                            .tx
                            .send(crate::runtime::Command::CancelConversation(conv_id));
                    }
                } else if primary_button(ui, &app.theme, "发送").clicked() {
                    send(app, conv_id);
                }
            });
        });
    });
}

fn send(app: &mut App, conv_id: Uuid) {
    let text = std::mem::take(&mut app.chat_input);
    if text.trim().is_empty() {
        return;
    }
    let convs = app.conversations.read().clone();
    let conv = convs.into_iter().find(|c| c.id == conv_id);
    if let Some(c) = conv {
        let _ = app.runtime.tx.send(crate::runtime::Command::SendMessage {
            conversation_id: conv_id,
            agent_id: c.agent_id,
            student_id: c.student_id,
            text,
        });
    }
}

fn message_bubble(app: &mut App, ui: &mut Ui, m: &Message) {
    ui.add_space(4.0);
    let is_user = m.role == Role::User;
    let max_w = ui.available_width() * 0.75;
    ui.horizontal(|ui| {
        if is_user {
            ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                bubble(app, ui, m, max_w, true);
            });
        } else {
            bubble(app, ui, m, max_w, false);
        }
    });
    ui.add_space(2.0);
}

fn bubble(app: &mut App, ui: &mut Ui, m: &Message, max_w: f32, is_user: bool) {
    let color = if is_user {
        app.theme.accent
    } else {
        app.theme.surface
    };
    let text_color = if is_user {
        egui::Color32::WHITE
    } else {
        app.theme.text
    };
    let galley = ui.painter().layout(
        m.content.clone(),
        FontId::proportional(13.0),
        text_color,
        max_w,
    );
    let pad = 10.0;
    let size = Vec2::new(galley.size().x + pad * 2.0, galley.size().y + pad * 2.0);
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    ui.painter().rect_filled(rect, Rounding::same(12.0), color);
    ui.painter().galley(
        Pos2::new(rect.min.x + pad, rect.min.y + pad),
        galley,
        text_color,
    );

    // tool call timeline under assistant messages
    if !m.tool_calls.is_empty() {
        ui.add_space(2.0);
        for tc in &m.tool_calls {
            tool_row(app, ui, tc);
        }
    }
}

fn streaming_bubble(app: &mut App, ui: &mut Ui, s: &crate::app::StreamState) {
    ui.add_space(4.0);
    ui.horizontal(|ui| {
        let color = app.theme.surface;
        let text_color = app.theme.text;
        let content = if s.buffer.is_empty() {
            "思考中…"
        } else {
            &s.buffer
        };
        let galley = ui.painter().layout(
            content.to_string(),
            FontId::proportional(13.0),
            text_color,
            ui.available_width() * 0.75,
        );
        let pad = 10.0;
        let size = Vec2::new(galley.size().x + pad * 2.0, galley.size().y + pad * 2.0);
        let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
        ui.painter().rect_filled(rect, Rounding::same(12.0), color);
        ui.painter().galley(
            Pos2::new(rect.min.x + pad, rect.min.y + pad),
            galley,
            text_color,
        );
        let _ = ui.input(|i| i.time); // caret animation hook
    });
    if !s.tool_calls.is_empty() {
        ui.add_space(2.0);
        for tc in &s.tool_calls {
            tool_row(app, ui, tc);
        }
    }
}

fn tool_row(app: &mut App, ui: &mut Ui, tc: &crate::models::ToolCallRecord) {
    let color = match tc.status {
        ToolStatus::Pending | ToolStatus::Running => app.theme.warning,
        ToolStatus::Success => app.theme.success,
        ToolStatus::Failed => app.theme.danger,
    };
    ui.horizontal(|ui| {
        let icon_rect = Rect::from_min_size(
            Pos2::new(ui.cursor().left(), ui.cursor().center().y - 6.0),
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
        ui.add_space(14.0);
        ui.label(
            egui::RichText::new(format!("工具调用: {}", tc.name))
                .font(FontId::proportional(11.0))
                .color(color),
        );
        if !tc.args.is_empty() {
            ui.label(
                egui::RichText::new(crate::util::truncate(&tc.args, 24))
                    .font(FontId::proportional(10.0))
                    .color(app.theme.text_faint),
            );
        }
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(
                egui::RichText::new(crate::util::fmt_duration(tc.duration_ms))
                    .font(FontId::proportional(10.0))
                    .color(app.theme.text_faint),
            );
        });
    });
    if !tc.result.is_empty() && tc.status != ToolStatus::Running {
        ui.horizontal_wrapped(|ui| {
            ui.add_space(26.0);
            ui.label(
                egui::RichText::new(crate::util::truncate(&tc.result, 80))
                    .font(FontId::proportional(10.0))
                    .color(app.theme.text_dim),
            );
        });
    }
}
