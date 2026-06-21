# Changelog

All notable changes to **Education Advisor (egui)** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **CI workflow** (`.github/workflows/ci.yml`): `cargo fmt` + `clippy -D warnings` + matrix builds (Linux x64, Windows x64, macOS x64/arm64) + `cargo test` + `cargo audit`.
- **Multi-arch release pipeline** (`.github/workflows/release.yml`): Linux x64 + aarch64, Windows x64 + aarch64, macOS x64 + Apple Silicon. Each archive ships with a `.sha256` sidecar.
- **Tool registry** (`src/tools.rs`): one place to register a tool, including JSON-args validation, hard-cancel propagation, per-tool 15-second timeout, and a 16 KB args cap.
- **9 built-in tools** (up from 4): `lookup_student`, `get_student`, `search_students`, `get_grades`, `recent_grades`, `list_risk_students`, `count_students`, `dashboard_summary`, `rag_query`.
- **Keyboard shortcuts** (root window): `Ctrl/⌘+1…0` for navigation, `Ctrl/⌘+B` for sidebar, `Ctrl/⌘+K` for chat, `Ctrl/⌘+,` for settings, `Esc` to cancel AI generation.
- **StreamTool** event now keys by `(message_id, name)` so two `lookup_student` calls in the same assistant turn no longer collide.
- **Settings persistence** is now a round-trip: the `Settings` event delivered back from the runtime updates `app.settings` and re-applies the theme, so any UI element that reads settings between events sees the authoritative copy.

### Changed
- `ToolCallRecord` gained a `message_id: Uuid` field. Old persisted rows (without it) still deserialize (`#[serde(default)]`).
- `parse_tool_calls` now accepts both single- and double-quoted `args` and tolerates unterminated `<tool` tags (the rest of the stream is kept verbatim in the assistant's reply).
- Tool-execution feedback is emitted in two distinct phases (`Running` → `Success`/`Failed`), not collapsed into a single event.

### Security
- Tool args capped at 16 KB; oversized payloads are rejected with a `ToolStatus::Failed` and the agent gets an explanatory message.
- Aggregate tool result size is capped at 256 KB per turn to prevent context-window blow-ups.
- `Settings` event is no longer a no-op — it now mirrors the persisted state into the live UI.

## [1.0.2] — 2026-06-19

### Added
- 18-agent roster with first-class registry.
- 30+ LLM provider presets.
- Cron scheduler that runs agent turns on a schedule.
- AES-256-GCM encryption for `guardian_contact` and `api_key` fields.
- Per-render gradient background and refactored sidebar animation.

### Known limitations (being addressed in Unreleased)
- Hard-coded tool list (4 entries); see `Unreleased > Added > Tool registry`.
- No keyboard shortcuts.
- `StreamTool` dedup logic was order-dependent.

[Unreleased]: https://github.com/232252/education-advisor/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/232252/education-advisor/releases/tag/v1.0.2
