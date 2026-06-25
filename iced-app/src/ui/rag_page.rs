//! RAG knowledge base page.
//!
//! Layout (matches `iced-app/preview/index.html#page-rag`):
//!
//! ```text
//! ┌──────────────── pageHead ────────────────┐
//! ├ row-2 (1fr / 1fr on Wide+Medium) ───────┤
//! │  ┌──────── Document List ────────┐ ┌── Retrieval Test ──┐
//! │  │  card-head (table | upload)   │ │  search box         │
//! │  │  table                        │ │  chunk #1           │
//! │  │  …                            │ │  chunk #2           │
//! │  │                               │ │  chunk #3           │
//! │  └───────────────────────────────┘ │  meta + apply-btn   │
//! │                                     └─────────────────────┘
//! └──────────────────────────────────────────┘
//! ```
//!
//! Responsive: `LayoutMode::Compact` collapses `row-2` to a single column
//! (everything stacks vertically); Medium and Wide render the 2-col grid.

use iced::widget::{column, container, row, scrollable, text, text_input, Space, Svg};
use iced::{Alignment, Color, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::components;
use crate::ui::icons::{icon, IconName};
use crate::ui::responsive::LayoutMode;
use crate::ui::style;
use crate::ui::widgets;

/// Public page entry — same signature as cycle 1, body rewritten to align
/// with the preview's row-2 layout, doc list table, and retrieval test card.
pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mode = app.layout_mode;
    let docs = app.rag_documents.read().clone();
    let total_chunks: usize = docs.iter().map(|d| d.chunks.len()).sum();

    let header = widgets::page_header(
        theme,
        "知识库",
        &format!(
            "{} 个文档 · {} chunks · 嵌入模型 BGE-M3",
            docs.len(),
            total_chunks
        ),
    );

    // Adding-a-document form takes over the whole page.
    if app.ui_state.rag_adding_document {
        return column![
            header,
            Space::new().width(0.0).height(style::spacing::MD),
            document_add_form(app),
        ]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into();
    }

    // row-2: docs list + retrieval test
    let docs_card = document_list_card(app, &docs);
    let retrieval_card = retrieval_card(app);

    let body: Element<Message> = if mode.is_compact() {
        column![docs_card, Space::new().width(0.0).height(style::spacing::MD), retrieval_card]
            .spacing(0)
            .width(Length::Fill)
            .into()
    } else {
        row![docs_card, Space::new().width(style::spacing::MD), retrieval_card]
            .spacing(0)
            .width(Length::Fill)
            .into()
    };

    let grid = column![header, Space::new().width(0.0).height(style::spacing::MD), body]
        .spacing(0)
        .width(Length::Fill);

    column![
        grid,
        container(scrollable(grid).style(move |_, _| style::scrollable(theme)))
            .width(Length::Fill)
            .height(Length::Fill),
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

// ── Document list card ─────────────────────────────────────────────

fn document_list_card(app: &App, docs: &[crate::models::RagDocument]) -> Element<Message> {
    let theme = &app.theme;

    // Card head — icon + title + upload button (matches preview).
    let upload_icon: Element<Message> = Svg::new(icon(IconName::Upload))
        .width(Length::Fixed(12.0))
        .height(Length::Fixed(12.0))
        .into();
    let db_icon: Element<Message> = Svg::new(icon(IconName::Database))
        .width(Length::Fixed(15.0))
        .height(Length::Fixed(15.0))
        .into();

    let head = row![
        row![db_icon, Space::new().width(6).height(0),
            text("文档列表").size(14)
                .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
                .style(move |_: &iced::Theme| style::text_primary(theme)),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
        Space::new().width(Length::Fill).height(0),
        iced::widget::button(
            row![upload_icon,
                text("上传").font(CJK_FONT).size(11.5)
                    .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(iced::Color::WHITE), ..Default::default() }),
            ]
            .spacing(5)
            .align_y(Alignment::Center),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([5.0, 11.0])
        .on_press(Message::RagOpenAddDocument),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(Padding { top: 14.0, bottom: 12.0, left: 18.0, right: 18.0 });

    // Table head (column labels).
    let col_w = [Length::Fill, Length::Fixed(70.0), Length::Fixed(60.0), Length::Fixed(70.0), Length::Fixed(110.0), Length::Fixed(70.0)];
    let header_row = row![
        cell("文档", col_w[0], theme, true),
        cell("大小", col_w[1], theme, true),
        cell("Chunks", col_w[2], theme, true),
        cell("类型", col_w[3], theme, true),
        cell("添加时间", col_w[4], theme, true),
        cell("", col_w[5], theme, true),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    // Body rows.
    let mut rows: Vec<Element<Message>> = Vec::new();
    if docs.is_empty() {
        rows.push(
            components::empty_state::empty_state(IconName::Database, "知识库为空", "点击右上角「上传」开始构建本地知识库")
                .into(),
        );
    } else {
        for d in docs.iter() {
            let chunks = d.chunks.len();
            let size = crate::util::truncate(&d.content, 32);
            let added = d.created_at.format("%Y-%m-%d").to_string();
            let kind_pill = components::badge::zinc("RAG");

            let row_el = row![
                cell(&d.title, col_w[0], theme, false),
                cell(&size, col_w[1], theme, false),
                cell(&format!("{}", chunks), col_w[2], theme, false),
                row![kind_pill].spacing(0).width(col_w[3]),
                cell(&added, col_w[4], theme, false),
                row![
                    icon_btn(theme, IconName::Eye, Message::RagOpenAddDocument),
                    icon_btn(theme, IconName::Trash, Message::DeleteRagDocument(d.id)),
                ]
                .spacing(4)
                .align_y(Alignment::Center)
                .width(col_w[5]),
            ]
            .spacing(8)
            .align_y(Alignment::Center)
            .padding(Padding { top: 8.0, bottom: 8.0, left: 12.0, right: 12.0 });

            rows.push(row_el.into());
        }
    }

    let body_col = column![header_row, Space::new().width(0.0).height(style::spacing::XS),]
        .spacing(0)
        .width(Length::Fill);
    let mut body_with_rows = body_col;
    for r in rows {
        body_with_rows = body_with_rows.push(r);
    }

    container(
        column![
            head,
            container(
                column![body_with_rows].spacing(0).width(Length::Fill),
            )
            .style(move |_: &iced::Theme| iced::widget::container::Style {
                background: Some(iced::Background::Color(theme.surface_glass)),
                border: iced::Border {
                    color: style::border_step::hairline(theme),
                    width: 0.0,
                    radius: iced::border::Radius::from(style::radius::MD),
                },
                ..Default::default()
            })
            .padding(style::spacing::SM),
        ]
        .spacing(0)
        .width(Length::Fill),
    )
    .style(move |_: &iced::Theme| style::card(theme))
    .padding(0)
    .width(Length::Fill)
    .into()
}

fn cell<'a>(label: &str, width: Length, theme: &'a crate::theme::Theme, muted: bool) -> Element<'a, Message> {
    let style_fn: fn(&crate::theme::Theme) -> iced::widget::text::Style = if muted {
        style::text_faint
    } else {
        style::text_primary
    };
    container(
        text(label.to_string())
            .size(if muted { 11.5 } else { 12.5 })
            .font(if muted { CJK_FONT } else { CJK_FONT })
            .style(move |_: &iced::Theme| style_fn(theme)),
    )
    .width(width)
    .into()
}

fn icon_btn(theme: &crate::theme::Theme, ic: IconName, on_press: Message) -> Element<Message> {
    let svg: Element<Message> = Svg::new(icon(ic))
        .width(Length::Fixed(12.0))
        .height(Length::Fixed(12.0))
        .into();
    iced::widget::button(svg)
        .style(move |_, status| style::ghost_button(theme, status))
        .padding([6.0, 6.0])
        .width(Length::Fixed(26.0))
        .height(Length::Fixed(26.0))
        .on_press(on_press)
        .into()
}

// ── Retrieval test card ────────────────────────────────────────────

fn retrieval_card(app: &App) -> Element<Message> {
    let theme = &app.theme;

    let head = row![
        row![
            Svg::new(icon(IconName::Search))
                .width(Length::Fixed(15.0))
                .height(Length::Fixed(15.0)),
            Space::new().width(6).height(0),
            text("检索测试")
                .size(14)
                .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
                .style(move |_: &iced::Theme| style::text_primary(theme)),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
        Space::new().width(Length::Fill).height(0),
        text("Top-K: 5")
            .size(11.5)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(8)
    .align_y(Alignment::Center)
    .padding(Padding { top: 14.0, bottom: 12.0, left: 18.0, right: 18.0 });

    // Search input row.
    let search_field: Element<Message> = row![
        Svg::new(icon(IconName::Search))
            .width(Length::Fixed(14.0))
            .height(Length::Fixed(14.0)),
        Space::new().width(8).height(0),
        text_input("输入查询语句…", &app.ui_state.rag_query)
            .on_input(Message::RagQueryChanged)
            .on_submit(Message::RagQuery)
            .font(CJK_FONT)
            .size(13)
            .padding([6.0, 4.0])
            .style(move |_, status| style::text_input_style(theme, status))
            .width(Length::Fill),
    ]
    .spacing(0)
    .align_y(Alignment::Center)
    .padding(Padding { top: 8.0, bottom: 8.0, left: 12.0, right: 12.0 })
    .into();

    let search_input = container(search_field)
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(theme.bg)),
            border: iced::Border {
                color: style::border_step::base(theme),
                width: 1.0,
                radius: iced::border::Radius::from(style::radius::LG),
            },
            ..Default::default()
        })
        .width(Length::Fill);

    // Hit list.
    let mut hits: Vec<Element<Message>> = Vec::new();
    if app.ui_state.rag_results.is_empty() {
        hits.push(
            text("输入关键词后按 Enter 进行向量检索。")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme))
                .into(),
        );
    } else {
        for (idx, (doc_id, _chunk_id, score, text_content)) in
            app.ui_state.rag_results.iter().enumerate()
        {
            let docs = app.rag_documents.read();
            let doc_title = docs.iter().find(|d| d.id == *doc_id).map(|d| d.title.clone());
            drop(docs);

            hits.push(chunk_hit(
                theme,
                idx + 1,
                *score,
                doc_title.as_deref().unwrap_or("未知文档"),
                text_content,
            ));
        }
    }

    // Footer: timing + apply button.
    let hit_count = app.ui_state.rag_results.len();
    let meta: Element<Message> = text(if hit_count == 0 {
        "未检索".to_string()
    } else {
        format!("检索耗时 ≈ 86ms · {} / 5 命中", hit_count)
    })
    .size(11)
    .font(CJK_FONT)
    .style(move |_: &iced::Theme| style::text_faint(theme))
    .into();

    let apply_btn = iced::widget::button(
        row![
            Svg::new(icon(IconName::Zap))
                .width(Length::Fixed(12.0))
                .height(Length::Fixed(12.0)),
            Space::new().width(5).height(0),
            text("应用到对话")
                .font(CJK_FONT)
                .size(11.5)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(theme.text), ..Default::default() }),
        ]
        .spacing(0)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::ghost_button(theme, status))
    .padding([4.0, 10.0])
    .on_press(Message::RagQuery);

    let footer = container(
        row![
            meta,
            Space::new().width(Length::Fill).height(0),
            apply_btn,
        ]
        .spacing(8)
        .align_y(Alignment::Center)
        .padding(Padding { top: 12.0, bottom: 0.0, left: 0.0, right: 0.0 }),
    )
    .style(move |_: &iced::Theme| iced::widget::container::Style {
        border: iced::Border {
            color: style::border_step::soft(theme),
            width: 0.0,
            radius: iced::border::Radius::from(0.0),
        },
        ..Default::default()
    })
    .width(Length::Fill);

    let mut body = column![search_input].spacing(style::spacing::SM).width(Length::Fill);
    for h in hits {
        body = body.push(h);
        body = body.push(Space::new().width(0.0).height(style::spacing::SM));
    }
    body = body.push(Space::new().width(0.0).height(style::spacing::SM));
    body = body.push(footer);

    container(
        column![
            head,
            container(body)
                .padding(Padding { top: 14.0, bottom: 16.0, left: 18.0, right: 18.0 }),
        ]
        .spacing(0)
        .width(Length::Fill),
    )
    .style(move |_: &iced::Theme| style::card(theme))
    .padding(0)
    .width(Length::Fill)
    .into()
}

fn chunk_hit(
    theme: &crate::theme::Theme,
    index: usize,
    score: f32,
    source: &str,
    body: &str,
) -> Element<Message> {
    let accent = Color::from_rgba(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0, 1.0); // preview #a78bfa
    let header = row![
        Svg::new(icon(IconName::Check))
            .width(Length::Fixed(11.0))
            .height(Length::Fixed(11.0)),
        Space::new().width(5).height(0),
        text(format!("Chunk #{} · 相似度 {:.2}", index, score))
            .size(11)
            .font(Font { family: CJK_FONT.family, weight: iced::font::Weight::Bold, ..Default::default() })
            .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(accent), ..Default::default() }),
        Space::new().width(Length::Fill).height(0),
        text(source)
            .size(10.5)
            .font(CJK_FONT)
            .style(move |_: &iced::Theme| style::text_faint(theme)),
    ]
    .spacing(0)
    .align_y(Alignment::Center);

    let body_text = text(crate::util::truncate(body, 160))
        .size(12)
        .font(CJK_FONT)
        .style(move |_: &iced::Theme| style::text_dim(theme));

    container(column![header, Space::new().width(0.0).height(6), body_text].spacing(0))
        .style(move |_: &iced::Theme| iced::widget::container::Style {
            background: Some(iced::Background::Color(Color::from_rgba(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0, 0.05))),
            border: iced::Border {
                color: Color::from_rgba(168.0 / 255.0, 85.0 / 255.0, 247.0 / 255.0, 0.15),
                width: 1.0,
                radius: iced::border::Radius::from(10.0),
            },
            ..Default::default()
        })
        .padding(12)
        .width(Length::Fill)
        .into()
}

// ── Add-document form (modal-style full page replacement) ─────────

fn document_add_form(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mut items: Vec<Element<Message>> = Vec::new();

    items.push(
        section_header(Some(IconName::FileText), "添加文档到知识库").into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::LG).into());

    items.push(
        column![
            text("文档标题")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(4),
            text_input("输入文档标题", &app.ui_state.rag_new_title)
                .on_input(Message::RagNewTitleChanged)
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(0)
        .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::SM).into());

    items.push(
        column![
            text("文档内容")
                .size(12)
                .font(CJK_FONT)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            Space::new().width(0.0).height(4),
            text_input("粘贴文档内容…", &app.ui_state.rag_new_content)
                .on_input(Message::RagNewContentChanged)
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(0)
        .into(),
    );
    items.push(Space::new().width(0.0).height(style::spacing::LG).into());

    let actions = row![
        iced::widget::button(
            text("保存")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style { color: Some(iced::Color::WHITE), ..Default::default() }),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::SaveRagDocument(
            app.ui_state.rag_new_title.clone(),
            app.ui_state.rag_new_content.clone(),
        )),
        iced::widget::button(
            text("取消")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| style::text_dim(theme)),
        )
        .style(move |_, status| style::secondary_button(theme, status))
        .padding([10.0, 20.0])
        .on_press(Message::RagCloseAddDocument),
    ]
    .spacing(style::spacing::MD);

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

