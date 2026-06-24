//! Agents page: flat 3-column grid of all agents with colored icon-wraps,
//! matching the DeepSeek-style dark sci-fi reference. Each card shows a 48 px
//! tinted icon box, a 16 px bold name (with an optional "New" pill), a 13 px
//! description and an `agent_tag` pill. A capability radar chart for the
//! active agent sits below the grid inside a glass card.

use eframe::egui::{
    self, Align, Color32, FontId, Layout, Pos2, Rect, Rounding, Sense, Stroke, Ui, Vec2,
};

use crate::agents::AgentDef;
use crate::app::App;
use crate::theme::Theme;
use crate::ui::icons;
use crate::ui::widgets::{agent_tag, glass_card, hover_lift_card, panel_title};

/// Per-agent visual identity: icon stroke color, the theme-icon painter, the
/// tag label shown at the bottom of the card and whether to render a "New"
/// pill next to the name.
struct AgentStyle {
    color: Color32,
    icon: fn(&eframe::egui::Painter, Rect, &Theme),
    tag: &'static str,
    is_new: bool,
}

fn agent_style(agent: &AgentDef) -> AgentStyle {
    let blue = Color32::from_rgb(59, 130, 246);
    let orange = Color32::from_rgb(249, 115, 22);
    let green = Color32::from_rgb(16, 185, 129);
    let purple = Color32::from_rgb(168, 85, 247);
    let cyan = Color32::from_rgb(6, 182, 212);
    let yellow = Color32::from_rgb(234, 179, 8);
    let pink = Color32::from_rgb(236, 72, 153);
    let red = Color32::from_rgb(239, 68, 68);
    match agent.id {
        "governor" => AgentStyle {
            color: blue,
            icon: icons::gem,
            tag: "统一调度",
            is_new: true,
        },
        "supervisor" => AgentStyle {
            color: orange,
            icon: icons::chalkboard,
            tag: "教学质量",
            is_new: false,
        },
        "validator" => AgentStyle {
            color: green,
            icon: icons::robot,
            tag: "AI 验证",
            is_new: false,
        },
        "psychology" => AgentStyle {
            color: purple,
            icon: icons::heart,
            tag: "心理健康",
            is_new: false,
        },
        "home_school" => AgentStyle {
            color: cyan,
            icon: icons::school,
            tag: "家校共育",
            is_new: false,
        },
        "safety" => AgentStyle {
            color: yellow,
            icon: icons::shield,
            tag: "校园安全",
            is_new: false,
        },
        "academic" => AgentStyle {
            color: blue,
            icon: icons::rag,
            tag: "学业分析",
            is_new: false,
        },
        "counselor" => AgentStyle {
            color: pink,
            icon: icons::heart,
            tag: "学生辅导",
            is_new: false,
        },
        "discipline-officer" => AgentStyle {
            color: red,
            icon: icons::shield,
            tag: "纪律管理",
            is_new: false,
        },
        "risk-alert" => AgentStyle {
            color: red,
            icon: icons::bolt,
            tag: "风险预警",
            is_new: false,
        },
        "data-analyst" => AgentStyle {
            color: cyan,
            icon: icons::chart_pie,
            tag: "数据洞察",
            is_new: false,
        },
        "weekly-reporter" => AgentStyle {
            color: purple,
            icon: icons::message,
            tag: "周报摘要",
            is_new: false,
        },
        "class-monitor" => AgentStyle {
            color: orange,
            icon: icons::students,
            tag: "班级事务",
            is_new: false,
        },
        "research" => AgentStyle {
            color: blue,
            icon: icons::brain,
            tag: "教学研究",
            is_new: false,
        },
        "student-care" => AgentStyle {
            color: green,
            icon: icons::heart,
            tag: "学生关怀",
            is_new: false,
        },
        "bug-hunter" => AgentStyle {
            color: yellow,
            icon: icons::bolt,
            tag: "问题追踪",
            is_new: false,
        },
        "executor" => AgentStyle {
            color: blue,
            icon: icons::robot,
            tag: "任务执行",
            is_new: false,
        },
        _ => AgentStyle {
            color: blue,
            icon: icons::agent,
            tag: "核心调度",
            is_new: false,
        },
    }
}

pub fn show(app: &mut App, ui: &mut Ui) {
    // The topbar already renders the page title ("AI 代理") and subtitle, so we
    // skip the header-flex here and go straight to the agent grid.

    let agents = crate::agents::all_agents();

    egui::ScrollArea::vertical().show(ui, |ui| {
        // Responsive column count: 3 cols by default, 2 when narrow, 1 when
        // very narrow — mirrors the reference media queries.
        let avail = ui.available_width();
        let cols = if avail >= 720.0 {
            3
        } else if avail >= 420.0 {
            2
        } else {
            1
        };
        let gap = 16.0;
        let col_w = ((avail - gap * (cols - 1) as f32) / cols as f32).max(160.0);

        for chunk in agents.chunks(cols) {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing = Vec2::new(gap, gap);
                for agent in chunk {
                    agent_card(app, ui, agent, col_w);
                }
            });
            ui.add_space(gap);
        }

        // Capability radar for the active agent, wrapped in a glass card.
        if let Some(a) = crate::agents::find(&app.active_agent) {
            ui.add_space(8.0);
            glass_card(ui, &app.theme, |ui| {
                panel_title(ui, &app.theme, "能力画像");
                ui.add_space(4.0);
                ui.horizontal(|ui| {
                    let avatar_rect = Rect::from_min_size(
                        Pos2::new(ui.cursor().left(), ui.cursor().center().y - 14.0),
                        Vec2::splat(28.0),
                    );
                    let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
                    icons::avatar(ui.painter(), avatar_rect, color, a.name);
                    ui.add_space(34.0);
                    ui.vertical(|ui| {
                        ui.label(
                            egui::RichText::new(a.name)
                                .font(FontId::proportional(16.0))
                                .strong()
                                .color(app.theme.text),
                        );
                        ui.label(
                            egui::RichText::new(a.description)
                                .font(FontId::proportional(12.0))
                                .color(app.theme.text_dim),
                        );
                    });
                });
                ui.add_space(4.0);
                let axes = ["专业度", "响应", "共情", "严谨", "效率", "协作"];
                let hash = hash_str(a.id);
                let values: Vec<f32> = (0..6)
                    .map(|i| {
                        let h = (hash >> (i * 5)) & 0x1f;
                        (h as f32 / 31.0).mul_add(0.5, 0.5)
                    })
                    .collect();
                let color = Color32::from_rgb(a.color[0], a.color[1], a.color[2]);
                crate::charts::radar_chart(ui, &app.theme, "", &axes, &values, color, 220.0);
            });
        }
    });
}

fn agent_card(app: &mut App, ui: &mut Ui, agent: &AgentDef, width: f32) {
    let active = app.active_agent == agent.id;
    let theme = &app.theme;
    let style = agent_style(agent);

    let resp = ui
        .allocate_ui_with_layout(
            Vec2::new(width, 200.0),
            Layout::top_down(Align::LEFT),
            |ui| {
                hover_lift_card(ui, theme, 1.0, |ui| {
                    // 12 px vertical gap between card children (matches
                    // reference `gap: 12px`).
                    ui.spacing_mut().item_spacing.y = 12.0;

                    // 48 px icon-wrap: tinted rounded box + colored glyph.
                    render_icon_wrap(ui, theme, &style);

                    // Name (16 px / 600) with optional "New" pill.
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 4.0;
                        ui.label(
                            egui::RichText::new(agent.name)
                                .font(FontId::proportional(16.0))
                                .strong()
                                .color(theme.text),
                        );
                        if style.is_new {
                            new_badge(ui);
                        }
                    });

                    // Description (13 px, #94a3b8), wraps to 2 lines.
                    ui.add(
                        egui::Label::new(
                            egui::RichText::new(agent.description)
                                .font(FontId::proportional(13.0))
                                .color(theme.text_dim),
                        )
                        .wrap(true),
                    );

                    // Category tag pill.
                    agent_tag(ui, theme, style.tag);
                })
            },
        )
        .inner;

    // Active-card accent border drawn on top of the hairline border.
    if active {
        ui.painter().rect_stroke(
            resp.rect,
            Rounding::same(20.0),
            Stroke::new(2.0, theme.accent),
        );
    }

    if resp.clicked() {
        app.active_agent = agent.id.to_string();
    }
    // egui reports both `clicked()` and `double_clicked()` on the second
    // press of a double-click, so check `double_clicked()` independently.
    if resp.double_clicked() {
        open_chat(app, agent);
    }
}

/// Draw the 48 px rounded icon container (radius 16 px) with a 10 %-alpha
/// tinted background and the agent's themed glyph centered inside.
fn render_icon_wrap(ui: &mut Ui, theme: &Theme, style: &AgentStyle) {
    let size = 48.0;
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(size), Sense::hover());
    let bg = tint(style.color, 0.1);
    ui.painter().rect_filled(rect, Rounding::same(16.0), bg);
    // Theme icons pick their own colors from the theme, so we clone the theme
    // and override the relevant accent fields to the agent's signature color.
    let icon_theme = themed_for_color(theme, style.color);
    (style.icon)(ui.painter(), rect, &icon_theme);
}

/// Small blue "New" pill: 10 px white text on #3b82f6, radius 10 px.
fn new_badge(ui: &mut Ui) {
    let galley = ui.painter().layout(
        "New".to_string(),
        FontId::proportional(10.0),
        Color32::WHITE,
        f32::INFINITY,
    );
    let pad = Vec2::new(6.0, 2.0);
    let size = galley.size() + pad * 2.0;
    let (rect, _) = ui.allocate_exact_size(size, Sense::hover());
    ui.painter()
        .rect_filled(rect, Rounding::same(10.0), Color32::from_rgb(59, 130, 246));
    ui.painter().galley(
        Pos2::new(
            rect.center().x - galley.size().x / 2.0,
            rect.center().y - galley.size().y / 2.0,
        ),
        galley,
        Color32::WHITE,
    );
}

fn open_chat(app: &mut App, agent: &AgentDef) {
    let student_id = app.selected_student;
    let title = if let Some(sid) = student_id {
        let students = app.students.read();
        let name = students
            .iter()
            .find(|s| s.id == sid)
            .map_or("", |s| s.name.as_str());
        if name.is_empty() {
            format!("与 {} 对话", agent.name)
        } else {
            format!("{} · {}", name, agent.name)
        }
    } else {
        format!("与 {} 对话", agent.name)
    };
    let _ = app
        .runtime
        .tx
        .send(crate::runtime::Command::NewConversation {
            agent_id: agent.id.to_string(),
            student_id,
            title,
        });
    app.navigate(crate::app::Page::Chat);
}

/// Premultiplied-alpha tint of `color` at the given opacity (0..1).
fn tint(color: Color32, alpha: f32) -> Color32 {
    Color32::from_rgba_premultiplied(
        (color.r() as f32 * alpha) as u8,
        (color.g() as f32 * alpha) as u8,
        (color.b() as f32 * alpha) as u8,
        (255.0 * alpha) as u8,
    )
}

/// Clone the theme with all accent fields overridden to `color` so that any
/// theme-icon painter renders in the agent's signature hue.
fn themed_for_color(theme: &Theme, color: Color32) -> Theme {
    let mut t = theme.clone();
    t.text_dim = color;
    t.accent = color;
    t.accent_dim = tint(color, 0.15);
    t.cyan = color;
    t.pink = color;
    t.success = color;
    t.success_dim = tint(color, 0.15);
    t.purple = color;
    t.warning = color;
    t.border_strong = color;
    t
}

fn hash_str(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}
