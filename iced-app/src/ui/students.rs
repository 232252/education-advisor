//! Students page — list (table) + in-page expandable detail panel.
//!
//! Aligns 1:1 with `#page-students` and the `#studentDetailWrap` mount
//! point in `iced-app/preview/index.html`:
//!
//! ```text
//!   pageHead('学生', …)
//!   #studentsTableCard
//!     card-head: search + filter + 导出
//!     table: 学号 / 姓名 / 年级·班级 / 综合分 / 风险 / 标签 / 监护人 / 操作
//!     pagination footer
//!   #studentDetailWrap
//!     student-panel: avatar / name / risk pill / tabs (概览 / 学业 / 行为 / 联系 / 隐私)
//! ```
//!
//! Clicking a row in the table sets `app.selected_student` and the panel
//! expands below — the modal-based PII dialog has been replaced by the
//! in-page 隐私 tab (per `deliverable.md` P0 gap #4).
//!
//! Building blocks:
//! * `components::section_header`       — replaces `widgets::section_title`
//! * `components::score_bar::score_row` — replaces the manual progress_bar
//!   inside the detail "学业" tab
//! * `components::badge::{pill,emerald,red,amber,pink,zinc}` — risk pills
//!   and tag pills
//! * `components::empty_state`          — empty-table placeholder
//! * `ui::icons::IconName`              — replaces the literal "🔍 / ✎ / ✕ / 💬" emoji

use iced::widget::{column, container, pick_list, row, scrollable, text, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message, Page};
use crate::ui::components::badge::{self as badge};
use crate::ui::components::empty_state::empty_state;
use crate::ui::components::score_bar::score_row;
use crate::ui::components::section_header::section_header;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = app.layout_mode;

    let header = widgets::page_header(
        theme,
        "学生",
        &format!(
            "{} / {} 名学生 · 风险 {} · 重点关注 {}",
            filtered_count(app),
            app.students.read().len(),
            count_at_or_above(app, 2),
            count_at_or_above(app, 3),
        ),
    );

    // Edit form is the "modal" replacement: a full-page form that hides
    // both the table and the detail panel. This is the in-page equivalent
    // of preview's "编辑学生" button.
    if let Some(editing) = app.ui_state.editing_student.clone() {
        return column![header, Space::new().width(0.0).height(12.0), student_edit_form(app, editing)]
            .spacing(0)
            .width(Length::Fill)
            .height(Length::Fill)
            .into();
    }

    let table = students_table_card(app);

    // When the user has selected a student, render the in-page panel
    // *below* the table — this is the `#studentDetailWrap` mount point.
    let detail_wrap: Element<Message> = match app.selected_student {
        Some(id) => {
            let students = app.students.read();
            if let Some(student) = students.iter().find(|s| s.id == id).cloned() {
                student_panel(app, &student, mode)
            } else {
                Space::new().width(0.0).height(0.0).into()
            }
        }
        None => Space::new().width(0.0).height(0.0).into(),
    };

    let body = column![
        table,
        Space::new().width(0.0).height(20.0).into(),
        detail_wrap,
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill);

    column![header, Space::new().width(0.0).height(12.0), body]
        .spacing(0)
        .height(Length::Fill)
        .width(Length::Fill)
        .into()
}

fn filtered_count(app: &App) -> usize {
    let students = app.students.read();
    let filter = app.ui_state.student_filter.to_lowercase();
    if filter.is_empty() {
        students.len()
    } else {
        students
            .iter()
            .filter(|s| {
                s.name.to_lowercase().contains(&filter)
                    || s.grade.to_lowercase().contains(&filter)
                    || s.class.to_lowercase().contains(&filter)
                    || s.tags.iter().any(|t| t.to_lowercase().contains(&filter))
            })
            .count()
    }
}

fn count_at_or_above(app: &App, threshold: usize) -> usize {
    app.students
        .read()
        .iter()
        .filter(|s| s.risk_level as usize >= threshold)
        .count()
}

// ── students table card ────────────────────────────────────────────

fn students_table_card(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let students = app.students.read().clone();
    let filter = app.ui_state.student_filter.to_lowercase();

    let filtered: Vec<_> = students
        .iter()
        .filter(|s| {
            filter.is_empty()
                || s.name.to_lowercase().contains(&filter)
                || s.grade.to_lowercase().contains(&filter)
                || s.class.to_lowercase().contains(&filter)
                || s.tags.iter().any(|t| t.to_lowercase().contains(&filter))
        })
        .take(50)
        .cloned()
        .collect();

    let mut card_inner: Vec<Element<Message>> = Vec::new();

    // Card head: search + filter + 导出
    let search: Element<Message> = row![
        iced::widget::Svg::new(icon(IconName::Search))
            .width(Length::Fixed(13.0))
            .height(Length::Fixed(13.0)),
        iced::widget::text_input("按姓名 / 学号 / 班级", &app.ui_state.student_filter)
            .on_input(Message::StudentFilterChanged)
            .font(CJK_FONT)
            .size(12)
            .padding(iced::Padding {
                top: 4.0,
                bottom: 4.0,
                left: 8.0,
                right: 8.0,
            })
            .style(move |_, status| style::text_input_style(theme, status))
            .width(Length::Fill),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 5.0,
        bottom: 5.0,
        left: 11.0,
        right: 11.0,
    })
    .into();

    let search_box: Element<Message> = container(search)
        .width(Length::Fixed(280.0))
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(
                0.66, 0.33, 0.97, 0.06,
            ))),
            border: iced::Border {
                color: iced::Color::from_rgba(0.66, 0.33, 0.97, 0.20),
                width: 1.0,
                radius: iced::border::Radius::from(8.0),
            },
            ..Default::default()
        })
        .into();

    let filter_btn: Element<Message> = iced::widget::button(
        row![
            iced::widget::Svg::new(icon(IconName::Filter))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            text("筛选")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(0.71, 0.74, 0.83)),
                }),
        ]
        .spacing(5)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding(iced::Padding {
        top: 5.0,
        bottom: 5.0,
        left: 11.0,
        right: 11.0,
    })
    .into();

    let export_btn: Element<Message> = iced::widget::button(
        row![
            iced::widget::Svg::new(icon(IconName::Download))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            text("导出")
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        ]
        .spacing(5)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::primary_button(theme, status))
    .padding(iced::Padding {
        top: 5.0,
        bottom: 5.0,
        left: 11.0,
        right: 11.0,
    })
    .into();

    let card_head: Element<Message> = row![
        search_box,
        filter_btn,
        Space::new().width(Length::Fixed(8.0)).height(Length::Fixed(0.0)),
        text(format!("显示 1-{}", filtered.len()))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        export_btn,
    ]
    .spacing(10)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 14.0,
        bottom: 14.0,
        left: 20.0,
        right: 20.0,
    })
    .into();

    card_inner.push(card_head);

    // Table
    if filtered.is_empty() {
        card_inner.push(
            container(empty_state::<Message>(
                IconName::Users,
                "没有匹配的学生",
                "试试清除筛选条件或新增一名学生",
            ))
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .into(),
        );
    } else {
        card_inner.push(build_table(app, &filtered));
    }

    // Pagination footer
    card_inner.push(pagination_footer(app, filtered.len(), students.len()));

    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}

fn build_table(app: &App, filtered: &[crate::models::Student]) -> Element<Message> {
    let header_row: Element<Message> = row![
        th("学号", 80.0),
        th("姓名", 110.0),
        th("年级 / 班级", 130.0),
        th("综合分", 70.0),
        th("风险等级", 90.0),
        th("标签", 130.0),
        th("监护人", 110.0),
        th("", 110.0),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 10.0,
        bottom: 10.0,
        left: 16.0,
        right: 16.0,
    })
    .into();

    let mut rows_vec: Vec<Element<Message>> = Vec::new();
    rows_vec.push(header_row);
    for s in filtered {
        rows_vec.push(student_table_row(app, s));
    }

    let body: Element<Message> = column(rows_vec)
        .spacing(0)
        .width(Length::Fill)
        .into();

    container(body).width(Length::Fill).into()
}

fn th(text_str: &str, width: f32) -> Element<Message> {
    let t = iced::widget::text(text_str).size(11).style(move |_: &iced::Theme| {
        iced::widget::text::Style {
            color: Some(iced::Color::from_rgb(0.61, 0.64, 0.78)),
        }
    });
    container(t).width(Length::Fixed(width)).into()
}

fn student_table_row(app: &App, s: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let active = app.selected_student == Some(s.id);
    let risk_pill: Element<Message> = risk_pill_for(s.risk_level);

    let score_color = match s.gpa.unwrap_or(0.0) {
        g if g >= 3.4 => iced::Color::from_rgb(110.0 / 255.0, 231.0 / 255.0, 183.0 / 255.0),
        g if g >= 2.8 => iced::Color::from_rgb(252.0 / 255.0, 211.0 / 255.0, 77.0 / 255.0),
        _ => iced::Color::from_rgb(252.0 / 255.0, 165.0 / 255.0, 165.0 / 255.0),
    };
    let score_text = format!("{:.0}", s.gpa.map(|g| g * 25.0).unwrap_or(0.0));

    // Tags
    let mut tag_row: Vec<Element<Message>> = Vec::new();
    for tag in s.tags.iter().take(2) {
        tag_row.push(badge::zinc::<Message>(tag));
    }
    let tags_el: Element<Message> = if tag_row.is_empty() {
        text("—")
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme))
            .into()
    } else {
        row(tag_row).spacing(3).into()
    };

    // Actions: 查看 / 编辑 / 对话
    let actions: Element<Message> = row![
        icon_button(IconName::Eye, Message::SelectStudent(s.id), theme),
        icon_button(IconName::Edit, Message::EditStudent(Some(s.clone())), theme),
        icon_button(IconName::Message, Message::Navigate(Page::Chat), theme),
    ]
    .spacing(4)
    .into();

    let cells: Element<Message> = row![
        text(s.id_number.clone().unwrap_or_else(|| format!("S_{:03}", 0)))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme))
            .width(Length::Fixed(80.0)),
        text(s.name.clone())
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(if active { theme.accent_hover } else { theme.text }),
            })
            .width(Length::Fixed(110.0)),
        text(format!("{} · {}", s.grade, s.class))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .width(Length::Fixed(130.0)),
        text(score_text)
            .font(iced::Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(12)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(score_color),
            })
            .width(Length::Fixed(70.0)),
        container(risk_pill)
            .width(Length::Fixed(90.0))
            .into(),
        container(tags_el).width(Length::Fixed(130.0)).into(),
        text(s.guardian_name.clone().unwrap_or_else(|| "—".into()))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .width(Length::Fixed(110.0)),
        container(actions).width(Length::Fixed(110.0)).into(),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 10.0,
        bottom: 10.0,
        left: 16.0,
        right: 16.0,
    });

    let bg = if active {
        iced::Color::from_rgba(0.66, 0.33, 0.97, 0.08)
    } else {
        iced::Color::TRANSPARENT
    };
    let border = if active {
        iced::Color::from_rgba(0.66, 0.33, 0.97, 0.20)
    } else {
        iced::Color::from_rgba(1.0, 1.0, 1.0, 0.04)
    };

    let row_content: Element<Message> = container(cells)
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(bg)),
            border: iced::Border {
                color: border,
                width: 1.0,
                radius: iced::border::Radius::from(8.0),
            },
            ..Default::default()
        })
        .into();

    let btn = iced::widget::button(row_content)
        .on_press(Message::SelectStudent(s.id))
        .padding(0)
        .style(|_t, _status| iced::widget::button::Style {
            background: None,
            border: iced::Border::default(),
            text_color: iced::Color::WHITE,
            shadow: iced::Shadow::default(),
            snap: false,
        })
        .width(Length::Fill);

    btn.into()
}

fn risk_pill_for(level: crate::models::RiskLevel) -> Element<Message> {
    match level {
        crate::models::RiskLevel::Low => badge::emerald::<Message>("低风险"),
        crate::models::RiskLevel::Medium => badge::amber::<Message>("中风险"),
        crate::models::RiskLevel::High => badge::red::<Message>("高风险"),
        crate::models::RiskLevel::Critical => badge::pink::<Message>("重点关注"),
    }
}

fn icon_button(name: IconName, on_press: Message, theme: &crate::theme::Theme) -> Element<Message> {
    let icon_el: Element<Message> = container(
        iced::widget::Svg::new(icon(name))
            .width(Length::Fixed(13.0))
            .height(Length::Fixed(13.0)),
    )
    .width(28.0)
    .height(28.0)
    .center_x(28.0)
    .center_y(28.0)
    .style(move |_, status| {
        let bg = if matches!(status, iced::widget::button::Status::Hovered) {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.06)
        } else {
            iced::Color::from_rgba(1.0, 1.0, 1.0, 0.025)
        };
        iced::widget::container::Style {
            background: Some(iced::Background::Color(bg)),
            border: iced::Border {
                color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
                width: 1.0,
                radius: iced::border::Radius::from(7.0),
            },
            ..Default::default()
        }
    })
    .into();

    iced::widget::button(icon_el)
        .on_press(on_press)
        .padding(0)
        .style(|_t, _status| iced::widget::button::Style {
            background: None,
            border: iced::Border::default(),
            text_color: iced::Color::WHITE,
            shadow: iced::Shadow::default(),
            snap: false,
        })
        .into()
}

fn pagination_footer(app: &App, shown: usize, total: usize) -> Element<Message> {
    let theme = &app.theme;
    let page_buttons: Vec<Element<Message>> = ["1", "2", "3", "…", "161"]
        .iter()
        .enumerate()
        .map(|(i, label)| {
            let is_current = i == 0;
            let lbl = label.to_string();
            let bg = if is_current {
                theme.accent
            } else {
                iced::Color::TRANSPARENT
            };
            let fg = if is_current {
                iced::Color::WHITE
            } else {
                iced::Color::from_rgb(0.71, 0.74, 0.83)
            };
            iced::widget::button(
                text(lbl)
                    .font(CJK_FONT)
                    .size(11)
                    .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(fg) }),
            )
            .style(move |_, _| iced::widget::button::Style {
                background: Some(iced::Background::Color(bg)),
                border: iced::Border {
                    color: if is_current {
                        theme.accent
                    } else {
                        iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08)
                    },
                    width: 1.0,
                    radius: iced::border::Radius::from(6.0),
                },
                text_color: fg,
                shadow: iced::Shadow::default(),
                snap: false,
            })
            .padding(iced::Padding {
                top: 5.0,
                bottom: 5.0,
                left: 10.0,
                right: 10.0,
            })
            .into()
        })
        .collect();

    let _ = shown;
    row![
        text(format!("共 {} 条 · 当前第 1 页", total))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        row(page_buttons).spacing(6).into(),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 14.0,
        bottom: 14.0,
        left: 20.0,
        right: 20.0,
    })
}

// ── in-page student panel (replaces pii_dialog modal) ──────────────

fn student_panel(
    app: &App,
    student: &crate::models::Student,
    _mode: LayoutMode,
) -> Element<Message> {
    let theme = &app.theme;
    let risk_color = theme.risk_color(student.risk_level);

    // Avatar
    let initials: String = student
        .name
        .chars()
        .next()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "?".to_string());
    let avatar: Element<Message> = container(
        text(initials)
            .size(20)
            .font(iced::Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
    )
    .width(52.0)
    .height(52.0)
    .center_x(52.0)
    .center_y(52.0)
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        background: Some(iced::Background::Gradient(iced::Gradient::Linear(
            iced::gradient::Linear::new(iced::Degrees(135.0))
                .add_stop(0.0, risk_color)
                .add_stop(1.0, iced::Color::from_rgb(0.42, 0.36, 0.91)),
        ))),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.15),
            width: 1.0,
            radius: iced::border::Radius::from(14.0),
        },
        ..Default::default()
    })
    .into();

    let risk_pill: Element<Message> = risk_pill_for(student.risk_level);

    // Panel head
    let panel_head: Element<Message> = row![
        avatar,
        Space::new().width(14.0).height(0.0).into(),
        column![
            row![
                text(student.name.clone())
                    .font(iced::Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(18)
                    .style(move |_: &iced::Theme| style::text_primary(theme)),
                Space::new().width(10.0).height(0.0).into(),
                risk_pill,
            ]
            .align_y(Alignment::Center),
            Space::new().width(0.0).height(4.0).into(),
            text(format!(
                "{} · {} · 出生 {}",
                student.grade,
                student.class,
                student
                    .birth_date
                    .map(|d| d.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "—".into())
            ))
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(0),
        Space::new().width(Length::Fill).height(0.0).into(),
        row![export_button(theme, IconName::Download, "导出档案")],
    ]
    .spacing(0)
    .align_y(Alignment::Center)
    .padding(iced::Padding {
        top: 22.0,
        bottom: 18.0,
        left: 22.0,
        right: 22.0,
    });

    // Tabs
    let tabs: Element<Message> = build_tabs(app);

    // Tab content
    let content: Element<Message> = match app.ui_state.student_detail_tab {
        0 => overview_tab(app, student),
        1 => academic_tab(app, student),
        2 => behavior_tab(app, student),
        3 => contact_tab(app, student),
        _ => privacy_tab(app, student),
    };

    let mut panel_inner: Vec<Element<Message>> = vec![panel_head, tabs, content];
    panel_inner.push(Space::new().width(0.0).height(20.0).into());

    let panel: Element<Message> = container(column(panel_inner).spacing(0))
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(
                1.0, 1.0, 1.0, 0.025,
            ))),
            border: iced::Border {
                color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
                width: 1.0,
                radius: iced::border::Radius::from(16.0),
            },
            ..Default::default()
        })
        .into();

    scrollable(container(panel).width(Length::Fill).padding(Padding::from(0.0)))
        .style(move |_, _| style::scrollable(theme))
        .into()
}

fn build_tabs(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let current = app.ui_state.student_detail_tab;
    let tab_labels = ["概览", "学业", "行为", "联系", "隐私"];
    let mut children: Vec<Element<Message>> = Vec::new();
    for (i, label) in tab_labels.iter().enumerate() {
        let active = current == i;
        let bg = if active {
            iced::Color::from_rgba(0.66, 0.33, 0.97, 0.16)
        } else {
            iced::Color::TRANSPARENT
        };
        let fg = if active {
            iced::Color::WHITE
        } else {
            iced::Color::from_rgb(0.61, 0.64, 0.78)
        };
        let label = label.to_string();
        let btn: Element<Message> = iced::widget::button(
            container(
                text(label)
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(fg) }),
            )
            .padding(iced::Padding {
                top: 8.0,
                bottom: 8.0,
                left: 16.0,
                right: 16.0,
            })
            .style(move |_: &iced::Theme| iced::widget::container::Style {
                background: Some(iced::Background::Color(bg)),
                border: iced::Border {
                    color: if active {
                        iced::Color::from_rgba(0.66, 0.33, 0.97, 0.40)
                    } else {
                        iced::Color::TRANSPARENT
                    },
                    width: 1.0,
                    radius: iced::border::Radius::from(8.0),
                },
                ..Default::default()
            }),
        )
        .on_press(Message::StudentDetailTab(i))
        .padding(0)
        .style(|_t, _| iced::widget::button::Style {
            background: None,
            border: iced::Border::default(),
            text_color: iced::Color::WHITE,
            shadow: iced::Shadow::default(),
            snap: false,
        })
        .into();
        children.push(btn);
    }

    let tabs_inner: Element<Message> = row(children)
        .spacing(4)
        .padding(iced::Padding {
            top: 0.0,
            bottom: 14.0,
            left: 22.0,
            right: 22.0,
        })
        .into();

    container(tabs_inner)
        .width(Length::Fill)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(
                0.0, 0.0, 0.0, 0.15,
            ))),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(0.0),
            },
            ..Default::default()
        })
        .into()
}

fn overview_tab(app: &App, student: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let mut inner: Vec<Element<Message>> = Vec::new();

    // KPI row (3 cards inline)
    let gpa = student.gpa.unwrap_or(0.0);
    let score = gpa * 25.0;
    let class_rank_pct = 100 - (score as i32).max(0).min(100);
    let kpi_score: Element<Message> = mini_kpi(
        theme,
        "综合分",
        format!("{:.0}", score),
        format!("班级前 {}%", class_rank_pct),
        IconName::TrendingUp,
        (168, 85, 247),
    );
    let kpi_risk: Element<Message> = mini_kpi(
        theme,
        "风险指数",
        format!(
            "{}",
            match student.risk_level {
                crate::models::RiskLevel::Low => 20,
                crate::models::RiskLevel::Medium => 40,
                crate::models::RiskLevel::High => 65,
                crate::models::RiskLevel::Critical => 85,
            }
        ),
        "最近 30 天".to_string(),
        IconName::AlertTriangle,
        (239, 68, 68),
    );
    let kpi_award: Element<Message> = mini_kpi(
        theme,
        "本月奖惩",
        "+3".to_string(),
        "0 次关注".to_string(),
        IconName::Check,
        (16, 185, 129),
    );

    inner.push(
        row![kpi_score, kpi_risk, kpi_award]
            .spacing(12)
            .padding(iced::Padding {
                top: 18.0,
                bottom: 8.0,
                left: 22.0,
                right: 22.0,
            })
            .into(),
    );

    // row-2: basic info + recent activity
    let info_card = basic_info_card(app, student);
    let activity_card = recent_activity_card(app, student);

    inner.push(
        row![info_card, activity_card]
            .spacing(12)
            .padding(iced::Padding {
                top: 12.0,
                bottom: 12.0,
                left: 22.0,
                right: 22.0,
            })
            .into(),
    );

    column(inner).spacing(0).into()
}

fn mini_kpi(
    theme: &crate::theme::Theme,
    label: &str,
    value: String,
    sub: String,
    ic: IconName,
    accent: (u8, u8, u8),
) -> Element<Message> {
    let (r, g, b) = accent;
    let card_bg = iced::Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 0.06);
    let icon_bg = iced::Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 0.18);
    let icon_border = iced::Color::from_rgba(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0, 0.30);
    let accent_c = iced::Color::from_rgb(r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);

    let icon_box: Element<Message> = container(
        iced::widget::Svg::new(icon(ic))
            .width(Length::Fixed(18.0))
            .height(Length::Fixed(18.0)),
    )
    .padding(10.0)
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Color(icon_bg)),
        border: iced::Border {
            color: icon_border,
            width: 1.0,
            radius: iced::border::Radius::from(10.0),
        },
        text_color: Some(accent_c),
        ..Default::default()
    })
    .into();

    container(
        column![
            icon_box,
            Space::new().width(0.0).height(8.0).into(),
            text(label)
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text(value)
                .font(iced::Font {
                    family: CJK_FONT.family,
                    weight: iced::font::Weight::Bold,
                    ..Default::default()
                })
                .size(24)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(accent_c),
                }),
            text(sub)
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
        ]
        .spacing(4)
        .align_x(Alignment::Start)
        .width(Length::Fill),
    )
    .padding(18.0)
    .width(Length::Fill)
    .height(Length::Fixed(150.0))
    .style(move |_| iced::widget::container::Style {
        background: Some(iced::Background::Color(card_bg)),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.08),
            width: 1.0,
            radius: iced::border::Radius::from(16.0),
        },
        shadow: iced::Shadow {
            color: iced::Color::from_rgba(0.0, 0.0, 0.0, 0.30),
            offset: iced::Vector::new(0.0, 8.0),
            blur_radius: 24.0,
        },
        ..Default::default()
    })
    .into()
}

fn basic_info_card(app: &App, student: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let mut card_inner: Vec<Element<Message>> = Vec::new();
    card_inner.push(
        section_header::<Message>("基本信息", Some(IconName::Users))
            .align_y(iced::Alignment::Center)
            .into(),
    );
    card_inner.push(Space::new().width(0.0).height(14.0).into());

    let fields: Vec<(&str, String)> = vec![
        ("学号", student.id_number.clone().unwrap_or_else(|| "—".into())),
        (
            "出生",
            student
                .birth_date
                .map(|d| d.format("%Y-%m-%d").to_string())
                .unwrap_or_else(|| "—".into()),
        ),
        ("性别", student.gender.clone().unwrap_or_else(|| "—".into())),
        ("年级", student.grade.clone()),
        (
            "家庭",
            student
                .home_address
                .clone()
                .unwrap_or_else(|| "—".into()),
        ),
    ];

    let mut pairs: Vec<Element<Message>> = Vec::new();
    for (label, value) in &fields {
        pairs.push(kv_row(theme, label, value));
    }
    if !student.tags.is_empty() {
        let tag_pills: Vec<Element<Message>> =
            student.tags.iter().map(|t| badge::zinc::<Message>(t)).collect();
        let tag_value: Element<Message> = row(tag_pills).spacing(4).wrap().into();
        pairs.push(
            row![
                text("标签")
                    .font(CJK_FONT)
                    .size(11)
                    .style(move |_: &iced::Theme| style::text_faint(theme))
                    .width(Length::Fixed(60.0)),
                tag_value,
            ]
            .spacing(8)
            .align_y(Alignment::Center)
            .into(),
        );
    }

    card_inner.push(column(pairs).spacing(8).width(Length::Fill).into());

    let _ = app;
    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}

fn kv_row(theme: &crate::theme::Theme, label: &str, value: &str) -> Element<Message> {
    row![
        text(label)
            .font(CJK_FONT)
            .size(11)
            .style(move |_: &iced::Theme| style::text_faint(theme))
            .width(Length::Fixed(60.0)),
        text(value.to_string())
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_dim(theme)),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .into()
}

fn recent_activity_card(app: &App, student: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let mut card_inner: Vec<Element<Message>> = Vec::new();
    card_inner.push(
        section_header::<Message>("最近活动", Some(IconName::Activity))
            .align_y(iced::Alignment::Center)
            .into(),
    );
    card_inner.push(Space::new().width(0.0).height(10.0).into());

    // Use a deterministic mock timeline so the panel is non-empty for any student.
    let timeline: Vec<(&str, &str, &str)> = vec![
        ("教务主任", "06-12 14:08", "完成月度评估，生成报告"),
        ("心理辅导", "06-10 10:24", "1 对 1 沟通 30 分钟，无异常"),
        ("安全监督", "06-08 09:15", "本周课堂表现稳定"),
    ];

    let mut items: Vec<Element<Message>> = Vec::new();
    for (i, (agent, time, text_s)) in timeline.iter().enumerate() {
        let dot: Element<Message> = container(Space::new().width(0.0).height(0.0))
            .width(8.0)
            .height(8.0)
            .style(|_| iced::widget::container::Style {
                background: Some(iced::Background::Color(iced::Color::from_rgba(
                    0.66, 0.33, 0.97, 1.0,
                ))),
                border: iced::Border::default(),
                ..Default::default()
            })
            .into();
        let body: Element<Message> = column![
            row![
                text(agent.to_string())
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(iced::Color::WHITE),
                    }),
                Space::new().width(Length::Fill).height(0.0).into(),
                text(time.to_string())
                    .font(CJK_FONT)
                    .size(10)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .align_y(Alignment::Center)
            .into(),
            text(text_s.to_string())
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(2)
        .into();

        items.push(
            row![dot, Space::new().width(10.0).height(0.0).into(), body]
                .align_y(Alignment::Start)
                .into(),
        );
        if i + 1 < timeline.len() {
            items.push(Space::new().width(0.0).height(8.0).into());
        }
    }
    card_inner.push(column(items).spacing(0).into());
    widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill))
}

fn academic_tab(app: &App, student: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let mut card_inner: Vec<Element<Message>> = Vec::new();
    card_inner.push(
        section_header::<Message>("最近一次月考成绩", Some(IconName::TrendingUp))
            .align_y(iced::Alignment::Center)
            .into(),
    );
    card_inner.push(Space::new().width(0.0).height(14.0).into());

    let grades = app
        .ui_state
        .grades
        .get(&student.id)
        .cloned()
        .unwrap_or_default();
    if grades.is_empty() {
        card_inner.push(
            container(
                text("暂无成绩记录")
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            )
            .padding(20.0)
            .width(Length::Fill)
            .align_x(Alignment::Center)
            .into(),
        );
    } else {
        for g in grades.iter().take(20) {
            let pct = if g.max_score > 0.0 {
                (g.score / g.max_score) * 100.0
            } else {
                0.0
            };
            let value_text = format!("{:.0}/{:.0}", g.score, g.max_score);
            let value_color = if pct >= 85.0 {
                iced::Color::from_rgb(110.0 / 255.0, 231.0 / 255.0, 183.0 / 255.0)
            } else if pct >= 70.0 {
                iced::Color::from_rgb(252.0 / 255.0, 211.0 / 255.0, 77.0 / 255.0)
            } else {
                iced::Color::from_rgb(252.0 / 255.0, 165.0 / 255.0, 165.0 / 255.0)
            };
            let c_from = iced::Color::from_rgb(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0);
            let c_to = iced::Color::from_rgb(6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0);
            card_inner.push(score_row::<Message>(
                &g.subject,
                pct,
                &value_text,
                value_color,
                c_from,
                c_to,
            ));
            card_inner.push(Space::new().width(0.0).height(8.0).into());
        }
    }

    let card: Element<Message> =
        widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill));
    container(card)
        .padding(iced::Padding {
            top: 18.0,
            bottom: 0.0,
            left: 22.0,
            right: 22.0,
        })
        .width(Length::Fill)
        .into()
}

fn behavior_tab(app: &App, student: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let mut card_inner: Vec<Element<Message>> = Vec::new();
    card_inner.push(
        section_header::<Message>("行为记录", Some(IconName::AlertTriangle))
            .align_y(iced::Alignment::Center)
            .into(),
    );
    card_inner.push(Space::new().width(0.0).height(14.0).into());

    // Placeholder behavior records (per the preview's structure, but with
    // a fixed sample set since runtime data isn't available here).
    let records: Vec<(&str, &str, &str, &str)> = vec![
        ("06-12", "表扬", "praise_001", "数学竞赛获奖"),
        ("06-08", "日常", "attend_002", "按时到校"),
        ("05-30", "关注", "late_001", "迟到一次"),
    ];

    for (date, kind, code, desc) in &records {
        let pill: Element<Message> = match *kind {
            "表扬" => badge::emerald::<Message>(kind),
            "关注" => badge::amber::<Message>(kind),
            "违规" => badge::red::<Message>(kind),
            "严重" => badge::pink::<Message>(kind),
            _ => badge::zinc::<Message>(kind),
        };
        let row_item: Element<Message> = row![
            text(date.to_string())
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme))
                .width(Length::Fixed(60.0)),
            container(pill).width(Length::Fixed(60.0)).into(),
            badge::zinc::<Message>(code),
            Space::new().width(Length::Fill).height(0.0).into(),
            text(desc.to_string())
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        ]
        .spacing(12)
        .align_y(Alignment::Center)
        .padding(iced::Padding {
            top: 12.0,
            bottom: 12.0,
            left: 0.0,
            right: 0.0,
        });
        card_inner.push(row_item);
        card_inner.push(
            container(Space::new().width(0.0).height(1.0))
                .width(Length::Fill)
                .style(|_| iced::widget::container::Style {
                    background: Some(iced::Background::Color(iced::Color::from_rgba(
                        1.0, 1.0, 1.0, 0.05,
                    ))),
                    border: iced::Border::default(),
                    ..Default::default()
                })
                .into(),
        );
    }

    let _ = student;
    let card: Element<Message> =
        widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill));
    container(card)
        .padding(iced::Padding {
            top: 18.0,
            bottom: 0.0,
            left: 22.0,
            right: 22.0,
        })
        .width(Length::Fill)
        .into()
}

fn contact_tab(app: &App, student: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let mut card_inner: Vec<Element<Message>> = Vec::new();

    let guardian_name = student.guardian_name.clone().unwrap_or_else(|| "—".into());
    let guardian_initial: String = guardian_name
        .chars()
        .next()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "?".to_string());
    let avatar: Element<Message> = container(
        text(guardian_initial)
            .size(18)
            .font(iced::Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
    )
    .width(48.0)
    .height(48.0)
    .center_x(48.0)
    .center_y(48.0)
    .style(|_| iced::widget::container::Style {
        background: Some(iced::Background::Gradient(iced::Gradient::Linear(
            iced::gradient::Linear::new(iced::Degrees(135.0))
                .add_stop(0.0, iced::Color::from_rgb(236.0 / 255.0, 72.0 / 255.0, 153.0 / 255.0))
                .add_stop(1.0, iced::Color::from_rgb(245.0 / 255.0, 158.0 / 255.0, 11.0 / 255.0)),
        ))),
        border: iced::Border {
            color: iced::Color::from_rgba(1.0, 1.0, 1.0, 0.15),
            width: 1.0,
            radius: iced::border::Radius::from(12.0),
        },
        ..Default::default()
    })
    .into();

    card_inner.push(
        row![
            avatar,
            Space::new().width(14.0).height(0.0).into(),
            column![
                text(guardian_name)
                    .font(iced::Font {
                        family: CJK_FONT.family,
                        weight: iced::font::Weight::Bold,
                        ..Default::default()
                    })
                    .size(15)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(iced::Color::WHITE),
                    }),
                text(format!(
                    "{} · {}",
                    student.guardian_relation.clone().unwrap_or_else(|| "监护人".into()),
                    "未填写"
                ))
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(2),
        ]
        .align_y(Alignment::Center)
        .into(),
    );
    card_inner.push(Space::new().width(0.0).height(16.0).into());

    let fields: Vec<(&str, String)> = vec![
        (
            "电话",
            student
                .guardian_contact
                .clone()
                .unwrap_or_else(|| "—".into()),
        ),
        (
            "关系",
            student
                .guardian_relation
                .clone()
                .unwrap_or_else(|| "—".into()),
        ),
    ];
    for (label, value) in &fields {
        card_inner.push(kv_row(theme, label, value));
    }

    card_inner.push(Space::new().width(0.0).height(16.0).into());
    card_inner.push(
        row![
            contact_button(theme, IconName::Message, "发送消息", true),
            contact_button(theme, IconName::Phone, "电话", false),
            contact_button(theme, IconName::History, "沟通记录", false),
        ]
        .spacing(8)
        .into(),
    );

    let card: Element<Message> =
        widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill));
    let _ = student;
    container(card)
        .padding(iced::Padding {
            top: 20.0,
            bottom: 0.0,
            left: 22.0,
            right: 22.0,
        })
        .width(Length::Fill)
        .into()
}

fn contact_button(
    theme: &crate::theme::Theme,
    ic: IconName,
    label: &str,
    primary: bool,
) -> Element<Message> {
    let label = label.to_string();
    let content: Element<Message> = row![
        iced::widget::Svg::new(icon(ic))
            .width(Length::Fixed(13.0))
            .height(Length::Fixed(13.0)),
        text(label)
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(if primary {
                    iced::Color::WHITE
                } else {
                    theme.text
                }),
            }),
    ]
    .spacing(6)
    .align_y(Alignment::Center)
    .into();

    if primary {
        iced::widget::button(
            container(content)
                .width(Length::Fill)
                .padding(iced::Padding {
                    top: 8.0,
                    bottom: 8.0,
                    left: 12.0,
                    right: 12.0,
                })
                .align_x(Alignment::Center),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding(0)
        .width(Length::Fill)
        .into()
    } else {
        iced::widget::button(
            container(content)
                .width(Length::Fill)
                .padding(iced::Padding {
                    top: 8.0,
                    bottom: 8.0,
                    left: 12.0,
                    right: 12.0,
                })
                .align_x(Alignment::Center),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding(0)
        .width(Length::Fill)
        .into()
    }
}

fn privacy_tab(app: &App, student: &crate::models::Student) -> Element<Message> {
    let theme = &app.theme;
    let mut card_inner: Vec<Element<Message>> = Vec::new();

    // PII pseudonymization card
    let pi_pseudonym = format!("S_{:03}", (student.id.as_u128() % 1000) as u32);
    let pseudonym_card: Element<Message> = column![
        section_header::<Message>("PII 假名化", Some(IconName::Shield))
            .align_y(iced::Alignment::Center)
            .into(),
        Space::new().width(0.0).height(12.0).into(),
        text(format!(
            "显示给 AI 的是 {} 假名，AI 永远看不到明文姓名。",
            pi_pseudonym
        ))
        .font(CJK_FONT)
        .size(12)
        .style(move |_: &iced::Theme| style::text_dim(theme))
        .into(),
        Space::new().width(0.0).height(14.0).into(),
        container(
            column![
                text("AI 看到的提示")
                    .font(CJK_FONT)
                    .size(10)
                    .style(move |_: &iced::Theme| style::text_faint(theme))
                    .into(),
                Space::new().width(0.0).height(4.0).into(),
                text(format!(
                    "学生 {} 最近成绩有所下降，建议关注。",
                    pi_pseudonym
                ))
                .font(iced::Font {
                    family: CJK_FONT.family,
                    weight: iced::font::Weight::Bold,
                    ..Default::default()
                })
                .size(12)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(110.0 / 255.0, 231.0 / 255.0, 183.0 / 255.0)),
                }),
            ]
            .spacing(0)
        )
        .padding(iced::Padding {
            top: 10.0,
            bottom: 10.0,
            left: 12.0,
            right: 12.0,
        })
        .width(Length::Fill)
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(
                0.0, 0.0, 0.0, 0.25,
            ))),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(8.0),
            },
            ..Default::default()
        })
        .into(),
    ]
    .padding(iced::Padding {
        top: 18.0,
        bottom: 18.0,
        left: 20.0,
        right: 20.0,
    })
    .width(Length::Fill)
    .style(|_| iced::widget::container::Style {
        background: Some(iced::Background::Color(iced::Color::from_rgba(
            1.0, 1.0, 1.0, 0.025,
        ))),
        border: iced::Border {
            color: iced::Color::from_rgba(16.0 / 255.0, 185.0 / 255.0, 129.0 / 255.0, 1.0),
            width: 0.0,
            radius: iced::border::Radius::from(12.0),
        },
        ..Default::default()
    })
    .into();

    // Targeted send filter card
    let target_card: Element<Message> = column![
        section_header::<Message>("定向发送过滤", Some(IconName::Filter))
            .align_y(iced::Alignment::Center)
            .into(),
        Space::new().width(0.0).height(12.0).into(),
        text("给该家长发消息时，其他学生真实姓名自动替换为「其他同学」。")
            .font(CJK_FONT)
            .size(12)
            .style(move |_: &iced::Theme| style::text_dim(theme))
            .into(),
        Space::new().width(0.0).height(14.0).into(),
        container(
            column![
                text("即将发送")
                    .font(CJK_FONT)
                    .size(10)
                    .style(move |_: &iced::Theme| style::text_faint(theme))
                    .into(),
                Space::new().width(0.0).height(4.0).into(),
                text(format!(
                    "{} 您好，您孩子 {} 最近表现稳定，与其他同学相处融洽。",
                    student.guardian_name.clone().unwrap_or_else(|| "家长".into()),
                    student.name,
                ))
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(0.82, 0.84, 0.91)),
                }),
            ]
            .spacing(0)
        )
        .padding(iced::Padding {
            top: 10.0,
            bottom: 10.0,
            left: 12.0,
            right: 12.0,
        })
        .width(Length::Fill)
        .style(|_| iced::widget::container::Style {
            background: Some(iced::Background::Color(iced::Color::from_rgba(
                0.0, 0.0, 0.0, 0.25,
            ))),
            border: iced::Border {
                color: iced::Color::TRANSPARENT,
                width: 0.0,
                radius: iced::border::Radius::from(8.0),
            },
            ..Default::default()
        })
        .into(),
    ]
    .padding(iced::Padding {
        top: 18.0,
        bottom: 18.0,
        left: 20.0,
        right: 20.0,
    })
    .width(Length::Fill)
    .style(|_| iced::widget::container::Style {
        background: Some(iced::Background::Color(iced::Color::from_rgba(
            1.0, 1.0, 1.0, 0.025,
        ))),
        border: iced::Border {
            color: iced::Color::from_rgba(6.0 / 255.0, 182.0 / 255.0, 212.0 / 255.0, 1.0),
            width: 0.0,
            radius: iced::border::Radius::from(12.0),
        },
        ..Default::default()
    })
    .into();

    card_inner.push(row![pseudonym_card, target_card].spacing(12).into());

    let card: Element<Message> =
        widgets::card(theme, column(card_inner).spacing(0).width(Length::Fill));
    container(card)
        .padding(iced::Padding {
            top: 18.0,
            bottom: 0.0,
            left: 22.0,
            right: 22.0,
        })
        .width(Length::Fill)
        .into()
}

// ── small UI helpers ───────────────────────────────────────────────

fn export_button(theme: &crate::theme::Theme, ic: IconName, label: &str) -> Element<Message> {
    let label = label.to_string();
    iced::widget::button(
        row![
            iced::widget::Svg::new(icon(ic))
                .width(Length::Fixed(13.0))
                .height(Length::Fixed(13.0)),
            text(label)
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::from_rgb(0.82, 0.84, 0.91)),
                }),
        ]
        .spacing(6)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::secondary_button(theme, status))
    .padding(iced::Padding {
        top: 6.0,
        bottom: 6.0,
        left: 10.0,
        right: 10.0,
    })
    .into()
}

// ── student edit form (full-page, replaces pii_dialog modal) ───────

fn student_edit_form(app: &App, student: crate::models::Student) -> Element<Message> {
    let theme = &app.theme;

    let mut items: Vec<Element<Message>> = Vec::new();

    items.push(
        text(if student.name.is_empty() { "新增学生" } else { "编辑学生" })
            .font(Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(20)
            .style(move |_: &iced::Theme| style::text_primary(theme))
            .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    let s = student.clone();

    // Helper macro for labeled text inputs
    macro_rules! field {
        ($label:expr, $value:expr, $field:ident) => {{
            let val = $value;
            let label = $label;
            column![
                text(label)
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
                iced::widget::text_input(&format!("输入{label}"), &val)
                    .on_input(|v| Message::StudentFieldChanged(crate::app::StudentField::$field(v)))
                    .font(CJK_FONT)
                    .size(13)
                    .padding([8.0, 10.0])
                    .style(move |_, status| style::text_input_style(theme, status))
                    .width(Length::Fill),
            ]
            .spacing(4)
            .into()
        }};
    }

    items.push(field!("姓名", s.name, Name));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    items.push(field!("年级", s.grade, Grade));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    items.push(field!("班级", s.class, Class));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    items.push(field!("学号", s.id_number.unwrap_or_default(), IdNumber));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    items.push(field!("监护人", s.guardian_name.unwrap_or_default(), GuardianName));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    items.push(field!("联系方式", s.guardian_contact.unwrap_or_default(), GuardianContact));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    items.push(field!("地址", s.home_address.unwrap_or_default(), HomeAddress));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // GPA
    items.push(
        column![
            text("GPA")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            iced::widget::text_input("输入GPA", &s.gpa.map(|g| format!("{:.2}", g)).unwrap_or_default())
                .on_input(|v| {
                    let gpa = v.parse::<f32>().unwrap_or(0.0);
                    Message::StudentFieldChanged(crate::app::StudentField::Gpa(gpa))
                })
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(10.0)).into());

    // Risk level
    let risk_options = vec![
        crate::models::RiskLevel::Low,
        crate::models::RiskLevel::Medium,
        crate::models::RiskLevel::High,
        crate::models::RiskLevel::Critical,
    ];
    let risk_labels: Vec<String> = risk_options.iter().map(|r| r.label().to_string()).collect();
    let current_risk_label = s.risk_level.label().to_string();

    items.push(
        column![
            text("风险等级")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            pick_list(
                risk_labels,
                Some(current_risk_label),
                move |label| {
                    let risk = risk_options.iter().find(|r| r.label() == label).cloned().unwrap_or(crate::models::RiskLevel::Low);
                    Message::StudentFieldChanged(crate::app::StudentField::RiskLevel(risk))
                },
            )
            .font(CJK_FONT)
            .text_size(13)
            .padding([8.0, 10.0])
            .style(move |_, status| style::pick_list_style(theme, status))
            .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    // Action buttons
    let actions = row![
        iced::widget::button(
            text("保存")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::SaveStudent),
        iced::widget::button(
            text("取消")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::EditStudent(None)),
    ]
    .spacing(12);
    items.push(actions.into());

    let content = column(items).spacing(0).width(Length::Fill);
    container(
        scrollable(content).style(move |_, _| style::scrollable(theme)),
    )
    .style(move |_: &iced::Theme| style::card_flat(theme))
    .padding(Padding::from(20.0))
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}
