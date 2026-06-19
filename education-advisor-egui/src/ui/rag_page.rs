//! Local RAG knowledge base: drag-drop text files, chunk, vectorize, and search.

use chrono::Utc;
use eframe::egui::{self, Align, FontId, Layout, Ui, Vec2};
use uuid::Uuid;

use crate::app::App;
use crate::models::{RagChunk, RagDocument};
use crate::ui::widgets::{card, empty_state, ghost_button, primary_button, section_title};

pub fn show(app: &mut App, ui: &mut Ui) {
    section_title(ui, &app.theme, "本地知识库");

    // drag-and-drop: accept text files dropped onto the page.
    if let Some(paths) = ui.input(|i| i.raw.dropped_files.clone()).first().and_then(|f| f.path.clone()) {
        if let Ok(content) = std::fs::read_to_string(&paths) {
            let title = paths.file_stem().map_or_else(|| "未命名".into(), |s| s.to_string_lossy().to_string());
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
                if let Some(path) = rfd::FileDialog::new().add_filter("Text", &["txt", "md"]).pick_file() {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let title = path.file_stem().map_or_else(|| "未命名".into(), |s| s.to_string_lossy().to_string());
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
            ui.label(egui::RichText::new("🔍").font(FontId::proportional(14.0)));
            ui.text_edit_singleline(&mut app.ui_state.rag_query);
            if primary_button(ui, &theme, "检索").clicked() {
                let query = app.ui_state.rag_query.clone();
                app.ui_state.rag_results = search_rag(app, &query);
            }
        });
    });

    ui.add_space(8.0);

    let docs = app.rag_documents.read().clone();

    // results heatmap
    if !app.ui_state.rag_results.is_empty() {
        card(ui, &app.theme, |ui| {
            section_title(ui, &app.theme, "检索命中热度");
            for (doc_id, chunk_idx, score, text) in &app.ui_state.rag_results {
                let doc_title = docs.iter().find(|d| d.id == *doc_id).map_or_else(|| "未知文档".to_string(), |d| d.title.clone());
                let heat = (score.clamp(0.0, 1.0) * 255.0) as u8;
                let color = app.theme.risk_color(crate::models::RiskLevel::Medium);
                let heat_color = egui::Color32::from_rgba_premultiplied(color.r(), color.g(), color.b(), heat);
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new(format!("{doc_title} · 块{chunk_idx}")).font(FontId::proportional(11.0)).color(app.theme.text_dim));
                    ui.label(egui::RichText::new(format!("{score:.2}")).font(FontId::proportional(11.0)).strong().color(color));
                });
                let (r, _) = ui.allocate_exact_size(Vec2::new(ui.available_width() * score, 4.0), egui::Sense::hover());
                ui.painter().rect_filled(r, egui::Rounding::same(2.0), heat_color);
                ui.label(egui::RichText::new(crate::util::truncate(text, 120)).font(FontId::proportional(11.0)).color(app.theme.text));
                ui.separator();
            }
        });
        ui.add_space(8.0);
    }

    // document list
    if docs.is_empty() {
        card(ui, &app.theme, |ui| {
            empty_state(ui, &app.theme, "📚", "知识库为空，点击「添加文档」开始构建");
        });
    } else {
        egui::ScrollArea::vertical().show(ui, |ui| {
            for d in &docs {
                card(ui, &app.theme, |ui| {
                    ui.horizontal_top(|ui| {
                        ui.vertical(|ui| {
                            ui.label(egui::RichText::new(&d.title).font(FontId::proportional(14.0)).strong().color(app.theme.text));
                            ui.label(
                                egui::RichText::new(format!("{} 字符 · {} 块", d.content.len(), d.chunks.len()))
                                    .font(FontId::proportional(11.0))
                                    .color(app.theme.text_dim),
                            );
                        });
                        ui.with_layout(Layout::right_to_left(Align::TOP), |ui| {
                            if ghost_button(ui, &app.theme, "删除").clicked() {
                                let _ = app.runtime.tx.send(crate::runtime::Command::DeleteRagDocument(d.id));
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
    let chunks = chunk_text(&content);
    let doc_id = Uuid::new_v4();
    let chunks: Vec<RagChunk> = chunks
        .into_iter()
        .enumerate()
        .map(|(i, text)| {
            let embedding = embed(&text, i);
            RagChunk {
                id: Uuid::new_v4(),
                document_id: doc_id,
                text,
                embedding,
            }
        })
        .collect();
    let doc = RagDocument {
        id: doc_id,
        title,
        content,
        chunks,
        created_at: Utc::now(),
    };
    let _ = app.runtime.tx.send(crate::runtime::Command::SaveRagDocument(doc));
}

/// Split text into overlapping chunks. Works for both whitespace-separated
/// languages and CJK streams without spaces.
fn chunk_text(text: &str) -> Vec<String> {
    if text.is_empty() {
        return vec![text.to_string()];
    }
    // For scripts without spaces (CJK), split by Unicode chars; otherwise words.
    let has_spaces = text.chars().any(char::is_whitespace);
    let tokens: Vec<String> = if has_spaces {
        text.split_whitespace().map(std::string::ToString::to_string).collect()
    } else {
        text.chars().map(|c| c.to_string()).collect()
    };
    let size = if has_spaces { 80 } else { 200 };
    let overlap = if has_spaces { 20 } else { 50 };
    let mut out = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let end = (i + size).min(tokens.len());
        out.push(tokens[i..end].join(if has_spaces { " " } else { "" }));
        if end == tokens.len() {
            break;
        }
        i += size - overlap;
    }
    out
}

/// A deterministic local embedding surrogate using character n-gram hashes.
/// Keeps everything on-device with no external model.
fn embed(text: &str, chunk_index: usize) -> Vec<f32> {
    let mut vec = vec![0.0f32; 64];
    let bytes = text.as_bytes();
    for w in bytes.windows(3) {
        let mut h = 0u32;
        for b in w {
            h = h.wrapping_mul(31).wrapping_add(u32::from(*b));
        }
        let idx = (h as usize) % vec.len();
        vec[idx] += 1.0;
    }
    // incorporate chunk position for variety
    let len = vec.len();
    vec[chunk_index % len] += 1.0;
    // normalize
    let norm = vec.iter().map(|v| v * v).sum::<f32>().sqrt().max(1.0);
    for v in &mut vec {
        *v /= norm;
    }
    vec
}

fn search_rag(app: &App, query: &str) -> Vec<(Uuid, usize, f32, String)> {
    if query.trim().is_empty() {
        return Vec::new();
    }
    let q = embed(query, 0);
    let docs = app.rag_documents.read().clone();
    let mut hits = Vec::new();
    for d in docs {
        for (i, c) in d.chunks.iter().enumerate() {
            let score = cosine_similarity(&q, &c.embedding);
            if score > 0.05 {
                hits.push((d.id, i, score, c.text.clone()));
            }
        }
    }
    hits.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(20);
    hits
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..n {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    dot / (na.sqrt() * nb.sqrt()).max(1e-6)
}
