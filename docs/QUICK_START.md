# Quick start

> **Get Education Advisor running on your machine in under 15 minutes.**
> If you hit a wall, see [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) or open
> a [GitHub Discussion](https://github.com/232252/education-advisor/discussions).

## 1. Prerequisites

| What | Version | How to check |
| --- | --- | --- |
| **Node.js** | 22 LTS or later | `node -v` should print `v22.x.x` |
| **npm** | 10 or later (bundled with Node 22) | `npm -v` should print `10.x.x` |
| **Git** | any recent version | `git --version` |
| **C++ toolchain** | platform-specific | see below |
| **(Optional) Rust** | 1.78+ with `cargo` | only if you want to build the EAA CLI from source |
| **Disk space** | ~1.5 GB free | for `node_modules/`, EAA binary, build artifacts |

### C++ toolchain by platform

- **Windows 10/11**: install
  [Visual Studio 2019/2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the "Desktop development with C++" workload. (~3 GB)
- **macOS 12+**: `xcode-select --install` (already installed if you've
  ever compiled a `brew` formula).
- **Linux (Debian/Ubuntu)**: `sudo apt install build-essential python3`
- **Linux (Fedora/RHEL)**: `sudo dnf install gcc gcc-c++ make`
- **Linux (Alpine)**: `apk add build-base python3`

## 2. Get the source

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
```

That's it — the repo is now self-contained. Both the desktop (Electron
+ React + TypeScript) **and** the data engine (Rust `eaa-cli`) are in
this one repository. No sibling monorepo checkouts are required.

If you don't have Git, download the source as a ZIP from the GitHub UI
and extract it. Skip the `cd` step and use the extracted directory instead.

## 3. Install dependencies

```bash
npm ci
```

This will:

- Download ~700 MB of npm packages into `node_modules/`
- Compile the `better-sqlite3` native binding (this is the longest step
  on a slow machine — about 1–5 minutes)
- Resolve the in-tree vendored packages under `vendor/`
  (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`)

If you see `better-sqlite3` errors, see
[`TROUBLESHOOTING.md#better-sqlite3-fails-to-build`](./TROUBLESHOOTING.md#better-sqlite3-fails-to-build).

## 4. Fetch (or build) the Rust EAA binary

The desktop spawns the Rust `eaa-cli` as a child process for all
student-data operations. The Rust source lives in `core/eaa-cli/` inside
this repo, so you build it from source — no download required.

```bash
npm run build:eaa
```

The script (`scripts/build-eaa.mjs`) will:

1. Detect your platform and architecture.
2. Verify the Rust toolchain (`cargo`) is installed — if not, it errors
   out and points you to <https://rustup.rs>.
3. Run `cargo build --release` in `core/eaa-cli/`.
4. Place the built binary at
   `resources/eaa-binaries/<platform>/eaa(.exe)`.

The build is cached: it skips recompiling when the existing binary is
newer than the `.rs` sources. Force a rebuild with
`EAA_FORCE=1 npm run build:eaa`.

## 5. Run in dev mode

```bash
npm run dev
```

In a **second terminal**:

```bash
npm run dev:electron
```

The app window opens, title "Education Advisor", Dashboard page. Hot module
replacement (HMR) is on for the renderer, so edits to React components
appear in < 1 second. Edits to the main process trigger a full app
reload in 1–3 seconds.

## 6. Build a release

```bash
npm run build           # vite build × 2 configs → dist/
npm run package         # electron-builder → release/*.exe
```

The output:

- `dist/main/index.js` + `dist/main/preload.js` — the main process bundle
- `dist/renderer/index.html` + assets — the renderer bundle
- `release/Education Advisor-Setup-0.1.0.exe` — the NSIS installer (~85 MB)
- `release/Education Advisor-0.1.0-Portable.exe` — the portable .exe (~75 MB)

## 7. Configure the app

On first launch, the app will:

- Create a `userData/` directory for your local data:
  - **Windows**: `%APPDATA%\Education Advisor\`
  - **macOS**: `~/Library/Application Support/Education Advisor/`
  - **Linux**: `~/.config/Education Advisor/`
- Initialize a SQLite database at `userData/db.sqlite`.
- Open the Dashboard page with no data.

To configure:

1. **Pick a language and theme** in **Settings → General**.
2. **Add an LLM API key** in **Models**. The app supports 30+ providers
   (OpenAI, Anthropic, Google Gemini, Qwen, Doubao, Zhipu, DeepSeek,
   Mistral, Moonshot, Ollama, LM Studio, and any OpenAI-compatible
   endpoint).
3. **Test the connection** in the Models page. You should see "✓
   Connected".
4. **Set the default model** for `high-quality` and `low-cost` tiers.
5. (Optional) **Initialize the privacy engine** in **Privacy → Init**.
6. (Optional) **Configure Feishu** in **Settings → Feishu**.

## 8. Try an agent

Visit **Agents** in the sidebar.

- Click on `class-monitor`. You'll see its `SOUL.md` content.
- Click **Run manual**. Type something like "Alice just handed in her
  homework 10 minutes late, +2".
- The agent will call the LLM, which will respond with a tool call
  (`eaa.addEvent`). The Rust CLI will validate and append the event.
- The agent will then summarize: "Done. Added +2 to Alice (BONUS_VARIABLE),
  event ID `evt_a3f7c2...`."
- Visit **Students** to see the new entry.

## 9. Set up the scheduler

The default schedule has 18 jobs. Most are daily. To change them:

- Visit **Scheduler** in the sidebar.
- Click on a task. You'll see the cron expression and the agent it
  triggers.
- Edit the cron expression, or toggle the task off, or click **Run now**.

The schedule is also editable in `config/agents.yaml` (the canonical
source of truth — the in-app editor writes back to this file).

## 10. Next steps

- Read [`PROJECT_INTRO.md`](../PROJECT_INTRO.md) for the long-form
  reference.
- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) to understand the
  three-process model.
- Read [`AGENT_AUTHORING.md`](./AGENT_AUTHORING.md) to write your own
  agent.
- Read [`DEVELOPMENT.md`](./DEVELOPMENT.md) to set up your dev
  environment for hacking on the app.
- Join the [GitHub Discussions](https://github.com/232252/education-advisor/discussions)
  to ask questions and share what you've built.

Welcome aboard. 🎉
