# Changelog

All notable changes to **Education Advisor** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] — 2026-06-26

### Changed — UI framework migration: egui → iced 0.14

The application is now built on top of [`iced` 0.14](https://github.com/iced-rs/iced)
instead of `egui` 0.27. The new desktop shell lives in `iced-app/`. The 11 backend
modules (`agents`, `ai`, `audit`, `db`, `embedding`, `llm`, `models`, `pii_shield`,
`privacy`, `runtime`, `scheduler`, `students`, `tools`, `util`) are byte-identical
to the egui era — **no behaviour was changed**, only the rendering layer was rewritten.

- **Package rename**: `education-advisor-egui` → `education-advisor` (v2.0.0).
- **Binary rename**: `education-advisor-egui` → `education-advisor` (32 MB single-file).
- **Dependency churn**: removed `eframe`, `egui`, `egui_extras`, `tray-icon`;
  added `iced 0.14` with `tokio / advanced / image / svg` features.
- **System tray** (`feature = "tray"` on egui) is **not** yet available on iced
  0.14. Closing the window now quits the process; the feature gate stays wired
  so it can be re-enabled without touching the UI tree.

### Added — iced shell features

- **Three theme modes**: `Dark`, `Light`, `Auto` (auto follows the OS via
  `winreg` / `darkmode` crate).
- **Responsive layout**: `LayoutMode { Compact <900, Medium 900–1280, Wide ≥1280 }`
  re-computed every frame from the live window size via `iced::window::resize_events()`.
  Sidebar collapses, KPI grid reflows, chat tool panel docks differently per mode.
- **SVG icon system** (`src/ui/icons.rs`): 50+ inline `lucide`-style stroke icons
  that inherit `currentColor`, so the same set renders correctly in both themes.
- **Reusable component library** (`src/ui/components/`): `badge`, `kpi`,
  `capsule_bar`, `score_bar`, `section_header`, `empty_state`, `agent_card`,
  `sidebar_item`, `theme_picker`.
- **Event-pump bridge**: `Subscription::run_with(runtime_stream, …)` wakes every
  16 ms to drain events from the tokio runtime's `crossbeam-channel`, matching
  the previous `try_recv`-per-frame behaviour without touching the render loop.
- **Message-driven `Message` enum** (≈ 120 variants) routes every UI gesture to
  a `runtime::Command` or a pure local mutation; the 7 startup `LoadXxx` commands
  (`LoadStudents`, `LoadConversations`, `LoadTasks`, `LoadProviders`,
  `LoadRagDocuments`, `LoadStats`, `LoadSettings`) are issued from `App::new`.

### Removed

- `tray` feature gate (was `tray = ["dep:tray-icon"]`); see above.
- 11 `src/ui/*` files from the egui tree (now lives in `iced-app/src/ui/`).
- `src/charts.rs` (egui `Painter`-based) — replaced with inline SVG in
  `iced-app/src/ui/dashboard.rs` for KPI sparklines and the agent-activity
  HBarChart.

## [1.1.0] — 2026-06-24

### Added
- **UI v4.0 Premium Redesign**: complete visual overhaul across the entire application.
  - New gradient brand color system with `gradient_primary_from/to`, `gradient_purple`, `gradient_cyan`, `glow_accent`, and `glass_bg`.
  - Glassmorphism surfaces with translucent panels, diffused shadows, and layered gradient canvas backgrounds in both light and dark themes.
  - Redesigned Dashboard with `kpi_card`, staggered entrance animations, stacked capsule risk bars, gradient-filled area/line charts, skeleton loading, and empty-state CTAs.
  - Redesigned Agents page grouped by Teaching / Safety / Administration with category headers, larger gradient-icon cards, and role pill tags.
  - Redesigned Skills page with taller cards, gradient icons, hover-lift effects, and subtle skill-code labels.
  - Redesigned Privacy page with green shield iconography, `ghost_button` and `glow_button` actions, and color-coded left-border feature descriptions.
  - Redesigned Settings page with `custom_slider` controls, live numeric readouts, provider icon, and floating `fab_button` save action.
  - Micro-interactions: hover-lift cards, active sidebar indicator transitions, and 600 ms chart growth animations.
  - Global typography refresh: Chinese sans-serif (PingFang SC / Noto Sans SC) for body text, bold Lato/Roboto numerals for KPIs, scores, and percentages.
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

### Known limitations (addressed in 1.1.0)
- Hard-coded tool list (4 entries); see `1.1.0 > Added > Tool registry`.
- No keyboard shortcuts.
- `StreamTool` dedup logic was order-dependent.

[Unreleased]: https://github.com/232252/education-advisor/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/232252/education-advisor/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/232252/education-advisor/releases/tag/v1.0.2
