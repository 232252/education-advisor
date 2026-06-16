# 🎓 Education Advisor

> **Education Advisor — the Tauri-powered desktop of the open-source multi-agent education management system.**
> 18 specialized agents, privacy-preserving PII engine, cross-platform LLM orchestration, all wrapped in a 17MB native-feeling Rust+WebView app.

[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](./LICENSE-MIT)
[![Rust](https://img.shields.io/badge/rustc-1.95%2B-orange.svg)](https://www.rust-lang.org)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey.svg)](#-极速上手)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

**Linux x86_64** · **Windows x86_64** · **macOS x86_64 + Apple Silicon ARM64**

> 📖 **Read the full project introduction**: [`PROJECT_INTRO.md`](./PROJECT_INTRO.md)
> 🚀 **Just want to run it?** Jump to [Quick start](#-quick-start).
> 🤖 **Why is this open-source interesting?** Jump to [What makes it different](#-what-makes-it-different).
> 🦀 **v0.2.0 仓库转正**: 仓库已从 Electron 全面切换到 Tauri 2.0,详见 [`MIGRATION_REPORT.md`](./MIGRATION_REPORT.md)

---

## Table of contents

- [What is this?](#-what-is-this)
- [What makes it different?](#-what-makes-it-different)
- [Screenshots & tour](#-screenshots--tour)
- [Architecture at a glance](#-architecture-at-a-glance)
- [Quick start](#-quick-start)
- [The 18 agents](#-the-18-agents)
- [Built-in tools & features](#-built-in-tools--features)
- [Configuration](#-configuration)
- [Build, package, distribute](#-build-package-distribute)
- [Project layout](#-project-layout)
- [Privacy, security, and the Rust bridge](#-privacy-security-and-the-rust-bridge)
- [Contributing](#-contributing)
- [Roadmap](#-roadmap)
- [FAQ](#-faq)
- [License & acknowledgments](#-license--acknowledgments)

---

## 🧭 What is this?

**Education Advisor** is a **cross-platform desktop application** (Tauri 2.0 + Rust + React 18 + TypeScript 5.7) — the **desktop upgrade** of [`education-advisor`](https://github.com/232252/education-advisor), the same open-source multi-agent system, now wrapped in a native-feeling UI. The previous v3.x release was a CLI-only Rust project; the v0.1.0 release ported it to a desktop GUI (Electron 33). From v0.2.0, the entire backend is a single Rust binary (no Node.js main process). The Rust `eaa-cli` (the data engine) is statically linked as `eaa_core` — no subprocess spawn, no IPC overhead.

In plain English:

> If you are a **class teacher (班主任)** in a Chinese high school or middle school, and you spend too much of your day keeping track of "+2 / -3" conduct points, writing parent messages, generating weekly reports, and following up on at-risk students — **this app gives you a desktop cockpit** for all of that, powered by 18 cooperating AI agents that talk to your local data, your choice of LLM provider, and (optionally) a Feishu (Lark) workspace.

It is **not a chat bot**. It is **not a SaaS**. It is a **local-first desktop tool** that:

- Reads & writes a **Rust event-sourced event store** (the EAA CLI) — every action is auditable, every event is append-only, the data is yours.
- Runs **18 specialized agents** on schedule (cron) or on demand — each one has a clear role (academic, psychology, safety, weekly report, …) and a tight set of permissions.
- Encrypts **all PII** (student names, IDs, phone numbers, addresses) with **AES-256-GCM** before anything leaves the machine.
- Speaks to **30+ LLM providers** through the in-tree Rust LLM service (`src-tauri/src/services/llm_service.rs`) — including OpenAI, Anthropic, Google, Mistral, DeepSeek, Qwen, Doubao, Zhipu, Ollama, LM Studio, and any OpenAI-compatible endpoint.
- Syncs to **Feishu Bitable** so the whole teaching team can see the same numbers in the same spreadsheet.
- Ships as a **Windows installer (NSIS) and a portable .exe** out of the box, with macOS / Linux targets one config flip away.

---

## ✨ What makes it different?

There are a lot of "AI for education" tools. Here's what we think is genuinely different about this one:

### 1. **Truly local-first, with a Rust spine**
Every byte of student data lives in a Rust-managed event store on your disk. The LLM is the only thing that talks to the network, and only with the slice of data it needs. The Rust CLI handles **all** reads, writes, validation, concurrency (file locks), atomic persistence (`tmp → fsync → rename`), and PII encryption. The AI layer is intentionally **stateless and replaceable** — you can swap out GPT-4o for Qwen 4B, run the same agents, get the same data, pay nothing per query.

### 2. **18 cooperating agents, not one chat**
The 18 agents aren't "personalities" — they are **role-defined worker bees** with explicit permission scopes:

- `class-monitor` records a +2 / −3 conduct point
- `risk-alert` correlates 14-day trends and flags a kid who's slipping
- `weekly-reporter` drafts Friday's class report
- `validator` cross-checks that `class-monitor`'s math matches the event log
- `psychology` watches for warning signs and never **writes** events — only flags

This is closer to a **teaching-team operating system** than a chatbot.

### 3. **The "small model rulebook"**
We deliberately designed every agent's prompt to work with **3–4B parameter models**. Run Qwen 3.5 4B on a 6 GB GPU and the system still works — because the agents are constrained by **tools, not by vibes**. Every number must come from a tool call, every write must be authorized, every output is validated against a JSON schema. See [`config/SMALL_MODEL_RULES.md`](./config/SMALL_MODEL_RULES.md) for the 5 ironclad rules.

### 4. **PII is opt-in, reversible, and audited**
Privacy is not a checkbox. The Rust PII engine builds a per-install **encrypted mapping table** (AES-256-GCM) from "Alice" to `S_017`, and exposes 11 IPC operations: `init`, `load`, `enable`, `disable`, `list`, `add`, `anonymize`, `deanonymize`, `filter` (per recipient!), `dryrun`, `backup`. You can hand an LLM your entire class list anonymized, then re-hydrate names only in the final report that goes to a parent.

### 5. **Reproducible builds, no surprises**
`npm ci` → `npm run build:renderer` → `npm run tauri:build` produces a byte-identical Windows installer (modulo timestamps) on any Windows machine with Node 22 + Rust 1.95+. No hidden system state, no opaque installers, no "magic" native modules beyond `rusqlite` and the Rust EAA core. The whole supply chain is in this repo.

---

## 📸 Screenshots & tour

> _Screenshots will be added in the first release tag. The product pages are:_

| Page | Route | Purpose |
| --- | --- | --- |
| **Dashboard** | `#/dashboard` | Top-line numbers: today's events, weekly trends, top movers |
| **Chat** | `#/chat` | Talk to any agent, stream responses, full tool-call visibility |
| **Students** | `#/students` | Roster, conduct scores, history, profile expansion |
| **Agents** | `#/agents` | The 18-agent control panel — enable, disable, edit SOUL.md |
| **Models** | `#/models` | LLM providers, API keys, custom models, model tier assignment |
| **Skills** | `#/skills` | Markdown-defined "skills" that get injected into agent prompts |
| **Scheduler** | `#/scheduler` | Cron jobs across all agents, logs, manual triggers |
| **Privacy** | `#/privacy` | PII mapping table, anonymization, per-recipient filtering |
| **Settings** | `#/settings` | Theme, language, log level, update channel, factory reset |

---

## 🏗️ Architecture at a glance

```
┌──────────────────────────────────────────────────────────────────┐
│                 Renderer (React 18 + Vite + Tailwind)            │
│  Dashboard · Chat · Students · Agents · Models · Skills · ...    │
│  Zustand stores · i18n (zh/en) · 9 routes · 12 hooks             │
└────────────────────────┬─────────────────────────────────────────┘
                         │  invoke / listen  (Tauri command/event)
                         │  90+ IPC channels · 1 type-safe surface
┌────────────────────────▼─────────────────────────────────────────┐
│                  Tauri 2.0  (Rust main process)                  │
│                                                                  │
│  13 commands ── 13 services ── SQLite (rusqlite)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐  │
│  │ llm_service │  │  eaa_core   │  │   SQLite    │  │ Tray /  │  │
│  │ 30+ LLM     │  │  Rust lib   │  │ chat / cron │  │ Auto-   │  │
│  │ providers   │  │  in-process │  │ logs /agent │  │ update  │  │
│  └─────────────┘  └──────┬──────┘  └─────────────┘  └─────────┘  │
│         18 agents ────────┘                                      │
│  governed by config/agents.yaml · triggered by tokio-cron-scheduler
└──────────────────────────────────────────────────────────────────┘
```

Read the full architecture breakdown in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 🚀 Quick start

> **Prerequisites**: Node.js ≥ 22, npm ≥ 10, Rust ≥ 1.95.0.

### 1. Clone & install

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
npm ci
```

### 2. The Rust backend

The Rust `eaa-cli` data engine lives in `core/eaa-cli/` of this same
`education-advisor` project. It is statically linked into the Tauri binary
as `eaa_core`; you do not need to download or build it separately.

The first `npm run tauri:dev` will compile the workspace automatically.
If you want to compile only the Rust side:

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```

See [`docs/EAA_BRIDGE.md`](./docs/EAA_BRIDGE.md) for the command mapping.

### 3. Run in development mode

```bash
npm run tauri:dev
```

This single command (run from the repo root):

- Starts `vite --config vite.config.renderer.ts` (HMR for the React renderer) on `http://localhost:5190`
- Compiles the Rust backend (Tauri main process) and launches the native window
- Auto-refreshes on Rust / React file changes

> **First run** downloads ~400 Rust crates (≈ 5-10 min via proxy); subsequent runs are < 10s incremental.

### 4. Build a release

```bash
npm run tauri:build
# Linux:   src-tauri/target/release/bundle/{deb,appimage}/
# Windows: src-tauri/target/release/bundle/{nsis,msi}/
# macOS:   src-tauri/target/release/bundle/{dmg,app}/
```

> macOS bundles need Apple Developer credentials to be code-signed & notarized
> (otherwise Gatekeeper blocks first launch). See [`src-tauri/docs/05-BUILD-RUN.md`](./src-tauri/docs/05-BUILD-RUN.md) §6.

### 5. First-run checklist

When the app opens, go to `#/settings` and:

- Pick a theme (light / dark / system) and a language (中文 / English).
- Add at least one LLM API key in `#/models`.
- (Optional) Configure Feishu credentials in `#/settings` → Feishu panel.
- (Optional) Initialize the privacy engine in `#/privacy`.

Then visit `#/agents`, click **Run manual** on `class-monitor`, and add a conduct event. The whole pipeline will fire end-to-end.

---

## 🤖 The 18 agents

Every agent is a **plain Markdown file pair** — `SOUL.md` (personality + scope) and `AGENTS.md` (working rules) — plus a YAML registration entry in [`config/agents.yaml`](./config/agents.yaml). The main process loads them on boot, decorates them with the small-model rulebook, and registers them with the agent loop.

| # | Agent | Role | Tier | Cadence | Capability scope |
|---|-------|------|------|---------|------------------|
| 1 | `main` | Education advisor coordinator | high-quality | on demand | All read + push + scheduling |
| 2 | `governor` | Inspector general (复盘 + 校验) | low-cost | 6× daily + weekly | read · summary · range · stats · ranking |
| 3 | `counselor` | Counselor (谈话计划 + 学业日报) | low-cost | 2× daily | read · summary · ranking · add-event |
| 4 | `supervisor` | Daily digest officer | low-cost | 3× daily | read · summary · ranking · stats · range |
| 5 | `validator` | Data auditor | low-cost | every 6h | read · stats · codes |
| 6 | `academic` | Academic analyst | high-quality | 1× daily | read · summary · stats · ranking |
| 7 | `psychology` | Psychology watcher | low-cost | 1× daily | read · search · history · summary |
| 8 | `safety` | Safety inspector | low-cost | Mon 08:00 | read · add-event |
| 9 | `home_school` | Family-school liaison | low-cost | 1× daily | read · summary · ranking |
| 10 | `research` | Research assistant | low-cost | 1× nightly | read · summary · stats |
| 11 | `executor` | System executor | low-cost | 1× nightly | read · stats · codes |
| 12 | `bug-hunter` | Bug hunter (agent self-test) | low-cost | on demand | read only |
| 13 | `class-monitor` | Class monitor | low-cost | on demand | read · add-event · list · summary |
| 14 | `risk-alert` | Risk alerter | low-cost | 2× daily + Fri | read · ranking · stats · summary · range |
| 15 | `data-analyst` | Data analyst | high-quality | Mon 09:00 | read · stats · ranking · summary · range |
| 16 | `student-care` | Student-care officer | low-cost | on demand | read · history · search · list · ranking · summary · add-event |
| 17 | `discipline-officer` | Discipline officer | low-cost | on demand | read · add-event · ranking · history |
| 18 | `weekly-reporter` | Weekly reporter | high-quality | Fri 16:00 | read · summary · stats · ranking · range |

Writing a new agent? Read [`docs/AGENT_AUTHORING.md`](./docs/AGENT_AUTHORING.md).

---

## 🛠️ Built-in tools & features

- **Multi-LLM orchestration** — 30+ providers through the Rust `llm_service`, model-tier routing (high-quality vs low-cost), per-agent cost caps, custom-model registration, OAuth login, automatic failover, retry with backoff.
- **Streaming chat** — full Server-Sent-Event-style streaming from the LLM to the renderer, with abort, follow-up, and steering modes.
- **Compaction** — automatic context compaction when the conversation window fills up, with a configurable threshold.
- **Cron scheduler** — `tokio-cron-scheduler` with hot-reload, manual `run now`, per-task log, and Feishu Bitable sync hooks.
- **SQLite persistence** — `rusqlite` for chat history, cron logs, agent execution history, session metadata. Schema is auto-migrated on first run.
- **System tray** — show / hide / quit, balloon notifications, "minimize to tray on close" option.
- **Auto-update** — checks the GitHub Releases endpoint on a configurable interval, prompts the user, downloads in the background, applies on next launch.
- **Logging** — 5-level logger (`debug` / `info` / `warn` / `error` / `fatal`), 3 rotating files, console hijack for the renderer, level filtering, full-text search, export to file.
- **i18n** — full Chinese / English support across all 9 pages, 200+ keys, hot-swap at runtime, persisted in localStorage.
- **Theming** — light / dark / system-follows-OS, CSS variables, no FOUC.
- **Keyboard shortcuts** — `Ctrl+N` (new chat), `Enter` (send), `Esc` (abort), navigation hotkeys, all remappable in Settings.
- **File sandboxing** — all file writes go through a tool layer that sanitizes paths, blocks `..` traversal, and respects a per-call working directory.
- **Excel / CSV import-export** — drag a spreadsheet onto the Students page and the Rust side will parse, validate, and bulk-insert. Export handles proper Chinese encodings and BOM.

---

## ⚙️ Configuration

The app reads its configuration from three places, in order of precedence (highest first):

1. **In-app Settings page** (`#/settings`) — runtime config, persisted to `userData/settings.json`.
2. **`config/` directory** in the installation — defaults shipped with the app. Editable on disk.
3. **Hard-coded fallbacks** in `src/main/services/settings-service.ts` — for first-run.

The shipped [`config/agents.yaml`](./config/agents.yaml) is the canonical registry of all 18 agents — their `id`, `role`, `model_tier`, `capabilities` (least-privilege), `schedule.cron`, and `risk_thresholds`. Open it in any editor; it's a single file you can read top to bottom in five minutes.

For a deep dive, see [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md).

---

## 📦 Build, package, distribute

| Command | Output | Purpose |
| --- | --- | --- |
| `npm run tauri:dev` | dev server on `:5190` + native window | Day-to-day development with HMR |
| `npm run tauri:build` | `src-tauri/target/release/bundle/**` | Production installer for current OS |
| `npm run tauri:build:debug` | debug build, no LTO/strip | Faster iteration on installer packaging |
| `npm run build:renderer` | `dist/renderer/*` | Renderer-only build (used by tauri:build) |
| `npm run typecheck` | exit code | `tsc --noEmit` |
| `npm run lint` | exit code | `biome check src/` |
| `npm run test` | test report | `vitest run` |
| `npm run cargo:check` | exit code | `cargo check --lib` on `src-tauri/` |
| `npm run cargo:test` | test report | `cargo test` on `src-tauri/` (108 tests) |
| `npm run clean` | — | `rimraf dist release src-tauri/target src-tauri/gen` |

For cross-platform packaging (e.g. building macOS bundle on Linux), use the CI workflow
[`.github/workflows/release.yml`](./.github/workflows/release-tauri.yml) — it builds 3
platforms in parallel on tag push. See [`src-tauri/docs/05-BUILD-RUN.md`](./src-tauri/docs/05-BUILD-RUN.md)
for the full guide.

---

## 📁 Project layout

```
education-advisor/
├── src/
│   ├── renderer/            # React 18 renderer
│   │   ├── pages/           #   9 page modules
│   │   ├── components/      #   shared UI
│   │   ├── hooks/           #   12 custom hooks
│   │   ├── stores/          #   4 Zustand stores
│   │   ├── i18n/            #   zh + en
│   │   ├── lib/             #   typed Tauri IPC client
│   │   └── main.tsx         #   renderer entry
│   └── shared/              # Code shared by renderer + Rust backend
│       ├── ipc-channels.ts  #   90+ channel constants
│       └── types/           #   shared TypeScript types
├── src-tauri/               # Rust backend (Tauri 2.0)
│   ├── src/commands/        #   #[tauri::command] handlers
│   ├── src/services/        #   13 service modules (agent, EAA, cron, ...)
│   ├── src/tools/           #   agent tool implementations
│   ├── src/lib.rs           #   crate library root
│   ├── src/main.rs          #   Tauri builder entry
│   └── Cargo.toml           #   workspace manifest
├── agents/                  # 18 agents × (SOUL.md + AGENTS.md)
├── config/                  # agents.yaml, reason-codes.json, default-settings.json
├── core/eaa-cli/            # Rust data engine (linked as eaa_core)
├── docs/                    # Full documentation (see /docs)
├── resources/               # Icons
├── scripts/                 # Dev-time helper scripts
├── skills/                  # User-injected Markdown skills
├── single-agent/            # "Single-agent mode" fallback prompt
├── examples/                # Example student records (anonymized)
├── tests/                   # Vitest suites (renderer only)
├── archive/legacy/          # Electron-era source code archive
├── vite.config.renderer.ts  # Renderer Vite config
├── vitest.config.ts         # Vitest config
├── biome.json               # Linter + formatter config
├── tsconfig.json            # TS config with path aliases
├── .env.example             # Environment-variable template
├── .editorconfig            # Editor defaults
├── .gitignore               # Comprehensive ignore rules
├── CHANGELOG.md             # Version history
├── CODE_OF_CONDUCT.md       # Community standards
├── CONTRIBUTING.md          # How to contribute
├── DEPLOY_TO_AI.md          # AI-assisted setup guide
├── LICENSE                  # MIT
├── PROJECT_INTRO.md         # Detailed project introduction
├── README.md                # You are here
├── ROADMAP.md               # Future plans
└── SECURITY.md              # Security policy
```

---

## 🛡️ Privacy, security, and the Rust bridge

The Rust EAA CLI is the data engine of this app. In v0.2.0 it is no longer spawned as a
child process — it is statically linked as `eaa_core` inside the Tauri binary. The source
lives in [`core/eaa-cli/`](https://github.com/232252/education-advisor/tree/main/core/eaa-cli)
of the same `education-advisor` repository.

1. **Separation of concerns.** The Rust side is a stable, audited data engine. The TS side
   is the renderer. Keeping the engine as a separate crate lets it be reviewed and re-used
   independently.
2. **Reproducible builds.** `cargo build` compiles the workspace from source, including
   `eaa_core`. See [`docs/EAA_BRIDGE.md`](./docs/EAA_BRIDGE.md) for the command mapping.

For the full security policy — including the PII engine's threat model, our CVE reporting
process, and supported versions — see [`SECURITY.md`](./SECURITY.md).

---

## 🤝 Contributing

We welcome pull requests, bug reports, feature requests, and translations. Start with
[`CONTRIBUTING.md`](./CONTRIBUTING.md); it covers the developer workflow, the coding
standards, the commit-message format, and how to add a new agent. By participating, you
agree to abide by the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

**Good first issues** are tagged [`good first issue`](https://github.com/232252/education-advisor/issues?q=is%3Aopen+label%3A%22good+first+issue%22)
in the issue tracker.

---

## 🗺️ Roadmap

The 12-month plan is in [`ROADMAP.md`](./ROADMAP.md). Highlights:

- **Q3 2026** — Multi-class support (one teacher, N parallel classes)
- **Q4 2026** — macOS & Linux release tiers, signed installers, auto-update channel
- **Q1 2027** — Plugin marketplace for community-contributed agents & skills
- **Q2 2027** — Voice channel (push-to-talk during class) with on-device transcription

---

## ❓ FAQ

**Q: Is this a Chinese-only product?**
A: The UI and the data (student names, classes, schools) are inherently Chinese. The code, the prompts, and the developer documentation are bilingual. The agent prompts can be edited to any language.

**Q: Does it work without the internet?**
A: The app works fully offline. Only the LLM calls need network. If you point it at Ollama / LM Studio on `localhost`, the whole stack runs offline.

**Q: Can I delete the Rust EAA dependency?**
A: Yes — every EAA call goes through `src-tauri/src/commands/eaa.rs`, which is a thin wrapper around `eaa_core` (the `core/eaa-cli/` library). You can swap it for any other data engine (PostgreSQL, Firestore, your own service) by replacing those wrappers. The agent prompts and the UI are decoupled. The `eaa_core` library is statically linked — no subprocess, no IPC overhead.

**Q: How big is the bundled installer?**
A: ~17 MB (Tauri installer with LTO + strip) — vs Electron's ~85 MB. The Rust binary is statically linked with the WebView pulled from the OS, so there's no Chromium runtime shipped. See [comparison table](#-why-not-electron).

**Q: How do I add a new agent?**
A: Read [`docs/AGENT_AUTHORING.md`](./docs/AGENT_AUTHORING.md). The TL;DR: drop a `SOUL.md` and an `AGENTS.md` into `agents/your-id/`, add an entry to `config/agents.yaml`, restart the app. That's it.

---

## 📄 License & acknowledgments

This project is released under the [MIT License](./LICENSE). You are free to use it in
commercial products, in schools, in research, and to fork it.

**Acknowledgments**

- The [Tauri](https://tauri.app/) project — the Rust-based desktop framework used in v0.2.0.
- The [React](https://react.dev/) / [Vite](https://vitejs.dev/) / [Tailwind CSS](https://tailwindcss.com/) ecosystems — the renderer stack.
- The Rust [`tokio`](https://tokio.rs/) / [`serde`](https://serde.rs/) / [`clap`](https://clap.rs/)
  / [`rusqlite`](https://github.com/rusqlite/rusqlite) crates that the EAA CLI and Tauri backend are built on.
- Every teacher who has ever lost sleep over a "+2 conduct point that should have been +3"
  — this app is for you.

---

**If this project helps you, please ⭐ star the repo — it helps others find it.**
**让教育更智能，让教师更轻松。**
