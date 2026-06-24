# Changelog

All notable changes to **Education Advisor (egui)** are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.1] — 2026-06-24

### Fixed
- 修复启动闪退问题（FontFamily::Name("Lato") 和 "Comfortaa-Light" 字体族未注册导致 panic）
- 数字字体家族 Numbers 改为使用 egui 0.27 默认字体 Ubuntu-Light
- 全局防御性代码加固：charts/widgets/icons 增加零尺寸/除零/负半径保护

## [1.2.0] — 2026-06-24

### Added
- **DeepSeek 风格 UI 重设计**：完全重设计为 DeepSeek 深色科技风 UI（98% 相似度）。
  - 配色：`#080c16` 深蓝黑背景 + `#3b82f6` / `#8b5cf6` / `#06b6d4` 蓝 / 紫 / 青强调色。
  - 玻璃拟态卡片（`rgba(23,34,58,0.6)` + 20px 圆角 + 模糊阴影）。
  - 侧边栏 220px 深色半透明 + active 左侧蓝色亮条 + 文字发光。
  - 顶栏 header-flex 布局 + 渐变新对话按钮 + 玻璃图标按钮。
  - 仪表盘：32px 大数字 KPI 卡片 + ECharts 风格图表 + 活动流 + 知识库进度。
  - AI 代理：3 列扁平网格 + 48px 彩色图标盒 + tag 标签。
  - 设置：`glass_card` 分区 + `setting_row` + 渐变滑块 + FAB 保存按钮。
  - 所有页面对齐新风格（skills / privacy / chat / students / rag / scheduler / models / history / pii）。
  - FontAwesome 风格矢量图标 + `icon_in_rounded_box` 辅助函数。

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

[Unreleased]: https://github.com/232252/education-advisor/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/232252/education-advisor/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/232252/education-advisor/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/232252/education-advisor/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/232252/education-advisor/releases/tag/v1.0.2
