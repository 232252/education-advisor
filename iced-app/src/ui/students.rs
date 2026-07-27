//! Students page — list + detail + edit.

use iced::widget::{column, container, row, scrollable, text, pick_list, Space};
use iced::{Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let header = widgets::page_header(theme, "学生档案", "管理学生信息、成绩与风险评估");

    let list = list_panel(app);

    let detail = if let Some(editing) = app.ui_state.editing_student.clone() {
        student_edit_form(app, editing)
    } else if let Some(id) = app.selected_student {
        let students = app.students.read();
        if let Some(student) = students.iter().find(|s| s.id == id).cloned() {
            detail_panel(app, student)
        } else {
            empty_detail(app)
        }
    } else {
        empty_detail(app)
    };

    let body = row![list, detail].spacing(12).height(Length::Fill);

    column![header, Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)), body]
        .spacing(0)
        .height(Length::Fill)
        .width(Length::Fill)
        .into()
}

fn list_panel(app: &App) -> Element<Message> {
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
        .collect();

    let mut items: Vec<Element<Message>> = Vec::new();
    items.push(widgets::section_title(theme, "学生列表").into());

    // Search + add
    let search = iced::widget::text_input("搜索学生…", &app.ui_state.student_filter)
        .on_input(Message::StudentFilterChanged)
        .font(CJK_FONT)
        .size(13)
        .padding([8.0, 10.0])
        .style(move |_, status| style::text_input_style(theme, status))
        .width(Length::Fill);
    items.push(search.into());
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    let add_btn = iced::widget::button(
        text("✚ 新增学生")
            .font(CJK_FONT)
            .size(13)
            .style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
    )
    .style(move |_, status| style::primary_button(theme, status))
    .padding([8.0, 12.0])
    .width(Length::Fill)
    .on_press(Message::EditStudent(Some(crate::models::Student {
        id: uuid::Uuid::new_v4(),
        name: String::new(),
        gender: None,
        grade: String::new(),
        class: String::new(),
        id_number: None,
        birth_date: None,
        enrollment_date: None,
        guardian_name: None,
        guardian_contact: None,
        guardian_relation: None,
        home_address: None,
        emergency_contact: None,
        risk_level: crate::models::RiskLevel::Low,
        gpa: None,
        tags: Vec::new(),
        notes: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        notes_modified_at: None,
    })));
    items.push(add_btn.into());
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());

    if filtered.is_empty() {
        items.push(
            widgets::empty_state(theme, "☺", "没有匹配的学生")
                .into(),
        );
    } else {
        for s in filtered.iter().take(50) {
            let active = app.selected_student == Some(s.id);
            let risk_color = theme.risk_color(s.risk_level);

            let item = row![
                text("●")
                    .size(10)
                    .style(move |_: &iced::Theme| iced::widget::text::Style {
                        color: Some(risk_color),
                    }),
                column![
                    text(s.name.clone())
                        .font(CJK_FONT)
                        .size(13)
                        .style(move |_: &iced::Theme| iced::widget::text::Style {
                            color: Some(if active { theme.accent_hover } else { theme.text }),
                        }),
                    text(format!("{} · {}", s.grade, s.class))
                        .font(CJK_FONT)
                        .size(10)
                        .style(move |_: &iced::Theme| style::text_faint(theme)),
                ]
                .spacing(2),
            ]
            .spacing(8)
            .align_y(iced::Alignment::Center);

            let btn = iced::widget::button(item)
                .style(move |_, status| style::nav_button(theme, active, status))
                .padding([8.0, 10.0])
                .width(Length::Fill)
                .on_press(Message::SelectStudent(s.id));
            items.push(btn.into());
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)).into());
        }
    }

    let content = column(items).spacing(0).width(Length::Fill);
    container(
        scrollable(content).style(move |_, _| style::scrollable(theme)),
    )
    .style(move |_: &iced::Theme| style::card_flat(theme))
    .padding(Padding::from(12.0))
    .width(Length::Fixed(300.0))
    .height(Length::Fill)
    .into()
}

fn empty_detail(app: &App) -> Element<Message> {
    let theme = &app.theme;
    container(widgets::empty_state(
        theme,
        "☺",
        "从左侧选择一名学生查看详情",
    ))
    .width(Length::Fill)
    .height(Length::Fill)
    .center_x(Length::Fill)
    .into()
}

fn detail_panel<'a>(app: &'a App, student: crate::models::Student) -> Element<'a, Message> {
    let theme = &app.theme;
    let risk_color = theme.risk_color(student.risk_level);

    let mut items: Vec<Element<Message>> = Vec::new();

    // Name + risk badge
    let name_row = row![
        text(student.name.clone())
            .font(iced::Font {
                family: CJK_FONT.family,
                weight: iced::font::Weight::Bold,
                ..Default::default()
            })
            .size(24)
            .style(move |_: &iced::Theme| style::text_primary(theme)),
        iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
        widgets::badge(theme, risk_color, student.risk_level.label().to_string()),
    ]
    .align_y(iced::Alignment::Center)
    .width(Length::Fill);
    items.push(name_row.into());
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)).into());

    // Subtitle
    items.push(
        text(format!(
            "{} · {} · GPA {}",
            student.grade,
            student.class,
            student.gpa.map(|g| format!("{:.2}", g)).unwrap_or_else(|| "—".into())
        ))
        .font(CJK_FONT)
        .size(13)
        .style(move |_: &iced::Theme| style::text_faint(theme))
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    // Info grid
    let info_fields: Vec<(&str, String)> = vec![
        ("性别", student.gender.clone().unwrap_or_else(|| "—".into())),
        ("学号", student.id_number.clone().unwrap_or_else(|| "—".into())),
        ("出生日期", student.birth_date.map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_else(|| "—".into())),
        ("入学日期", student.enrollment_date.map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_else(|| "—".into())),
        ("监护人", student.guardian_name.clone().unwrap_or_else(|| "—".into())),
        ("关系", student.guardian_relation.clone().unwrap_or_else(|| "—".into())),
        ("联系方式", student.guardian_contact.clone().unwrap_or_else(|| "—".into())),
        ("地址", student.home_address.clone().unwrap_or_else(|| "—".into())),
        ("紧急联系", student.emergency_contact.clone().unwrap_or_else(|| "—".into())),
    ];

    let mut grid_items: Vec<Element<Message>> = Vec::new();
    for (label, value) in &info_fields {
        let field = column![
            text(*label)
                .font(CJK_FONT)
                .size(11)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text(value.clone())
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_primary(theme)),
        ]
        .spacing(2);
        grid_items.push(
            container(field)
                .style(move |_: &iced::Theme| style::card_flat(theme))
                .padding(Padding::from(12.0))
                .width(Length::Fill)
                .into(),
        );
    }

    // Arrange in pairs
    let mut rows: Vec<Element<Message>> = Vec::new();
    let mut grid_iter = grid_items.into_iter();
    while let Some(first) = grid_iter.next() {
        if let Some(second) = grid_iter.next() {
            rows.push(
                row![first, second]
                    .spacing(8)
                    .width(Length::Fill)
                    .into(),
            );
        } else {
            rows.push(first);
        }
        rows.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
    }
    items.push(widgets::card(theme, column(rows).spacing(0).width(Length::Fill)));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // Tags
    if !student.tags.is_empty() {
        let mut tag_row: Vec<Element<Message>> = Vec::new();
        for tag in &student.tags {
            tag_row.push(widgets::badge(theme, theme.purple, tag.clone()));
        }
        items.push(
            row![
                text("标签")
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme)),
                iced::widget::Space::new().width(Length::Fixed(8.0)).height(Length::Fixed(0.0)),
                row(tag_row).spacing(6),
            ]
            .align_y(iced::Alignment::Center)
            .into(),
        );
        items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
    }

    // Grades
    let grades = app
        .ui_state
        .grades
        .get(&student.id)
        .cloned()
        .unwrap_or_default();
    items.push(widgets::section_title(theme, "成绩记录").into());
    if grades.is_empty() {
        items.push(
            text("暂无成绩")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme))
                .into(),
        );
    } else {
        for g in grades.iter().take(20) {
            let pct = (g.score / g.max_score).clamp(0.0, 1.0);
            let bar = iced::widget::progress_bar(0.0..=1.0, pct)
                .style(move |_: &iced::Theme| iced::widget::progress_bar::Style {
                    background: iced::Background::Color(iced::Color { a: 0.1, ..theme.accent }),
                    bar: iced::Background::Color(theme.accent),
                    border: iced::Border::default(),
                })
                .girth(Length::Fixed(6.0))
                .length(Length::Fill);
            let grade_row = row![
                text(g.subject.clone())
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme))
                    .width(Length::Fixed(80.0)),
                bar,
                text(format!("{:.1}/{}", g.score, g.max_score))
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme))
                    .width(Length::Fixed(60.0)),
            ]
            .spacing(8)
            .align_y(iced::Alignment::Center);
            items.push(grade_row.into());
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)).into());
        }
    }

    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // Notes
    if let Some(notes) = &student.notes {
        items.push(widgets::section_title(theme, "备注").into());
        items.push(
            text(notes.clone())
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme))
                .into(),
        );
        items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
    }

    // Action buttons
    let actions = row![
        iced::widget::button(
            text("✎ 编辑")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::EditStudent(Some(student.clone()))),
        iced::widget::button(
            text("✕ 删除")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::danger_button(theme, status))
        .padding([8.0, 14.0])
        .on_press(Message::DeleteStudent(student.id)),
    ]
    .spacing(8);
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
