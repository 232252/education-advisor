# 🎓 Education Advisor

> **Education Advisor — the desktop upgrade of the open-source multi-agent education management system.**
> Same project, new platform. 18 specialized agents, privacy-preserving PII engine, cross-platform LLM orchestration, and full local-first data ownership.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/electron-33-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Rust backend](https://img.shields.io/badge/backend-Rust%20%2B%20eaa--cli-DEA584?logo=rust&logoColor=black)](https://github.com/232252/education-advisor)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![Code of Conduct](https://img.shields.io/badge/Contributor%20Covenant-2.1-4baaaa.svg)](./CODE_OF_CONDUCT.md)

> 📖 **Read the full project introduction**: [`PROJECT_INTRO.md`](./PROJECT_INTRO.md)
> 🚀 **Just want to run it?** Jump to [Quick start](#-quick-start).
> 🤖 **Why is this open-source interesting?** Jump to [What makes it different](#-what-makes-it-different).

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

**Education Advisor** is a **cross-platform desktop application** (Electron 33 + React 18 + TypeScript 5.7) — the **desktop upgrade** of [`education-advisor`](https://github.com/232252/education-advisor), the same open-source multi-agent system, now wrapped in a native-feeling UI. The previous v3.x release was a CLI-only Rust project; this v0.1.0 release is the same system, ported to a desktop GUI. The Rust `eaa-cli` is the data engine that powers it under the hood.

In plain English:

> If you are a **class teacher (班主任)** in a Chinese high school or middle school, and you spend too much of your day keeping track of "+2 / -3" conduct points, writing parent messages, generating weekly reports, and following up on at-risk students — **this app gives you a desktop cockpit** for all of that, powered by 18 cooperating AI agents that talk to your local data, your choice of LLM provider, and (optionally) a Feishu (Lark) workspace.

It is **not a chat bot**. It is **not a SaaS**. It is a **local-first desktop tool** that:

- Reads & writes a **Rust event-sourced event store** (the EAA CLI) — every action is auditable, every event is append-only, the data is yours.
- Runs **18 specialized agents** on schedule (cron) or on demand — each one has a clear role (academic, psychology, safety, weekly report, …) and a tight set of permissions.
- Encrypts **all PII** (student names, IDs, phone numbers, addresses) with **AES-256-GCM** before anything leaves the machine.
- Speaks to **30+ LLM providers** through the bundled [`@earendil-works/pi-ai`](https://www.npmjs.com/) SDK — including OpenAI, Anthropic, Google, Mistral, DeepSeek, Qwen, Doubao, Zhipu, Ollama, LM Studio, and any OpenAI-compatible endpoint.
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
`npm ci` → `npm run build` → `npm run package` produces a byte-identical Windows installer (modulo timestamps) on any Windows machine with Node 22. No hidden system state, no opaque installers, no "magic" native modules beyond `better-sqlite3` and the Rust EAA binary. The whole supply chain is in this repo.

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
                         │  contextBridge  (window.api, 11 namespaces)
                         │  90+ IPC channels · 1 type-safe surface
┌────────────────────────▼─────────────────────────────────────────┐
│                  Main (Node 22 + Electron 33)                    │
│                                                                  │
│  11 IPC handlers ── 13 services ── 4 Zustand-like stores         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐  │
│  │ pi-ai SDK   │  │  EAA bridge │  │ SQLite (db) │  │ Tray /  │  │
│  │ 30+ LLM     │  │  Rust child │  │ chat / cron │  │ Auto-   │  │
│  │ providers   │  │  process    │  │ logs /agent │  │ update  │  │
│  └─────────────┘  └──────┬──────┘  └─────────────┘  └─────────┘  │
│         18 agents ────────┘                                      │
│  governed by config/agents.yaml · triggered by node-cron         │
└────────────────────────┬─────────────────────────────────────────┘
                         │  stdin/stdout JSON  +  file lock
┌────────────────────────▼─────────────────────────────────────────┐
│         eaa-cli  (Rust · events · privacy · dashboard)           │
│   https://github.com/232252/education-advisor  (same project)   │
└──────────────────────────────────────────────────────────────────┘
```

Read the full architecture breakdown in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 🚀 Quick start

> **Prerequisites**: Node.js ≥ 22, npm ≥ 10, a working C++ toolchain on your platform (so `better-sqlite3` can build its native binding).

### 1. Clone & install

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
npm ci
```

### 2. Fetch the Rust backend

The Rust `eaa-cli` binary is the data engine of this same `education-advisor`
project — it is the same Rust code that powered the v3.x CLI-only release,
shipped to this desktop app as a pre-built binary per platform.

```bash
npm run build:eaa
```

This downloads the latest release of `eaa-cli` for your platform into `resources/eaa-binaries/`.
You can also build it yourself from source — see [`docs/EAA_BRIDGE.md`](./docs/EAA_BRIDGE.md).

### 3. Run in development mode

```bash
npm run dev
```

This starts three processes in parallel:

- `vite --config vite.config.main.ts --watch` — building the main process bundle
- `vite --config vite.config.renderer.ts` — the renderer dev server on `http://localhost:5173`
- (you can then run `npm run dev:electron` in a second terminal to launch the Electron shell)

### 4. Build a release

```bash
npm run build           # vite build × 2 configs
npm run package         # electron-builder → release/Education Advisor-Setup-0.1.0.exe (NSIS)
npm run package:portable # single-file .exe (no installer)
```

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

- **Multi-LLM orchestration** — 30+ providers through `pi-ai`, model-tier routing (high-quality vs low-cost), per-agent cost caps, custom-model registration, OAuth login, automatic failover, retry with backoff.
- **Streaming chat** — full Server-Sent-Event-style streaming from the LLM to the renderer, with abort, follow-up, and steering modes.
- **Compaction** — automatic context compaction when the conversation window fills up, with a configurable threshold.
- **Cron scheduler** — `node-cron` with hot-reload, manual `run now`, per-task log, and Feishu Bitable sync hooks.
- **SQLite persistence** — `better-sqlite3` for chat history, cron logs, agent execution history, session metadata. Schema is auto-migrated on first run.
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
| `npm run dev` | dev server on `:5173` | Day-to-day development with HMR |
| `npm run build` | `dist/main/*` + `dist/renderer/*` | Production bundle, no installer |
| `npm run package` | `release/Education Advisor-Setup-0.1.0.exe` | Windows NSIS installer |
| `npm run package:portable` | `release/Education Advisor-0.1.0-Portable.exe` | Single-file Windows portable |
| `npm run package:installer` | same as `package` | Explicit target name |
| `npm run typecheck` | exit code | `tsc --noEmit` |
| `npm run lint` | exit code | `biome check src/` |
| `npm run test` | test report | `vitest run` |
| `npm run clean` | — | `rimraf dist release` |

For macOS / Linux targets, edit [`electron-builder.yml`](./electron-builder.yml) and add the `mac` / `linux` blocks — we kept the configuration Windows-first because that's where the maintainer-team runs it. See [`docs/DISTRIBUTION.md`](./docs/DISTRIBUTION.md) for the full guide.

---

## 📁 Project layout

```
education-advisor/
├── src/
│   ├── main/                # Electron main process (33 files)
│   │   ├── ipc/             #   11 IPC handler modules
│   │   ├── services/        #   13 service modules (agent, EAA, cron, ...)
│   │   ├── preload/         #   contextBridge bridge
│   │   ├── utils/           #   logger, etc.
│   │   └── index.ts         #   main entry
│   ├── renderer/            # React 18 renderer (23 files)
│   │   ├── pages/           #   9 page modules
│   │   ├── components/      #   shared UI
│   │   ├── hooks/           #   12 custom hooks
│   │   ├── stores/          #   4 Zustand stores
│   │   ├── i18n/            #   zh + en
│   │   ├── lib/             #   typed IPC client
│   │   └── main.tsx         #   renderer entry
│   └── shared/              # Code shared by main + renderer
│       ├── ipc-channels.ts  #   90+ channel constants
│       └── types/           #   539 lines of shared TypeScript types
├── agents/                  # 18 agents × (SOUL.md + AGENTS.md)
├── config/                  # agents.yaml, reason-codes.json, default-settings.json
├── docs/                    # Full documentation (see /docs)
├── resources/               # Icons, Rust binaries per platform
├── scripts/                 # Dev-time link-analysis tools
├── skills/                  # User-injected Markdown skills
├── single-agent/            # "Single-agent mode" fallback prompt
├── examples/                # Example student records (anonymized)
├── tests/                   # Vitest suites (main + e2e)
├── electron-builder.yml     # Windows installer config
├── vite.config.main.ts      # Main-process Vite config
├── vite.config.renderer.ts  # Renderer Vite config
├── vitest.config.ts         # Two-project test config
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

The Rust EAA CLI is a **separate compilation unit** that this app spawns as a child process.
We deliberately did **not** ship the Rust source in this repo's `dist/` (it lives in
[`core/eaa-cli/`](https://github.com/232252/education-advisor/tree/main/core/eaa-cli)
of the same `education-advisor` repository), for two reasons:

1. **Separation of concerns.** The Rust side is a stable, audited data engine. The TS side
   is where the agents, the UI, and the LLM integration live. Keeping them in separate
   repos lets the data engine be reviewed and re-used independently.
2. **Reproducible builds.** When you `npm run build:eaa`, you download a **specific tagged
   binary** from the official release. You can verify its SHA-256 against the manifest. If
   you don't trust the binary, see [`docs/EAA_BRIDGE.md`](./docs/EAA_BRIDGE.md) for
   instructions on building it from source.

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
A: Yes — every IPC call to EAA is a single funnel (`src/main/services/eaa-bridge.ts`). You can swap it for any other data engine (PostgreSQL, Firestore, your own service) by replacing that file. The agent prompts and the UI are decoupled.

**Q: Why Electron and not Tauri?**
A: When we started, Tauri's ecosystem for Windows code-signing and auto-update was still rough. We're tracking the Tauri ecosystem — see ROADMAP for the long-term plan.

**Q: How big is the bundled installer?**
A: ~85 MB (NSIS) / ~75 MB (portable) on Windows x64, dominated by the Chromium runtime and the Rust EAA binary. The Electron shell itself is ~50 MB; the EAA binary is ~20 MB; the rest is your code, configs, and 18 agents.

**Q: How do I add a new agent?**
A: Read [`docs/AGENT_AUTHORING.md`](./docs/AGENT_AUTHORING.md). The TL;DR: drop a `SOUL.md` and an `AGENTS.md` into `agents/your-id/`, add an entry to `config/agents.yaml`, restart the app. That's it.

---

## 📄 License & acknowledgments

This project is released under the [MIT License](./LICENSE). You are free to use it in
commercial products, in schools, in research, and to fork it.

**Acknowledgments**

- The [`pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai) and
  [`pi-agent-core`](https://www.npmjs.com/package/@earendil-works/pi-agent-core) packages
  from `earendil-works` — the LLM SDK and the agent loop that power this app.
- The [`@electron`](https://www.electronjs.org/) team for the runtime.
- The [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) maintainers — the
  fastest synchronous SQLite binding in the Node ecosystem.
- The Rust [`tokio`](https://tokio.rs/) / [`serde`](https://serde.rs/) / [`clap`](https://clap.rs/)
  crates that the EAA CLI is built on.
- Every teacher who has ever lost sleep over a "+2 conduct point that should have been +3"
  — this app is for you.

---

**If this project helps you, please ⭐ star the repo — it helps others find it.**
**让教育更智能，让教师更轻松。**
