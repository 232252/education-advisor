//! Chat page: modern conversation interface with message bubbles,
//! streaming display, tool-call timeline, and student linkage.

use eframe::egui::{
    self, Align, Align2, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Stroke, Ui, Vec2,
};
use uuid::Uuid;

use crate::app::App;
use crate::models::{Message, Role, ToolStatus};
use crate::theme::Theme;
use crate::ui::icons;
use crate::ui::widgets::{
    empty_state, ghost_button, glass_card, panel_title, primary_button, search_input,
};

pub fn show(app: &mut App, ui: &mut Ui) {
    let theme = app.theme.clone();
    panel_title(ui, &theme, "对话");

    let avail = ui.available_width();
    let list_w = 280.0_f32.min(avail * 0.30);

    ui.horizontal_top(|ui| {
        // ═══════════════════════════════════════
        //  LEFT: Conversation List
        // ═══════════════════════════════════════
        ui.vertical(|ui| {
            ui.set_min_width(list_w);
            ui.set_max_width(list_w);
            glass_card(ui, &theme, |ui| {
                // Header with new button
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new("会话列表")
                            .font(FontId::proportional(13.0))
                            .strong()
                            .color(theme.text),
                    );
                    ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                        if primary_button(ui, &theme, "+ 新建").clicked() {
                            new_conversation(app);
                        }
                    });
                });
                ui.add_space(8.0);

                // Quick filter
                let filter_w = ui.available_width();
                let mut filter_text = String::new();
                search_input(ui, &theme, &mut filter_text, "搜索会话...", filter_w);
                ui.add_space(6.0);

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

        ui.add_space(10.0);

        // ═══════════════════════════════════════
        //  RIGHT: Chat View
        // ═══════════════════════════════════════
        ui.vertical(|ui| {
            ui.set_min_width(ui.available_width());
            let sel = app.selected_conversation;
            let Some(conv_id) = sel else {
                glass_card(ui, &theme, |ui| {
                    empty_state(ui, &theme, icons::chat, "选择左侧会话或新建对话");
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
    let row_h = 56.0;
    let (rect, resp) =
        ui.allocate_exact_size(Vec2::new(ui.available_width(), row_h), Sense::click());

    // Background
    if selected {
        ui.painter()
            .rect_filled(rect, Rounding::same(12.0), theme.accent_dim);
        let bar = Rect::from_min_size(rect.min, Vec2::new(3.0, rect.height()));
        ui.painter()
            .rect_filled(bar, Rounding::same(2.0), theme.accent);
    } else if resp.hovered() {
        ui.painter()
            .rect_filled(rect, Rounding::same(12.0), theme.surface_hover);
    }

    // Agent avatar
    let agent = crate::agents::find(&c.agent_id);
    let avatar_rect = Rect::from_min_size(
        Pos2::new(rect.min.x + 10.0, rect.center().y - 12.0),
        Vec2::splat(24.0),
    );
    if let Some(a) = agent {
        let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
        icons::avatar(ui.painter(), avatar_rect, color, a.name);
    } else {
        icons::agent(ui.painter(), avatar_rect, theme);
    }

    // Title
    ui.painter().text(
        Pos2::new(rect.min.x + 42.0, rect.min.y + 10.0),
        Align2::LEFT_CENTER,
        crate::util::truncate(&c.title, 18),
        FontId::proportional(12.0),
        theme.text,
    );

    // Meta: student name + time
    let meta_text = if let Some(sid) = c.student_id {
        let students = app.students.read();
        let name = students
            .iter()
            .find(|s| s.id == sid)
            .map_or("未知学生", |s| s.name.as_str());
        format!("{name} · {}", c.updated_at.format("%m-%d %H:%M"))
    } else {
        c.updated_at.format("%m-%d %H:%M").to_string()
    };
    ui.painter().text(
        Pos2::new(rect.min.x + 42.0, rect.min.y + 28.0),
        Align2::LEFT_CENTER,
        meta_text,
        FontId::proportional(9.0),
        theme.text_faint,
    );

    // Delete button
    let del_rect = Rect::from_min_size(
        Pos2::new(rect.max.x - 28.0, rect.center().y - 10.0),
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
}

fn chat_view(app: &mut App, ui: &mut Ui, conv_id: Uuid) {
    let theme = app.theme.clone();
    // Bug #9 — 在 chat_view 入口先记录"输入框是否聚焦"，供后面的
    // 全局 Enter 检测使用。注意：这里只在 chat 页生效（其他页根本
    // 不会调 chat_view），所以不会和全局其它 Enter 行为冲突。
    let input_had_focus_at_entry = app.ui_state.chat_input_focused;

    glass_card(ui, &theme, |ui| {
        ui.vertical(|ui| {
            // ── Header ──
            ui.horizontal(|ui| {
                // Show the *bound* agent of the conversation if any,
                // otherwise fall back to whatever the user picked globally
                // via the agents page. Don't mutate `active_agent` here:
                // that is a user-facing preference that should only change
                // when the user explicitly switches agents in the agents
                // page or via the "AI 咨询" button.
                let convs = app.conversations.read().clone();
                let bound_agent = convs
                    .iter()
                    .find(|c| c.id == conv_id)
                    .map(|c| c.agent_id.clone());
                let agent_id = bound_agent.unwrap_or_else(|| app.active_agent.clone());
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
                            .color(theme.text),
                    );
                    ui.label(
                        egui::RichText::new(a.description)
                            .font(FontId::proportional(10.0))
                            .color(theme.text_faint),
                    );
                }

                // Student link: re-resolve on every frame so that switching
                // conversations never shows a stale student name from the
                // previous session. We do NOT cache the name on the app
                // because the underlying student list is mutable and the
                // user can rename / delete a student between frames.
                let bound_student_name: Option<String> = {
                    let convs = app.conversations.read();
                    convs
                        .iter()
                        .find(|c| c.id == conv_id)
                        .and_then(|c| c.student_id)
                        .and_then(|sid| {
                            let students = app.students.read();
                            students
                                .iter()
                                .find(|s| s.id == sid)
                                .map(|s| s.name.clone())
                        })
                };
                // Also resolve the id once for the click handler so we
                // don't have to walk the conversation list twice in a
                // single frame.
                let bound_student_id: Option<uuid::Uuid> = {
                    let convs = app.conversations.read();
                    convs
                        .iter()
                        .find(|c| c.id == conv_id)
                        .and_then(|c| c.student_id)
                };
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if let Some(name) = &bound_student_name {
                        if ghost_button(ui, &theme, name).clicked() {
                            if let Some(sid) = bound_student_id {
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
                                .color(theme.accent),
                        );
                    }
                });
            });
            ui.add_space(4.0);
            crate::ui::widgets::divider(ui, &theme);
            ui.add_space(4.0);

            // ── Messages ──
            // Bug #2: 不再每帧 clone Vec<Message>，按引用迭代。
            // `streaming` 也改成按引用（Clone 仅在 `streaming_bubble` 需要
            // 内部写时借用，本身不需要 owned）。
            let messages_empty = app
                .messages
                .get(&conv_id)
                .map(|v| v.is_empty())
                .unwrap_or(true);
            let stream_empty = app
                .streaming
                .get(&conv_id)
                .map(|s| s.buffer.is_empty() && !s.active)
                .unwrap_or(true);
            egui::ScrollArea::vertical()
                .stick_to_bottom(true)
                .max_height(ui.available_height() - 70.0)
                .show(ui, |ui| {
                    if messages_empty && stream_empty {
                        empty_state(ui, &theme, icons::agent, "输入消息开始与 AI 代理对话");
                    }
                    if let Some(msgs) = app.messages.get(&conv_id) {
                        for m in msgs {
                            message_bubble(app, ui, m);
                        }
                    }
                    if let Some(s) = app.streaming.get(&conv_id) {
                        if s.active || !s.buffer.is_empty() {
                            streaming_bubble(app, ui, s);
                        }
                    }
                });

            ui.add_space(6.0);
            crate::ui::widgets::divider(ui, &theme);
            ui.add_space(6.0);

            // ── Input ──
            // Bug #9 — 用 `resp.has_focus()` 标记当前帧是否聚焦。
            // 不在 TextEdit 内部处理 Enter，避免被 TextEdit 的 IME/多行
            // 换行逻辑吞掉键事件（Shift+Enter 仍能换行）。
            ui.horizontal(|ui| {
                let input_w = ui.available_width() - 100.0;
                let resp = ui.add(
                    egui::TextEdit::multiline(&mut app.chat_input)
                        .desired_width(input_w)
                        .desired_rows(1)
                        .hint_text("输入消息，Enter 发送，Shift+Enter 换行…"),
                );
                if resp.has_focus() {
                    app.ui_state.chat_input_focused = true;
                }
                let streaming = app.streaming.get(&conv_id).is_some_and(|s| s.active);
                if streaming {
                    if ghost_button(ui, &theme, "停止").clicked() {
                        let _ = app
                            .runtime
                            .tx
                            .send(crate::runtime::Command::CancelConversation(conv_id));
                    }
                } else if primary_button(ui, &theme, "发送").clicked() {
                    send(app, conv_id);
                }
            });
        });
    });
    // Bug #9 — 全局 Enter 发送：仅在 chat 页生效（chat_view 是 chat 页
    // 唯一入口），避免与其他页的 Enter 行为冲突。
    // 关键改进：
    //   - 用 `chat_input_focused`（在 TextEdit 渲染时记录的帧内标志）
    //     来判断"用户当前是否在输入框"，与 TextEdit 自身的换行逻辑
    //     完全解耦；
    //   - 排除 Shift+Enter（让多行编辑依然能用）；
    //   - 空文本不发；
    //   - 使用 selected_conversation 而不是闭包外的 conv_id 副本，
    //     避免"用户切换了会话但 Enter 仍发给旧会话"的边界情况。
    if input_had_focus_at_entry
        || app.ui_state.chat_input_focused
    {
        let want_send = ui.input(|i| {
            i.key_pressed(egui::Key::Enter) && !i.modifiers.shift && !i.modifiers.alt
        });
        if want_send && !app.chat_input.trim().is_empty() {
            if let Some(conv) = app.selected_conversation {
                send(app, conv);
            }
        }
    }
    app.ui_state.chat_input_focused = false;
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

fn message_bubble(app: &App, ui: &mut Ui, m: &Message) {
    ui.add_space(6.0);
    let is_user = m.role == Role::User;
    let max_w = ui.available_width() * 0.78;

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

fn bubble(app: &App, ui: &mut Ui, m: &Message, max_w: f32, is_user: bool) {
    let theme = &app.theme;
    let text_color = if is_user { Color32::WHITE } else { theme.text };

    let galley = ui.painter().layout(
        m.content.clone(),
        FontId::proportional(13.0),
        text_color,
        max_w,
    );
    let pad = Vec2::new(12.0, 10.0);
    let size = galley.size() + pad * 2.0;
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());

    if is_user {
        // User messages: blue→purple gradient bubble (right-aligned).
        paint_gradient_rounded(
            ui,
            rect,
            14.0,
            theme.gradient_primary_from,
            theme.gradient_primary_to,
        );
    } else {
        // AI messages: glass card bubble (left-aligned) with hairline border.
        ui.painter().rect_filled(
            rect.translate(Vec2::new(0.0, 2.0)),
            Rounding::same(14.0),
            Color32::from_rgba_premultiplied(0, 0, 0, 30),
        );
        ui.painter()
            .rect_filled(rect, Rounding::same(14.0), theme.surface);
        ui.painter()
            .rect_stroke(rect, Rounding::same(14.0), Stroke::new(1.0, theme.border));
    }
    ui.painter().galley(
        Pos2::new(rect.min.x + pad.x, rect.min.y + pad.y),
        galley,
        text_color,
    );

    // Timestamp
    let time_text = m.created_at.format("%H:%M").to_string();
    ui.painter().text(
        Pos2::new(rect.max.x - 8.0, rect.max.y + 2.0),
        Align2::RIGHT_TOP,
        time_text,
        FontId::proportional(9.0),
        theme.text_faint,
    );

    // Tool calls
    if !m.tool_calls.is_empty() {
        ui.add_space(4.0);
        for tc in &m.tool_calls {
            tool_row(app, ui, tc);
        }
    }
}

fn streaming_bubble(app: &App, ui: &mut Ui, s: &crate::app::StreamState) {
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        let theme = &app.theme;
        let content = if s.buffer.is_empty() {
            "思考中…"
        } else {
            &s.buffer
        };
        let galley = ui.painter().layout(
            content.to_string(),
            FontId::proportional(13.0),
            theme.text,
            ui.available_width() * 0.78,
        );
        let pad = Vec2::new(12.0, 10.0);
        let size = galley.size() + pad * 2.0;
        let (rect, _) = ui.allocate_exact_size(size, Sense::hover());

        // Pulsing border effect
        let pulse = (ui.input(|i| i.time) as f32 * 3.0).sin().mul_add(0.3, 0.7);
        let pulse_color = Color32::from_rgba_premultiplied(
            theme.accent.r(),
            theme.accent.g(),
            theme.accent.b(),
            (pulse * 60.0) as u8,
        );
        ui.painter().rect_filled(
            rect.translate(Vec2::new(0.0, 2.0)),
            Rounding::same(14.0),
            Color32::from_rgba_premultiplied(0, 0, 0, 30),
        );
        ui.painter()
            .rect_filled(rect, Rounding::same(14.0), theme.surface);
        ui.painter()
            .rect_stroke(rect, Rounding::same(14.0), Stroke::new(1.5, pulse_color));
        ui.painter().galley(
            Pos2::new(rect.min.x + pad.x, rect.min.y + pad.y),
            galley,
            theme.text,
        );
    });
    if !s.tool_calls.is_empty() {
        ui.add_space(4.0);
        for tc in &s.tool_calls {
            tool_row(app, ui, tc);
        }
    }
}

fn tool_row(app: &App, ui: &mut Ui, tc: &crate::models::ToolCallRecord) {
    let theme = &app.theme;
    let color = match tc.status {
        ToolStatus::Pending | ToolStatus::Running => theme.warning,
        ToolStatus::Success => theme.success,
        ToolStatus::Failed => theme.danger,
    };

    ui.horizontal(|ui| {
        let icon_rect = Rect::from_min_size(
            Pos2::new(ui.cursor().left(), ui.cursor().center().y - 6.0),
            Vec2::splat(14.0),
        );
        match tc.status {
            ToolStatus::Pending | ToolStatus::Running => {
                // Animated spinner
                let angle = ui.input(|i| i.time) as f32 * 4.0;
                let center = icon_rect.center();
                let r = 5.0;
                let n = 8;
                for i in 0..n {
                    let a = (i as f32 / n as f32).mul_add(std::f32::consts::TAU, angle);
                    let alpha = ((i as f32 / n as f32) * 200.0) as u8;
                    let dot_color =
                        Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), alpha);
                    let p = Pos2::new(center.x + r * a.cos(), center.y + r * a.sin());
                    ui.painter().circle_filled(p, 1.5, dot_color);
                }
            }
            ToolStatus::Success => icons::check(ui.painter(), icon_rect, color),
            ToolStatus::Failed => icons::cross(ui.painter(), icon_rect, color),
        }
        ui.add_space(16.0);
        ui.label(
            egui::RichText::new(tc.name.clone())
                .font(FontId::proportional(11.0))
                .color(color),
        );
        if !tc.args.is_empty() {
            ui.label(
                egui::RichText::new(crate::util::truncate(&tc.args, 28))
                    .font(FontId::proportional(10.0))
                    .color(theme.text_faint),
            );
        }
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            ui.label(
                egui::RichText::new(crate::util::fmt_duration(tc.duration_ms))
                    .font(FontId::proportional(10.0))
                    .color(theme.text_faint),
            );
        });
    });

    if !tc.result.is_empty() && tc.status != ToolStatus::Running {
        ui.horizontal_wrapped(|ui| {
            ui.add_space(30.0);
            ui.label(
                egui::RichText::new(crate::util::truncate(&tc.result, 100))
                    .font(FontId::proportional(10.0))
                    .color(theme.text_dim),
            );
        });
    }
}

/// Paint a vertical gradient inside a rounded rectangle by drawing thin
/// horizontal strips. Used for the blue→purple user message bubbles.
fn paint_gradient_rounded(
    ui: &mut Ui,
    rect: Rect,
    rounding: f32,
    top: Color32,
    bottom: Color32,
) {
    if rect.width() <= 0.0 || rect.height() <= 0.0 {
        return;
    }
    let r = rounding.min(rect.height() / 2.0);
    // Base mid-tone to avoid gaps between strips.
    ui.painter()
        .rect_filled(rect, Rounding::same(r), Theme::lerp(top, bottom, 0.5));
    let steps = 12;
    for i in 0..steps {
        let t0 = i as f32 / steps as f32;
        let t1 = (i + 1) as f32 / steps as f32;
        let y0 = rect.min.y + t0 * rect.height();
        let y1 = rect.min.y + t1 * rect.height();
        let strip = Rect::from_min_max(Pos2::new(rect.min.x, y0), Pos2::new(rect.max.x, y1));
        let color = Theme::lerp(top, bottom, (t0 + t1) / 2.0);
        let round = if i == 0 {
            Rounding {
                nw: r,
                ne: r,
                sw: 0.0,
                se: 0.0,
            }
        } else if i == steps - 1 {
            Rounding {
                nw: 0.0,
                ne: 0.0,
                sw: r,
                se: r,
            }
        } else {
            Rounding::ZERO
        };
        ui.painter().rect_filled(strip, round, color);
    }
}
