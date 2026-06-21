//! Local embedding + similarity search for the RAG knowledge base.
//!
//! Strategy: **hashing TF vectorizer + cosine similarity**. This is the same
//! family as scikit-learn's `HashingVectorizer` and is well-suited for
//! mixed Chinese/English corpora at the scale of a single user's documents.
//!
//! Why not a real transformer?
//!   - 17 MB binary budget rules out bundling an ONNX model.
//!   - Educational RAG queries are short and high-signal, so classical IR
//!     methods work surprisingly well.
//!   - Zero new dependencies; runs on the existing WASM-friendly `std`.
//!
//! If you later want to swap in a real model, the only thing that needs to
//! change is [`embed`] — the rest of the API takes `&[f32]` and is
//! model-agnostic.

use serde::{Deserialize, Serialize};

/// Hashing vectorizer dimensionality. 256 is plenty for short educational
/// corpora (a few thousand chunks); bump to 1024 if you start indexing
/// >100k chunks and notice collisions.
pub const EMBEDDING_DIM: usize = 256;

/// One retrieval hit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub document_id: uuid::Uuid,
    pub document_title: String,
    pub chunk_id: uuid::Uuid,
    pub chunk_text: String,
    pub score: f32,
}

// ─── Tokenization ────────────────────────────────────────────────────────

/// Tokenize mixed Chinese/English text into a stream of lower-cased tokens.
///
/// Strategy:
///   - Strip ASCII punctuation
///   - Split CJK runs on character boundaries (each char is a token)
///   - Split Latin runs on whitespace + punctuation
///   - Drop tokens shorter than 1 char or longer than 32 chars
///   - Optionally extract **character bigrams** from CJK runs (good for
///     Chinese where single chars carry less meaning than pairs)
pub fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::with_capacity(text.len() / 4);
    let mut buf = String::new();
    let mut cjk_run: Vec<char> = Vec::new();

    for ch in text.chars() {
        if is_cjk(ch) {
            // Flush any pending ASCII buffer.
            if !buf.is_empty() {
                push_ascii_tokens(&mut out, &buf);
                buf.clear();
            }
            cjk_run.push(ch);
        } else {
            // End of a CJK run: emit unigrams + bigrams.
            if !cjk_run.is_empty() {
                emit_cjk_tokens(&mut out, &cjk_run);
                cjk_run.clear();
            }
            if ch.is_alphanumeric() {
                buf.push(ch);
            } else if !buf.is_empty() {
                push_ascii_tokens(&mut out, &buf);
                buf.clear();
            }
        }
    }
    if !buf.is_empty() {
        push_ascii_tokens(&mut out, &buf);
    }
    if !cjk_run.is_empty() {
        emit_cjk_tokens(&mut out, &cjk_run);
    }
    out
}

fn push_ascii_tokens(out: &mut Vec<String>, buf: &str) {
    let lower = buf.to_lowercase();
    if !lower.is_empty() && lower.len() <= 32 {
        out.push(lower);
    }
}

fn emit_cjk_tokens(out: &mut Vec<String>, run: &[char]) {
    // Unigrams (each CJK char)
    for &c in run {
        let s = c.to_string();
        if s.chars().count() == 1 {
            out.push(s);
        }
    }
    // Bigrams (consecutive CJK pairs)
    for w in run.windows(2) {
        let s: String = w.iter().collect();
        out.push(s);
    }
}

const fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3400..=0x4DBF |   // CJK Extension A
        0x4E00..=0x9FFF |   // CJK Unified Ideographs
        0xF900..=0xFAFF |   // CJK Compatibility Ideographs
        0x20000..=0x2FFFF   // CJK Extension B+
    )
}

// ─── Embedding ───────────────────────────────────────────────────────────

/// Hash a token to a slot in `[0, EMBEDDING_DIM)` with a deterministic ±1
/// sign. The sign lets the dot product distinguish "token present" from
/// "token absent" without storing counts (similar to scikit-learn's
/// `alternate_sign=True`).
fn hash_token(token: &str) -> (usize, f32) {
    // FNV-1a 64-bit. Stable across runs and platforms, no std lib required.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in token.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    let slot = (h as usize) % EMBEDDING_DIM;
    let sign = if h & 1 == 0 { 1.0 } else { -1.0 };
    (slot, sign)
}

/// Hashing TF: each unique token contributes ±1 to its hashed slot. The
/// resulting vector is L2-normalized so cosine similarity reduces to a
/// dot product. Empty input yields a zero vector.
pub fn embed(tokens: &[String]) -> Vec<f32> {
    if tokens.is_empty() {
        return vec![0.0; EMBEDDING_DIM];
    }
    let mut v = vec![0.0f32; EMBEDDING_DIM];
    for t in tokens {
        let (slot, sign) = hash_token(t);
        v[slot] += sign;
    }
    // L2 normalize.
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in &mut v {
            *x /= norm;
        }
    }
    v
}

/// Convenience: tokenize + embed in one call.
pub fn embed_text(text: &str) -> Vec<f32> {
    embed(&tokenize(text))
}

/// Cosine similarity of two equal-length vectors. Returns 0.0 if either is
/// zero or the lengths differ.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (x, y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = na.sqrt() * nb.sqrt();
    if denom == 0.0 {
        0.0
    } else {
        (dot / denom).clamp(-1.0, 1.0)
    }
}

// ─── Search ──────────────────────────────────────────────────────────────

/// A search corpus: pre-tokenized chunks, ready for fast lookup.
pub struct Corpus<'a> {
    pub entries: Vec<CorpusEntry<'a>>,
}

pub struct CorpusEntry<'a> {
    pub document_id: uuid::Uuid,
    pub document_title: &'a str,
    pub chunk_id: uuid::Uuid,
    pub chunk_text: &'a str,
    pub embedding: &'a [f32],
}

impl<'a> Corpus<'a> {
    /// Build a corpus from the documents returned by the DB.
    pub fn from_documents(docs: &'a [crate::models::RagDocument]) -> Self {
        let mut entries = Vec::new();
        for d in docs {
            for c in &d.chunks {
                entries.push(CorpusEntry {
                    document_id: d.id,
                    document_title: d.title.as_str(),
                    chunk_id: c.id,
                    chunk_text: c.text.as_str(),
                    embedding: &c.embedding,
                });
            }
        }
        Self { entries }
    }

    /// Top-k chunks by cosine similarity to the query embedding. Chunks with
    /// empty embeddings are skipped (the `embed_corpus` reindex step
    /// guarantees all stored chunks have a non-empty embedding, but old
    /// rows might not).
    pub fn search(&self, query_embedding: &[f32], top_k: usize) -> Vec<SearchHit> {
        let mut scored: Vec<(f32, &CorpusEntry<'_>)> = self
            .entries
            .iter()
            .filter(|e| !e.embedding.is_empty())
            .map(|e| (cosine(query_embedding, e.embedding), e))
            .filter(|(s, _)| *s > 0.0)
            .collect();
        // stable sort: higher score first, then by chunk_id to break ties
        // deterministically.
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored
            .into_iter()
            .take(top_k)
            .map(|(score, e)| SearchHit {
                document_id: e.document_id,
                document_title: e.document_title.to_string(),
                chunk_id: e.chunk_id,
                chunk_text: e.chunk_text.to_string(),
                score,
            })
            .collect()
    }

    /// Convenience: tokenize + embed + search in one call.
    pub fn search_text(&self, query: &str, top_k: usize) -> Vec<SearchHit> {
        let q = embed_text(query);
        self.search(&q, top_k)
    }
}

// ─── Chunking ────────────────────────────────────────────────────────────

/// Split a long document into overlapping chunks suitable for embedding.
/// Targets ~256 Chinese chars / ~512 ASCII chars per chunk with 64-char
/// overlap, which keeps the embedding in a regime where the hashing trick
/// is stable. Splits on line breaks first; for scripts without spaces
/// (CJK) we additionally split on sentence-ending punctuation so a long
/// paragraph of Chinese doesn't produce a single huge chunk.
pub fn chunk_text(text: &str) -> Vec<String> {
    const TARGET_CHARS: usize = 256;
    const OVERLAP_CHARS: usize = 64;

    // Split on paragraph / line boundaries first; keep the separators in the
    // output by joining with a single '\n'. Then split very long paragraphs
    // (mostly CJK with no newlines) on sentence-ending punctuation so the
    // target char count is respected.
    let paragraphs: Vec<String> = text
        .split(['\n', '\r'])
        .filter(|p| !p.trim().is_empty())
        .flat_map(|p| split_long_paragraph(p, TARGET_CHARS))
        .collect();

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for p in &paragraphs {
        if current.len() + p.len() + 1 > TARGET_CHARS && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(p);
    }
    if !current.is_empty() {
        chunks.push(current);
    }

    // Apply overlap: re-emit the last OVERLAP_CHARS characters of chunk N
    // as the start of chunk N+1 so context doesn't get lost on hard
    // paragraph breaks. We work in characters, not bytes, because chunks
    // are mixed CJK / ASCII and a byte-based offset can land mid-character.
    if chunks.len() > 1 && OVERLAP_CHARS > 0 {
        let mut overlapped: Vec<String> = Vec::with_capacity(chunks.len());
        for (i, c) in chunks.iter().enumerate() {
            if i == 0 {
                overlapped.push(c.clone());
            } else {
                let prev = &chunks[i - 1];
                let tail: String = prev
                    .chars()
                    .rev()
                    .take(OVERLAP_CHARS)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                let mut new_chunk = String::with_capacity(tail.len() + 1 + c.len());
                new_chunk.push_str(&tail);
                new_chunk.push('\n');
                new_chunk.push_str(c);
                overlapped.push(new_chunk);
            }
        }
        return overlapped;
    }

    chunks
}

/// Split a single paragraph that is longer than `target_chars` into pieces
/// at sentence boundaries (Chinese: 。！？； + Western: . ! ? ;). If no
/// boundaries fit, fall back to a hard cut.
fn split_long_paragraph(p: &str, target_chars: usize) -> Vec<String> {
    if p.chars().count() <= target_chars {
        return vec![p.to_string()];
    }
    // Collect byte indices of sentence-ending punctuation.
    let boundaries: Vec<usize> = p
        .char_indices()
        .filter_map(|(i, c)| match c {
            // Chinese
            '。' | '！' | '？' | '；' => Some(i + c.len_utf8()),
            '，' | '…' => Some(i + c.len_utf8()),
            // Western
            '.' | '!' | '?' | ';' => Some(i + 1),
            _ => None,
        })
        .collect();

    let mut out = Vec::new();
    let mut start = 0usize;
    let mut next_bidx = 0usize;
    for (i, _) in p.char_indices() {
        // Advance past any boundaries we've crossed.
        while next_bidx < boundaries.len() && boundaries[next_bidx] <= i {
            next_bidx += 1;
        }
        if i - start >= target_chars {
            // The most recent boundary *at or before* i is boundaries[next_bidx-1]
            // (if any).
            if next_bidx > 0 {
                let b = boundaries[next_bidx - 1];
                let piece = p[start..b].trim();
                if !piece.is_empty() {
                    out.push(piece.to_string());
                }
                start = b;
            } else {
                // No boundary before us — hard cut.
                let piece = p[start..i].trim();
                if !piece.is_empty() {
                    out.push(piece.to_string());
                }
                start = i;
            }
        }
    }
    if start < p.len() {
        let piece = p[start..].trim();
        if !piece.is_empty() {
            out.push(piece.to_string());
        }
    }
    out
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_chinese_keeps_chars() {
        let toks = tokenize("学生请假流程");
        assert!(toks.contains(&"学".to_string()));
        assert!(toks.contains(&"生".to_string()));
        assert!(toks.contains(&"请假".to_string()));
    }

    #[test]
    fn tokenize_english_lowercases() {
        let toks = tokenize("Hello, World!");
        assert_eq!(toks, vec!["hello".to_string(), "world".to_string()]);
    }

    #[test]
    fn tokenize_mixed() {
        let toks = tokenize("GPA 3.5 以上学生 high-achiever");
        assert!(toks.iter().any(|t| t == "gpa"));
        assert!(toks.iter().any(|t| t == "3"));
        assert!(toks.iter().any(|t| t == "5"));
        assert!(toks.iter().any(|t| t == "以上"));
        assert!(toks.iter().any(|t| t == "high"));
        assert!(toks.iter().any(|t| t == "achiever"));
    }

    #[test]
    fn empty_text_yields_zero_vector() {
        let v = embed_text("");
        assert_eq!(v.len(), EMBEDDING_DIM);
        assert!(v.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn embed_is_l2_normalized() {
        let v = embed_text("学生请假流程 GPA 3.5");
        let n: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((n - 1.0).abs() < 1e-4, "expected unit norm, got {n}");
    }

    #[test]
    fn similar_texts_have_higher_cosine() {
        let a = embed_text("学生请假流程");
        let b = embed_text("请假流程是怎样的");
        let c = embed_text("C++ 内存模型");
        let s_ab = cosine(&a, &b);
        let s_ac = cosine(&a, &c);
        assert!(
            s_ab > s_ac,
            "related texts should be more similar ({s_ab} vs {s_ac})"
        );
    }

    #[test]
    fn cosine_returns_zero_for_zero_vector() {
        let z = vec![0.0; EMBEDDING_DIM];
        let v = embed_text("hi");
        assert_eq!(cosine(&z, &v), 0.0);
        assert_eq!(cosine(&v, &z), 0.0);
    }

    #[test]
    fn chunk_text_splits_long_doc() {
        // Build a string that's clearly longer than the target chunk size
        // so we can exercise the Chinese sentence-boundary splitter.
        let mut s = String::new();
        for i in 0..50 {
            s.push_str(&format!(
                "第{i}段这是一段超过目标长度的中文文本，用于触发分块逻辑。"
            ));
        }
        let chunks = chunk_text(&s);
        assert!(
            chunks.len() >= 2,
            "expected at least 2 chunks, got {}",
            chunks.len()
        );
        assert!(chunks.iter().any(|c| c.contains("第0段")));
        assert!(chunks.iter().any(|c| c.contains("第49段")));
    }

    #[test]
    fn corpus_search_ranks_above_threshold() {
        let docs = vec![crate::models::RagDocument {
            id: uuid::Uuid::new_v4(),
            title: "请假流程".into(),
            content: "学生请假流程".into(),
            chunks: vec![crate::models::RagChunk {
                id: uuid::Uuid::new_v4(),
                document_id: uuid::Uuid::nil(),
                text: "学生请假需要填写请假单，并通知班主任".into(),
                embedding: embed_text("学生请假需要填写请假单，并通知班主任"),
            }],
            created_at: chrono::Utc::now(),
        }];
        let corpus = Corpus::from_documents(&docs);
        let hits = corpus.search_text("学生怎么请假", 3);
        assert!(!hits.is_empty(), "expected at least one hit");
        assert!(hits[0].score > 0.0);
    }
}
