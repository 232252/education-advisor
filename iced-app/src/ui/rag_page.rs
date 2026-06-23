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

    let mut items: Vec<Element<Message>> = Vec::new();

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
