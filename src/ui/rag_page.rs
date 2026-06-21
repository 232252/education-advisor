//! Local RAG knowledge base: drag-drop text files, chunk, embed, and search.
//!
//! Embeddings are produced by [`crate::embedding`], a hashing TF vectorizer
//! that ships in-tree (no model download, no extra deps). The on-disk schema
//! is unchanged from earlier versions: `RagDocument` carries a `Vec<RagChunk>`
//! where each chunk has a `text` and a `Vec<f32>` embedding.

use chrono::Utc;
use eframe::egui::{self, Align, FontId, Layout, Ui, Vec2};
use uuid::Uuid;

use crate::app::App;
use crate::embedding::{self, SearchHit};
use crate::models::{RagChunk, RagDocument};
use crate::ui::widgets::{
    card, empty_state, ghost_button, primary_button, search_input, section_title,
};

pub fn show(app: &mut App, ui: &mut Ui) {
    section_title(ui, &app.theme, "本地知识库");

    // drag-and-drop: accept text files dropped onto the page.
    if let Some(paths) = ui
        .input(|i| i.raw.dropped_files.clone())
        .first()
        .and_then(|f| f.path.clone())
    {
        if let Ok(content) = std::fs::read_to_string(&paths) {
            let title = paths
                .file_stem()
                .map_or_else(|| "未命名".into(), |s| s.to_string_lossy().to_string());
            add_document(app, title, content);
        }
    }

    ui.horizontal(|ui| {
        ui.label(
            egui::RichText::new("拖拽或选择文本文件，自动分块并向量化，检索时显示命中热度")
                .font(FontId::proportional(12.0))
                .color(app.theme.text_dim),
        );
        ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
            if primary_button(ui, &app.theme, "添加文档").clicked() {
                if let Some(path) = rfd::FileDialog::new()
                    .add_filter("Text", &["txt", "md"])
                    .pick_file()
                {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let title = path
                            .file_stem()
                            .map_or_else(|| "未命名".into(), |s| s.to_string_lossy().to_string());
                        add_document(app, title, content);
                    }
                }
            }
        });
    });

    ui.add_space(8.0);

    // search box
    let theme = app.theme.clone();
    card(ui, &theme, |ui| {
        ui.horizontal(|ui| {
            let search_w = ui.available_width() - 86.0;
            let _ = search_input(
                ui,
                &theme,
                &mut app.ui_state.rag_query,
                "输入查询，检索本地知识库…",
                search_w,
            );
            if primary_button(ui, &theme, "检索").clicked() {
                let query = app.ui_state.rag_query.clone();
                let hits = search_rag(app, &query);
                app.ui_state.rag_results = hits
                    .into_iter()
                    .map(|h| (h.document_id, h.chunk_id, h.score, h.chunk_text))
                    .collect();
            }
        });
    });

    ui.add_space(8.0);

    let docs = app.rag_documents.read().clone();

    // results heatmap
    if !app.ui_state.rag_results.is_empty() {
        card(ui, &app.theme, |ui| {
            section_title(ui, &app.theme, "检索命中热度");
            for (doc_id, _chunk_id, score, text) in &app.ui_state.rag_results {
                let doc_title = docs
                    .iter()
                    .find(|d| d.id == *doc_id)
                    .map_or_else(|| "未知文档".to_string(), |d| d.title.clone());
                let heat = (score.clamp(0.0, 1.0) * 255.0) as u8;
                let color = app.theme.risk_color(crate::models::RiskLevel::Medium);
                let heat_color =
                    egui::Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), heat);
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new(doc_title.clone())
                            .font(FontId::proportional(11.0))
                            .color(app.theme.text_dim),
                    );
                    ui.label(
                        egui::RichText::new(format!("{score:.2}"))
                            .font(FontId::proportional(11.0))
                            .strong()
                            .color(color),
                    );
                });
                let (r, _) = ui.allocate_exact_size(
                    Vec2::new(ui.available_width() * score, 4.0),
                    egui::Sense::hover(),
                );
                ui.painter()
                    .rect_filled(r, egui::Rounding::same(2.0), heat_color);
                ui.label(
                    egui::RichText::new(crate::util::truncate(text, 120))
                        .font(FontId::proportional(11.0))
                        .color(app.theme.text),
                );
                ui.separator();
            }
        });
        ui.add_space(8.0);
    }

    // document list
    if docs.is_empty() {
        card(ui, &app.theme, |ui| {
            empty_state(
                ui,
                &app.theme,
                crate::ui::icons::rag,
                "知识库为空，点击「添加文档」开始构建",
            );
        });
    } else {
        egui::ScrollArea::vertical().show(ui, |ui| {
            for d in &docs {
                let needs_reindex = d.chunks.iter().any(|c| c.embedding.is_empty());
                card(ui, &app.theme, |ui| {
                    ui.horizontal_top(|ui| {
                        ui.vertical(|ui| {
                            ui.label(
                                egui::RichText::new(&d.title)
                                    .font(FontId::proportional(14.0))
                                    .strong()
                                    .color(app.theme.text),
                            );
                            ui.label(
                                egui::RichText::new(format!(
                                    "{} 字符 · {} 块{}",
                                    d.content.len(),
                                    d.chunks.len(),
                                    if needs_reindex {
                                        " · 需重新索引"
                                    } else {
                                        ""
                                    }
                                ))
                                .font(FontId::proportional(11.0))
                                .color(app.theme.text_dim),
                            );
                        });
                        ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                            if needs_reindex && ghost_button(ui, &app.theme, "重新索引").clicked()
                            {
                                let _ =
                                    app.runtime
                                        .tx
                                        .send(crate::runtime::Command::SaveRagDocument(
                                            reindex_document(d.clone()),
                                        ));
                            }
                            if ghost_button(ui, &app.theme, "删除").clicked() {
                                let _ = app
                                    .runtime
                                    .tx
                                    .send(crate::runtime::Command::DeleteRagDocument(d.id));
                            }
                        });
                    });
                });
                ui.add_space(6.0);
            }
        });
    }
}

fn add_document(app: &mut App, title: String, content: String) {
    let doc_id = Uuid::new_v4();
    let chunks: Vec<RagChunk> = embedding::chunk_text(&content)
        .into_iter()
        .map(|text| RagChunk {
            id: Uuid::new_v4(),
            document_id: doc_id,
            embedding: embedding::embed_text(&text),
            text,
        })
        .collect();
    let doc = RagDocument {
        id: doc_id,
        title,
        content,
        chunks,
        created_at: Utc::now(),
    };
    let _ = app
        .runtime
        .tx
        .send(crate::runtime::Command::SaveRagDocument(doc));
}

/// Re-embed every chunk of an existing document. Used when a document was
/// loaded from disk but its embedding vector is empty (e.g. an older
/// schema that didn't store embeddings, or a chunk that was added through
/// a path that bypassed the embedder).
fn reindex_document(mut d: RagDocument) -> RagDocument {
    d.chunks = d
        .chunks
        .into_iter()
        .map(|mut c| {
            c.embedding = embedding::embed_text(&c.text);
            c
        })
        .collect();
    d
}

fn search_rag(app: &App, query: &str) -> Vec<SearchHit> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let docs = app.rag_documents.read().clone();
    let corpus = embedding::Corpus::from_documents(&docs);
    corpus.search_text(query, 20)
}
