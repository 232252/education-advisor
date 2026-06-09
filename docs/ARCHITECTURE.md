# Architecture

> **The big picture.** This document is the canonical reference for how
> the three processes (main, renderer, EAA CLI) fit together, how the
> state flows, and why each decision was made.
>
> If you only have 10 minutes, read the [Overview](#overview) and the
> [Data flow](#data-flow) sections. If you have an hour, read the whole
> thing — the rest of the codebase will read faster afterwards.

## Table of contents

- [Overview](#overview)
- [The three processes](#the-three-processes)
- [The IPC contract](#the-ipc-contract)
- [The data flow](#the-data-flow)
- [The state model](#the-state-model)
- [The build pipeline](#the-build-pipeline)
- [The deployment pipeline](#the-deployment-pipeline)
- [Why these choices?](#why-these-choices)
- [Where to read the code](#where-to-read-the-code)

---

## Overview

Education Advisor is a **three-process** desktop application:

```
   ┌──────────────────────┐
   │       Teacher        │
   └──────────┬───────────┘
              │ clicks, types, talks
              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                  Education Advisor (this repo)                   │
   │                                                              │
   │   ┌────────────┐    ┌────────────┐    ┌────────────┐         │
   │   │ Dashboard  │    │   Chat     │    │  Students  │  ...    │
   │   └─────┬──────┘    └─────┬──────┘    └─────┬──────┘         │
   │         └──────────────────┴────────────────┘                │
   │                            │                                 │
   │                  window.api  (contextBridge)                 │
   │                            │                                 │
   │   ┌────────────────────────▼────────────────────────────┐    │
   │   │              Main process (Node 22)                 │    │
   │   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │    │
   │   │  │ 11 IPC   │→│ 13       │→│ SQLite   │ │ Tray / │  │    │
   │   │  │ handlers │  │ services │  │ db       │ │ Update │  │    │
   │   │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │    │
   │   │       ▲             ▲                                │    │
   │   │       │  cron       │  tool calls                    │    │
   │   │  ┌────┴─────────────┴────────────┐                   │    │
   │   │  │         18 agents             │                   │    │
   │   │  │  (Markdown-defined, least-     │                   │    │
   │   │  │   privilege, tier-routed)     │                   │    │
   │   │  └───────────────────────────────┘                   │    │
   │   └────────────────────────┬────────────────────────────┘    │
   │                            │                                 │
   │                  eaa-bridge (subprocess)                     │
   │                            │                                 │
   └────────────────────────────┼─────────────────────────────────┘
                                │  JSON over stdin/stdout
                                ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  eaa-cli  (Rust · 19.5 MB Windows binary · 6 platforms)     │
   │  https://github.com/232252/education-advisor                 │
   │                                                              │
   │   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐ │
   │   │events  │  │entities│  │privacy │  │export  │  │dashboard│ │
   │   └────────┘  └────────┘  └────────┘  └────────┘  └────────┘ │
   │                                                              │
   │  • Atomic file writes (tmp → fsync → rename)                 │
   │  • File lock (advisory) for multi-process safety             │
   │  • AES-256-GCM PII mapping                                   │
   │  • Reason-code schema validation                             │
   │  • Append-only event log (JSON-Lines)                        │
   └──────────────────────────────────────────────────────────────┘
```

The crucial property: **the desktop side never writes student data
directly**. Every write goes through the EAA bridge, which goes through
the EAA CLI, which goes through its file-locked, atomic-write event
store. The desktop app is a **view + agent orchestrator**; the Rust
binary is the **writer of record**.

---

## The three processes

### Process 1: Renderer (Chromium tab)

- **Runtime**: Chromium 130 (bundled with Electron 33)
- **Language**: TypeScript + React 18
- **Build tool**: Vite 6
- **Entry**: `src/renderer/main.tsx` → `src/renderer/App.tsx`
- **Sandbox**: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: false` (we need the preload bridge)

The renderer has **zero direct access** to:

- The file system
- The network
- The database
- The child processes

Every operation that needs any of those goes through `window.api`,
which is a thin proxy over `ipcRenderer.invoke`.

### Process 2: Main (Node 22 + Electron 33)

- **Runtime**: Node 22 with Electron 33's hardened main process
- **Language**: TypeScript (compiled to CJS for Electron)
- **Build tool**: Vite 6 (with `ssr: true` and `lib.entry` config)
- **Entry**: `src/main/index.ts` (246 lines, reads end-to-end in 10 minutes)
- **Privileges**: full Node.js + Electron privileges, but the renderer
  doesn't share this space

The main process owns:

- The window lifecycle (create / show / hide / close)
- The system tray
- The auto-update flow
- The IPC handlers (11 modules, 90+ channels)
- The 13 service modules (agent loop, EAA bridge, cron, …)
- The SQLite database
- The EAA child process
- The privacy keystore
- The log rotation

The main process **never trusts the renderer**. Every IPC handler
validates its inputs (TypeBox schemas for the complex ones), sanitizes
its outputs, and never exposes more than the renderer needs.

### Process 3: EAA CLI (Rust)

- **Runtime**: A pre-built Rust binary, ~19.5 MB on Windows x64
- **Source**: <https://github.com/232252/education-advisor>
- **Distribution**: per-platform tagged release
- **Transport**: spawned as a child process; JSON over stdin/stdout
- **Concurrency**: advisory file lock (`flock(2)` on Unix, `LockFileEx`
  on Windows) for multi-process safety
- **Atomicity**: every write is `tmp → fsync → rename`

The EAA CLI owns:

- The event log (append-only, JSON-Lines)
- The entity store (students, classes)
- The privacy mapping table (AES-256-GCM-encrypted)
- The reason-code schema
- The dashboard generator
- The data validation

The EAA CLI is the **only process that writes student data**. This is
the central design decision of the project.

---

## The IPC contract

There are **90+ IPC channels** in `src/shared/ipc-channels.ts`,
grouped by namespace:

| Namespace | Count | Purpose |
| --- | --- | --- |
| `ai:*` | 11 | LLM provider / model / chat / OAuth / custom models |
| `agent:*` | 12 | Agent lifecycle (list / get / toggle / run / abort / edit) |
| `eaa:*` | 21 | Data engine operations (info / score / ranking / add / revert / search / range / tag / stats / validate / export / list / add / delete / meta / import / codes / doctor / summary / dashboard) |
| `privacy:*` | 11 | Privacy engine (init / load / enable / disable / list / add / anonymize / deanonymize / filter / dryrun / backup) |
| `cron:*` | 8 | Scheduler (list / add / update / remove / toggle / run-now / get-logs / status-update) |
| `skill:*` | 4 | User-injected skills (list / get / save / delete) |
| `settings:*` | 3 | App settings (get / set / reset) |
| `sys:*` | 7 | System (open-dialog / save-dialog / open-external / get-path / check-update / show-update-dialog / notification) |
| `profile:*` | 2 | Student profile expansion (get / set) |
| `chat:*` | 4 | Conversation persistence (save / load / delete-session / list-sessions) |
| `log:*` | 8 | Logs (list / read / clear / filter / search / export / export-dialog / write-renderer) |
| `feishu:*` | 5 | Feishu integration (test / bitable / send / status / sync-now) |

Every channel is a string constant exported from a single file. Every
channel has a corresponding handler in `src/main/ipc/`. The handler
validates the input and calls a service method. The service does the
work, with full main-process privileges.

The renderer never sees the IPC channel name; it sees a method on
`window.api`. The contextBridge in `src/main/preload/index.ts` is the
single point of trust.

### Three kinds of IPC traffic

1. **Request / response** — `ipcRenderer.invoke(channel, ...args)`. The
   renderer awaits a return value. Used for 90% of operations.
2. **Event push** — `ipcRenderer.on(channel, handler)`. The main
   process pushes state updates (agent status, chat stream, cron
   status). Returns a cancellation function for clean up.
3. **One-way fire** — `ipcRenderer.send(channel, ...args)`. Used only
   for `log:write-renderer`, where the renderer is telling the main
   process "console.log happened".

---

## The data flow

The end-to-end flow when a user clicks "Run now" on `class-monitor`
with the prompt "Alice just handed in her homework 10 minutes late, +2":

```
[1] User clicks "Run now" in the Agents page
    ↓
[2] Renderer calls window.api.agent.runManual('class-monitor', 'Alice ...', history)
    ↓
[3] Preload bridges to ipcRenderer.invoke('agent:run-manual', ...)
    ↓
[4] Main process: agent-handlers.ts receives the call
    ↓
[5] agent-service.ts looks up the agent's config
    ↓
[6] agent-service.ts builds the system prompt:
    - agents/class-monitor/SOUL.md
    - agents/class-monitor/AGENTS.md
    - config/SMALL_MODEL_RULES.md (global rulebook)
    - skills/STUDENT_MANAGEMENT.md (active skill, if any)
    - list of available tools (sanitized, capability-checked)
    ↓
[7] pi-ai sends the prompt to the LLM
    ↓
[8] LLM responds with a tool call:
    { name: 'eaa.addEvent', args: { student: 'Alice', code: 'BONUS_VARIABLE', delta: 2, reason: 'homework on time' } }
    ↓
[9] agent-service.ts validates the tool call:
    - Does 'class-monitor' have the 'add_event' capability? YES ✓
    - Are the parameters well-formed? YES ✓
    ↓
[10] eaa-tools.ts sanitizes the parameters:
    - student name: 'Alice' is alphanumeric, no shell metacharacters ✓
    - reason: 'homework on time' is plain text, no path traversal ✓
    ↓
[11] eaa-bridge.ts spawns the eaa.exe child process:
    $ eaa add-event --student "Alice" --code "BONUS_VARIABLE" --delta 2 --reason "homework on time"
    ↓
[12] EAA CLI:
    - Validates 'BONUS_VARIABLE' against reason-codes.json
    - Acquires file lock on events.log
    - Writes new event to events.log.tmp
    - fsync
    - rename(events.log.tmp) → events.log (atomic)
    - Releases file lock
    - Returns: { id: 'evt_a3f7c2...', ts: '2026-06-09T...', ... }
    ↓
[13] eaa-bridge returns to eaa-tools, which returns to agent-service
    ↓
[14] agent-service sends the tool result back to the LLM for summarization
    ↓
[15] LLM responds: "Done. Added +2 to Alice (BONUS_VARIABLE), event ID evt_a3f7c2...."
    ↓
[16] agent-service streams the response back to the renderer as a series of StreamEvent messages
    ↓
[17] Renderer (chatStore) accumulates the streamed chunks
    ↓
[18] Renderer displays the response, persists it in SQLite (chat:save-message)
    ↓
[19] User sees: "Done. Added +2 to Alice (BONUS_VARIABLE), event ID evt_a3f7c2...."
```

The whole round-trip is **~2–4 seconds** for a small model on a local
server, **~1–2 seconds** for a hosted model.

---

## The state model

### Main process state

The main process is the **source of truth**. It holds:

- **The SQLite database** (in `userData/db.sqlite`):
  - `chat_messages` — every chat message with timestamp, role, content,
    thinking, tool calls, token usage, cost
  - `chat_sessions` — the session metadata (id, title, last-activity, model)
  - `agent_executions` — every agent run with prompt, response, tool calls, duration
  - `cron_logs` — every cron job run with start, end, status, output snippet
  - `settings` — the in-app settings (key-value, dot-pathed)
  - `custom_models` — the user-added custom models
- **The in-memory services** — agent service holds the loaded agents
  in memory; cron service holds the cron jobs; etc.
- **The EAA child process** — long-lived for streaming, or short-lived
  for one-shot operations.

### Renderer state

The renderer holds **projections** of the main process state, in
4 Zustand stores:

- `agentStore` — agent metadata, run history, edit state
- `chatStore` — current conversation, message list, streaming state
- `settingsStore` — current settings, theme, language
- `toastStore` — transient notifications

Stores are intentionally **thin**. The main process is the source of
truth; the renderer stores are projections. The main process pushes
state updates over IPC events (`agent:status-update`,
`cron:status-update`, `ai:chat-stream`).

### EAA CLI state

The EAA CLI holds its state in the file system:

- `events.log` — the event log (append-only, JSON-Lines)
- `events-by-student.json` — the secondary index (O(1) lookup by student)
- `entities/students.json` — the student roster
- `entities/classes.json` — the class metadata
- `schema/reason-codes.json` — the reason-code schema (also bundled with the app)
- `privacy/mapping.bin` — the AES-256-GCM-encrypted privacy mapping
- `privacy/salt.bin` — the Argon2 salt
- `privacy/audit.log` — the privacy audit log
- `dashboards/` — the generated HTML dashboard reports

The EAA CLI is **stateless across invocations**. Each invocation
re-reads the relevant files, processes the request, and returns. This
is the simplest possible model and the easiest to reason about.

---

## The build pipeline

| Stage | Tool | Output | Run by |
| --- | --- | --- | --- |
| TypeScript compile (main) | Vite 6, `vite.config.main.ts` | `dist/main/index.js` + `dist/main/preload.js` | `npm run dev:main`, `npm run build` |
| TypeScript compile (renderer) | Vite 6, `vite.config.renderer.ts` | `dist/renderer/index.html` + assets | `npm run dev:renderer`, `npm run build` |
| Lint | Biome 2.3 | exit code | `npm run lint` |
| Type check | TypeScript 5.7 | exit code | `npm run typecheck` |
| Test | Vitest 3.2 | test report | `npm run test` |
| Package | electron-builder 25 | `release/*.exe` | `npm run package` |

The two Vite configs produce CommonJS for the main process (because
Electron's main is a Node.js process) and ES modules for the renderer
(because Chromium).

The dependency footprint is intentionally small:

- `better-sqlite3` is the only native dependency.
- The Rust EAA binary is bundled as an `extraResource`, unpacked from
  the asar archive at startup.
- Everything else is pure JS / TS.

---

## The deployment pipeline

For maintainers cutting a release:

```
local dev → PR → CI green → squash-merge → main → tag v*.*.* → release workflow → GitHub Release
```

The release workflow (`.github/workflows/release.yml`):

1. Runs the quality gates on three platforms.
2. Builds the installers on three platforms (Windows x64, macOS x64 +
   arm64, Linux x64).
3. Computes SHA-256 checksums.
4. Signs the checksums with [cosign](https://docs.sigstore.dev/).
5. Creates a GitHub Release with the installers + checksums + signatures.

Users get the update through the in-app auto-update flow, which checks
the GitHub Releases API for the latest version of the channel they're
on (`stable`, `beta`, or `rc`).

---

## Why these choices?

### Why Electron and not Tauri / native?

When the project started (early 2025), the constraints were:

1. **Windows is the primary deployment target** (90%+ of users).
2. **Code-signing and auto-update need to be boringly reliable.**
3. **Time-to-first-build is more important than absolute performance.**

Tauri 1.0 had rough Windows code-signing stories in late 2024 / early
2025. Electron Builder had a decade of hardening. We chose Electron.
Tauri 2.0 has caught up, and the [ROADMAP](../ROADMAP.md) includes a
Tauri parity project for v2.0 of the desktop client.

### Why React and not Vue / Svelte?

- The team already had React muscle memory.
- The Pi Agent core is published as a React-friendly library.
- The agent loop, the prompt editor, and the log viewer all benefit
  from React's ecosystem (TipTap, react-markdown, shiki, react-table).

### Why Vite and not Webpack / Rollup directly?

- Vite's HMR is the fastest in the ecosystem.
- The two-config setup (one for the main process, one for the renderer)
  is well-supported.
- The build output is small and well-bundled.

### Why Zustand and not Redux / MobX?

- The state model is small (4 stores).
- We don't need time-travel debugging (the SQLite is the source of
  truth).
- We don't need middleware (the main process is the trust boundary).
- Zustand's API is the simplest in the React state-management
  ecosystem.

### Why a separate Rust CLI and not an embedded Rust in Node?

- **Reproducible builds.** A pre-built binary is a specific tagged
  artifact, verifiable with SHA-256. An embedded Rust would be
  re-compiled per machine.
- **Separation of concerns.** The Rust side is the data engine; the
  TypeScript side is the agent orchestrator. Keeping them separate
  means each can be reviewed, audited, and re-used independently.
- **Performance isolation.** A long-running Rust operation can't
  block the main process because it's in a separate process.

### Why `better-sqlite3` and not `node-sqlite3` or `libsql`?

- `better-sqlite3` is synchronous, which is what we want for a
  desktop app with a single main process.
- It's well-maintained and pre-built for all common platforms.
- It's the fastest SQLite binding in the Node ecosystem.

### Why not a database for the EAA CLI's event log?

- The event log is meant to be **human-readable** (JSON-Lines) and
  **appended to one file at a time**. A database would obscure the
  audit trail.
- For a single teacher's class (50–100 students), the event log
  grows at ~10 KB / day, which is well within the file-system's
  comfort zone.
- For multi-class deployments (planned for v0.4.0), we'll add a
  SQLite-backed event store in the EAA CLI as an opt-in alternative.

---

## Where to read the code

If you are new to the codebase, here is a 30-minute reading order:

1. **[`src/main/index.ts`](../src/main/index.ts)** — the main process
   entry, 246 lines.
2. **[`src/renderer/App.tsx`](../src/renderer/App.tsx)** — the
   renderer entry, 46 lines.
3. **[`src/shared/ipc-channels.ts`](../src/shared/ipc-channels.ts)** —
   every IPC channel, 130 lines.
4. **[`src/main/services/agent-service.ts`](../src/main/services/agent-service.ts)** —
   the agent loop, 1 031 lines.
5. **[`src/main/services/eaa-bridge.ts`](../src/main/services/eaa-bridge.ts)** —
   the Rust bridge, 424 lines.
6. **[`src/main/services/eaa-tools.ts`](../src/main/services/eaa-tools.ts)** —
   the tool layer the agents use, 410 lines.
7. **[`config/agents.yaml`](../config/agents.yaml)** — the agent
   registry, 441 lines.
8. **[`agents/main/SOUL.md`](../agents/main/SOUL.md)** — the most-used
   agent, 117 lines.
9. **[`config/SMALL_MODEL_RULES.md`](../config/SMALL_MODEL_RULES.md)** —
   the rulebook, 152 lines.

After that, the rest of the codebase is filling in the details.
Welcome.
