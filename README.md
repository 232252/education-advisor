# Education Advisor (egui)

> Commercial-grade AI education management desktop application, built end-to-end in Rust + [egui](https://github.com/emilk/egui).

[![CI](https://github.com/232252/education-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/232252/education-advisor/actions/workflows/ci.yml)
[![Release](https://github.com/232252/education-advisor/actions/workflows/release.yml/badge.svg)](https://github.com/232252/education-advisor/actions/workflows/release.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](./LICENSE)

## ✨ Highlights

- **18 specialized AI agents** (counselor, psychology, risk-alert, weekly-reporter, …) sharing one ReAct orchestration loop
  - Full per-agent personas + work rules are recovered from
    [`v0.1.0-rc.1`](https://github.com/232252/education-advisor/releases/tag/v0.1.0-rc.1)
    under `agents/<id>.md` (4 400+ lines of canonical prompts).
  - All agents are required to obey `config/SMALL_MODEL_RULES.md`
    (防幻觉铁律 + 禁止心算 + 强制工具计算) — inlined in every
    system prompt.
  - Discipline / counselor / weekly-reporter agents also receive the
    `config/reason-codes.json` catalogue (SPEAK_IN_CLASS, LATE, …).
- **30+ LLM providers** out of the box: OpenAI, Anthropic, Gemini, OpenRouter, Ollama, LM Studio, vLLM, Groq, DeepSeek, Zhipu, Doubao, Moonshot, Azure OpenAI, any OpenAI-compatible endpoint
- **Streaming chat** with tool-call timeline, abort-able from anywhere
- **Local-first privacy**:
  - **PII Shield 假名化引擎** (recovered from v0.1.0-rc.1) — real
    names → `S_001` / `P_001` etc. deterministic aliases; AI never
    sees plaintext. AES-256-GCM encrypted mapping at
    `<data-dir>/privacy/mapping.enc` (key derived from your
    password; lost password ⇒ lost mappings, by design).
  - **定向发送过滤器** — when composing a message "to 张三妈妈"
    other students' real names are replaced with "其他同学".
  - **Regex PII redaction** — phone / ID / email masked on every
    outbound prompt.
  - **AES-256-GCM** at rest for guardian contacts and provider
    API keys (per-install random salt, see `src/privacy.rs`).
- **Offline knowledge base** with a built-in RAG tool (`rag_query`) the agents can call
- **Cron scheduler** that wakes every 30 s, fires tasks, and creates a fresh conversation per run
- **System tray** (optional feature) with show / hide / quit
- **Persistent UI state** — window geometry, theme, sidebar, last active page survive restarts
- **Single binary**, ~17 MB installed, zero Electron, zero Node.js

## 📁 Project assets (recovered from v0.1.0-rc.1)

```
agents/<id>.md          18 persona + rule files (recovered verbatim)
config/SMALL_MODEL_RULES.md   Compliance rules every agent must follow
config/reason-codes.json      School behaviour-code catalogue
config/agents.yaml            Agent capability declarations
config/default-settings.json  Default UI/runtime settings
skills/STUDENT_MANAGEMENT.md  The "student management" skill body
```

These ship alongside the binary and are loaded at runtime by
`src/agents.rs` and `src/ai.rs`.

## 🖥️ Platform support

| Platform | Architecture | Tray | Headless |
|---|---|---|---|
| Linux    | x86_64       | ✅   | ✅       |
| Linux    | aarch64      | —    | ✅       |
| macOS    | x86_64       | ✅   | ✅       |
| macOS    | Apple Silicon| ✅   | ✅       |
| Windows  | x86_64       | ✅   | ✅       |
| Windows  | aarch64      | —    | ✅       |

> "Headless" = the `tray` feature is disabled; everything else works identically.

## ⌨️ Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + 1` … `Ctrl/⌘ + 0` | Jump to the *n*-th navigation slot |
| `Ctrl/⌘ + B` | Toggle sidebar |
| `Ctrl/⌘ + K` | Jump to Chat |
| `Ctrl/⌘ + ,` | Open Settings |
| `Esc` | Cancel any in-flight AI generation |

## 🛠️ Build from source

### Prerequisites

- **Rust 1.76 or newer** ([rustup](https://rustup.rs))
- **Linux only**: `apt install libx11-dev libxi-dev libxext-dev libxrandr-dev libgl1-mesa-dev libasound2-dev libudev-dev libgtk-3-dev libappindicator3-dev`
- **Windows only**: Visual Studio Build Tools 2022 with the "Desktop development with C++" workload
- **macOS only**: Xcode command-line tools

### Build

```bash
# Default (no tray)
cargo build --release

# With system tray
cargo build --release --features tray
```

The resulting binary lives at `target/release/education-advisor-egui` (or `.exe` on Windows).

### Test

```bash
cargo test --all-features
```

### Format & lint

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --no-features -- -D warnings
```

## 🤖 Configure an LLM provider

The app is fully functional offline (with Ollama) but you can also point it at any cloud provider. The fastest path:

1. Launch the app.
2. Open **设置** (Settings) → **AI 行为** → **提供商** → **+ 新建**.
3. Pick a preset (OpenAI / DeepSeek / Anthropic / Ollama / …) or use a custom OpenAI-compatible endpoint.
4. Paste your API key — it is encrypted with AES-256-GCM before touching the SQLite store.
5. Tick **启用** and click **保存**.

The active provider is selected from the **当前** dropdown at the top of the providers card.

## 🧠 Available tools (visible to agents)

| Name | Purpose |
|---|---|
| `lookup_student` | Find a student by name (substring) |
| `get_student` | Get a full student record by UUID |
| `search_students` | Substring search over name/grade/class/tags |
| `get_grades` | All grades for a student |
| `recent_grades` | Last N grades across the school |
| `list_risk_students` | List high / critical risk students |
| `count_students` | Total + risk distribution |
| `dashboard_summary` | Dashboard stats for the home page |
| `rag_query` | Query the local knowledge base |

All tools enforce a **15-second timeout** and a **16 KB args cap**; oversized or unknown calls are reported back to the agent instead of crashing.

## 🗃️ Data layout

All state lives in a single SQLite file at:

| OS | Path |
|---|---|
| Linux   | `~/.local/share/education-advisor/ea.db` |
| macOS   | `~/Library/Application Support/education-advisor/ea.db` |
| Windows | `%APPDATA%\education-advisor\ea.db` |

Window geometry and theme are mirrored in eframe's standard `app.json` so they survive re-installs of the binary itself.

## 🏗️ Architecture (1-minute tour)

```
┌──────────────┐   commands  ┌──────────────┐   LLM HTTP   ┌──────────┐
│  egui UI     │ ──────────▶ │  tokio       │ ──────────▶  │ OpenAI / │
│  (main       │             │  runtime     │              │ Anthropic│
│   thread,    │   events    │  thread      │              │ Ollama / │
│   60/120 fps)│ ◀────────── │              │ ◀──────────  │ …        │
└──────────────┘             └──────┬───────┘              └──────────┘
                                    │
                            ┌───────▼────────┐
                            │   SQLite       │
                            │   + AES-GCM    │
                            │   + cron sched │
                            └────────────────┘
```

- **Single-threaded UI** — no async on the render path
- **Lock-free channels** for UI ↔ runtime messaging
- **One tokio task per command** — runtime never blocks
- **Hard-cancel** via `CancellationToken` registered in `AppState.active_streams`

## 🤝 Contributing

PRs welcome. Please run `cargo fmt` and `cargo clippy` before pushing; CI will refuse PRs that fail either.

## 📜 License

Dual-licensed under either of:

- Apache License, Version 2.0 ([LICENSE-APACHE](./LICENSE-APACHE))
- MIT license ([LICENSE](./LICENSE))

at your option.
