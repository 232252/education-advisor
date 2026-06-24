//! Top bar — DeepSeek-style header-flex: page title (h1 26 px / 600) and a
//! 14 px subtitle on the left, a gradient "新对话" primary button and a glass
//! bolt icon button on the right. Mirrors the reference HTML header layout.

use eframe::egui::{self, Align, FontId, Layout, Pos2, Stroke};

use crate::app::{App, Page};
use crate::ui::icons;
use crate::ui::widgets::{glass_icon_button_theme, primary_button_with_icon};

pub fn show(app: &mut App, ctx: &egui::Context) {
    egui::TopBottomPanel::top("topbar")
        .exact_height(76.0)
        .frame(
            egui::Frame::none()
                .fill(egui::Color32::TRANSPARENT)
                .inner_margin(egui::Margin::symmetric(28.0, 0.0)),
        )
        .show(ctx, |ui| {
            let bar_rect = ui.max_rect();

            ui.horizontal(|ui| {
                // ── Left: page title (h1 26 px / 600) + subtitle (14 px, text_dim) ──
                ui.vertical(|ui| {
                    ui.spacing_mut().item_spacing.y = 2.0;
                    ui.label(
                        egui::RichText::new(app.page.label())
                            .font(FontId::proportional(26.0))
                            .strong()
                            .color(app.theme.text),
                    );
                    ui.label(
                        egui::RichText::new(page_subtitle(app.page))
                            .font(FontId::proportional(14.0))
                            .color(app.theme.text_dim),
                    );
                });

                // ── Right: 新对话 gradient button + glass bolt button ──
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    if glass_icon_button_theme(ui, &app.theme, icons::bolt).clicked() {
                        app.push_toast(crate::runtime::ToastKind::Info, "快速操作已就绪");
                    }
                    ui.add_space(10.0);

                    if primary_button_with_icon(ui, &app.theme, "新对话", icons::message).clicked() {
                        new_conversation(app);
                    }
                });
            });

            // subtle bottom hairline border (matches sidebar right border).
            ui.painter().line_segment(
                [
                    Pos2::new(bar_rect.min.x, bar_rect.max.y - 0.5),
                    Pos2::new(bar_rect.max.x, bar_rect.max.y - 0.5),
                ],
                Stroke::new(1.0, app.theme.border),
            );
        });
}

/// Page-specific subtitle shown under the title in the header.
fn page_subtitle(page: Page) -> &'static str {
    match page {
        Page::Dashboard => "智能教育管理平台",
        Page::Chat => "与 AI 代理进行智能对话",
        Page::Students => "管理学生档案与学情数据",
        Page::Agents => "配置与调度 AI 代理",
        Page::AgentHistory => "查看代理执行记录",
        Page::Models => "管理 LLM 模型提供商",
        Page::Skills => "为代理装配工具技能",
        Page::Scheduler => "编排定时任务",
        Page::Rag => "知识库与检索增强",
        Page::Privacy => "PII 脱敏与隐私保护",
        Page::Settings => "应用偏好与系统设置",
    }
}

fn new_conversation(app: &mut App) {
    let title = format!("新对话 {}", chrono::Utc::now().format("%H:%M"));
    let _ = app
        .runtime
        .tx
        .send(crate::runtime::Command::NewConversation {
            agent_id: app.active_agent.clone(),
            student_id: app.selected_student,
            title,
        });
    app.navigate(Page::Chat);
}
