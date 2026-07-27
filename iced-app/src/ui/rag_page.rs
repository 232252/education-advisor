//! RAG knowledge base page.

use iced::widget::{column, container, row, scrollable, text, text_input, Space};
use iced::{Alignment, Element, Font, Length, Padding};

use crate::app::{App, CJK_FONT, Message};
use crate::ui::style;
use crate::ui::widgets;

pub fn view(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let docs = app.rag_documents.read().clone();

    let header = widgets::page_header(theme, "知识库", "本地 RAG 知识库，支持向量检索");

    // If adding a document, show the add form
    if app.ui_state.rag_adding_document {
        return column![
            header,
            Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)),
            document_add_form(app)
        ]
        .spacing(0)
        .width(Length::Fill)
        .height(Length::Fill)
        .into();
    }

    let mut items: Vec<Element<Message>> = Vec::new();

    // Add document button
    let add_doc_btn = iced::widget::button(
        row![
            text("+").size(14).style(move |_: &iced::Theme| iced::widget::text::Style {
                color: Some(iced::Color::WHITE),
            }),
            text("添加文档")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        ]
        .spacing(6)
        .align_y(Alignment::Center),
    )
    .style(move |_, status| style::primary_button(theme, status))
    .padding([8.0, 14.0])
    .on_press(Message::RagOpenAddDocument);

    items.push(add_doc_btn.into());
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // Query box
    let query_input = text_input("输入搜索关键词…", &app.ui_state.rag_query)
        .on_input(Message::RagQueryChanged)
        .on_submit(Message::RagQuery)
        .font(CJK_FONT)
        .size(14)
        .padding([10.0, 12.0])
        .style(move |_, status| style::text_input_style(theme, status))
        .width(Length::Fill);

    let query_row = row![
        query_input,
        iced::widget::button(
            text("搜索")
                .font(CJK_FONT)
                .size(13)
                .style(move |_: &iced::Theme| iced::widget::text::Style {
                    color: Some(iced::Color::WHITE),
                }),
        )
        .style(move |_, status| style::primary_button(theme, status))
        .padding([10.0, 16.0])
        .on_press(Message::RagQuery),
    ]
    .spacing(8)
    .align_y(Alignment::Center);

    items.push(widgets::card(theme, query_row));
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());

    // Search results
    if !app.ui_state.rag_results.is_empty() {
        items.push(widgets::section_title(theme, "搜索结果").into());
        for (doc_id, _chunk_id, score, text_content) in &app.ui_state.rag_results {
            let doc = docs.iter().find(|d| d.id == *doc_id);
            let title = doc.map(|d| d.title.as_str()).unwrap_or("未知文档");
            let result = column![
                row![
                    text(title.to_string())
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(13)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
                    widgets::badge(theme, theme.success, format!("{:.0}%", score * 100.0)),
                ]
                .align_y(Alignment::Center),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)),
                text(crate::util::truncate(text_content, 120))
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_dim(theme)),
            ]
            .spacing(0);
            items.push(
                container(result)
                    .style(move |_: &iced::Theme| style::card_flat(theme))
                    .padding(Padding::from(12.0))
                    .width(Length::Fill)
                    .into(),
            );
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
        }
        items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)).into());
    }

    // Document list
    items.push(widgets::section_title(theme, "文档列表").into());

    if docs.is_empty() {
        items.push(
            widgets::empty_state(theme, "📚", "知识库为空，添加文档开始使用 RAG")
                .into(),
        );
    } else {
        for d in &docs {
            let chunk_count = d.chunks.len();
            let card_content = column![
                row![
                    text("📄").size(20),
                    text(d.title.clone())
                        .font(Font {
                            family: CJK_FONT.family,
                            weight: iced::font::Weight::Bold,
                            ..Default::default()
                        })
                        .size(14)
                        .style(move |_: &iced::Theme| style::text_primary(theme)),
                    iced::widget::Space::new().width(Length::Fill).height(Length::Fixed(0.0)),
                    widgets::badge(theme, theme.info, format!("{} 块", chunk_count)),
                    iced::widget::button(
                        text("✕")
                            .size(12)
                            .style(move |_: &iced::Theme| iced::widget::text::Style {
                                color: Some(iced::Color::WHITE),
                            }),
                    )
                    .style(move |_, status| style::danger_button(theme, status))
                    .padding([4.0, 8.0])
                    .on_press(Message::DeleteRagDocument(d.id)),
                ]
                .align_y(Alignment::Center)
                .spacing(8),
                iced::widget::Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(4.0)),
                text(crate::util::truncate(&d.content, 100))
                    .font(CJK_FONT)
                    .size(12)
                    .style(move |_: &iced::Theme| style::text_faint(theme)),
            ]
            .spacing(0)
            .width(Length::Fill);

            items.push(
                container(card_content)
                    .style(move |_: &iced::Theme| style::card_flat(theme))
                    .padding(Padding::from(14.0))
                    .width(Length::Fill)
                    .into(),
            );
            items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(8.0)).into());
        }
    }

    let grid = column(items).spacing(0).width(Length::Fill);
    let content = scrollable(grid).style(move |_, _| style::scrollable(theme));

    column![
        header,
        Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(12.0)),
        container(content).width(Length::Fill).height(Length::Fill)
    ]
    .spacing(0)
    .width(Length::Fill)
    .height(Length::Fill)
    .into()
}

fn document_add_form(app: &App) -> Element<Message> {
    let theme = &app.theme;
    let mut items: Vec<Element<Message>> = Vec::new();

    items.push(
        text("添加文档到知识库")
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

    // Title input
    items.push(
        column![
            text("文档标题")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("输入文档标题", &app.ui_state.rag_new_title)
                .on_input(Message::RagNewTitleChanged)
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

    // Content input
    items.push(
        column![
            text("文档内容")
                .font(CJK_FONT)
                .size(12)
                .style(move |_: &iced::Theme| style::text_faint(theme)),
            text_input("粘贴文档内容…", &app.ui_state.rag_new_content)
                .on_input(Message::RagNewContentChanged)
                .font(CJK_FONT)
                .size(13)
                .padding([8.0, 10.0])
                .style(move |_, status| style::text_input_style(theme, status))
                .width(Length::Fill),
        ]
        .spacing(4)
        .into(),
    );
    items.push(Space::new().width(Length::Fixed(0.0)).height(Length::Fixed(16.0)).into());

    // Actions
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
