# Development

> **How to set up your dev environment and start hacking on the
> codebase.** This document is for contributors — if you only want
> to use the app, see [QUICK_START.md](./QUICK_START.md) instead.

## Table of contents

- [Prerequisites](#prerequisites)
- [The repository layout](#the-repository-layout)
- [Initial setup](#initial-setup)
- [Daily development loop](#daily-development-loop)
- [Project structure](#project-structure)
- [Coding standards](#coding-standards)
- [TypeScript aliases](#typescript-aliases)
- [The EAA data engine (Rust)](#the-eaa-data-engine-rust)
- [The vendored pi-ai package](#the-vendored-pi-ai-package)
- [The dsh agent runtime](#the-dsh-agent-runtime)
- [The vendored Submitty schema reference](#the-vendored-submitty-schema-reference)
- [Running tests](#running-tests)
- [Linting and formatting](#linting-and-formatting)
- [Debugging tips](#debugging-tips)
- [Common tasks](#common-tasks)
- [Contributing a change](#contributing-a-change)

---

## Prerequisites

- **Node.js 22.x or later** (we use the latest LTS). Check with
  `node -v`.
- **npm 11.x** (`npm -v`). The vendored `file:./vendor/pi-ai`
  dependency tree (its devDeps carry a `canvas` optional peer)
  crashes npm 10.9.x Arborist with `Cannot read properties of null
  (reading 'edgesOut')` during `install`/`update`. If your bundled
  npm is 10.x, run installs through `npx -y npm@latest install`.
  npm 11 also gates dependency lifecycle scripts: approved
  first-party/native packages are pinned in `package.json`
  (`npm.allowScripts`); after approving a new one, run
  `npx -y npm@latest rebuild <pkg>` so already-extracted packages
  run their install scripts (pnpm 12.15 without this leaves broken
  Windows `.bin` shims).
- **Git 2.30+**.
- **A working C++ toolchain** (for `better-sqlite3`):
  - **Windows**: Visual Studio 2019/2022 Build Tools with the
    "Desktop development with C++" workload.
  - **macOS**: `xcode-select --install`.
  - **Linux**: `apt install build-essential python3` (Debian /
    Ubuntu) or equivalent.
- **A code editor** with TypeScript + React + Biome support.
  We recommend VS Code with the Biome extension.

For full-stack work that also touches the Rust CLI:

- **Rust 1.78+** (`rustup install stable`)
- **The EAA CLI (`core/eaa-cli/`)** (see below).

---

## The repository layout

This is a **single monorepo** containing all the source code needed
to build and run the project end-to-end:

| Sub-tree | What it is |
| --- | --- |
| `src/main/`, `src/renderer/`, `src/shared/` | Electron + React + TypeScript desktop client |
| `core/eaa-cli/` | Rust data engine — the EAA CLI (4 sub-crates: `eaa`, `eaa-core`, `eaa-crypto`, `eaa-sqlite`) |
| `vendor/pi-ai/` | Vendored `@earendil-works/pi-ai` 1.3.0 — the provider/model catalog and LLM API surface, from the published npm tarball plus one local patch (see below) |
| `vendor/dsh-im/` | Official DeepSeek connection-center plugin (`@xmanrui/dsh-im` 5.9.1) — linked into the `dsh web` profile |
| `vendor/dsh-node/` | Gitignored; a stock Node binary staged at package time by `scripts/stage-dsh-node.mjs` — the dsh subprocess cannot run under Electron's own exe |
| `vendor/eaa-tools/`, `vendor/eaa-roster/`, `vendor/eaa-grades/`, `vendor/eaa-grading/` | The education cordis plugins (conduct events / roster / grades / AI grading) mounted into the dsh profiles |
| `vendor/submitty/` | Pinned Submitty PostgreSQL schema dumps — the blueprint + drift guard for the built-in AI grading subsystem (see below) |
| `resources/` | Bundled assets (icon, eaa binary, locale data) |
| `docs/` | All documentation (architecture, agent authoring, EAA bridge, etc.) |
| `.github/` | CI workflows, issue templates, CODEOWNERS |
| `config/`, `agents/`, `policies/` | Shipped agent manifests and example configs |

A single `git clone` of this repo gives you everything you need.
There are **no sibling checkouts** to fetch.

---

## Initial setup

### 1. Fork and clone

```bash
# Fork on GitHub first
git clone https://github.com/<your-username>/education-advisor.git
cd education-advisor
git remote add upstream https://github.com/232252/education-advisor.git
```

### 2. Install dependencies

```bash
npm ci
```

This is the same as `npm install` but uses the committed
`package-lock.json` for reproducible installs.

### 3. Fetch (or build) the EAA binary

```bash
# Option A — download the prebuilt binary for your platform
npm run build:eaa

# Option B — build it from source (requires Rust 1.78+)
cd core/eaa-cli
cargo build --release
# then copy target/release/eaa(.exe) into resources/eaa-binaries/<platform>/
cd ../..
```

See [`EAA_BRIDGE.md`](./EAA_BRIDGE.md#manual-install) for the
manual install if both of these fail.

### 4. Verify

```bash
# Type-check should be 0 errors
npm run typecheck

# Lint should be 0 errors
npm run lint

# Tests should all pass
npm run test

# Build should succeed
npm run build
```

If all four pass, you're good to go. Four more gates cover the
vendored / subprocess layers — run them when you touch those areas:

```bash
npm run verify:vendor   # vendored package pins (pi-ai, submitty)
npm run verify:dsh      # dsh backend assembly (SDK in dependencies, runtime deps present)
npm run verify:eaa      # EAA engine functional check (real binary round-trip)
npm run ipc:contract    # IPC contract, static mode (also runs in CI)
```

---

## Daily development loop

```bash
# Terminal 1: dev servers (auto-rebuild on change)
npm run dev

# Terminal 2: launch the Electron shell
npm run dev:electron
```

The dev servers watch the source and rebuild on change. The
Electron shell loads the renderer from `http://localhost:5173`
(with HMR) and the main process from the freshly-built
`dist/main/index.cjs`.

### What to expect

- **Edits to `src/renderer/**`** — HMR, the window updates in
  < 1 second without losing state.
- **Edits to `src/main/**`** — the main process rebuilds and the
  window reloads in 1–3 seconds.
- **Edits to `src/shared/**`** — both processes rebuild, the
  window reloads.
- **Edits to `agents/**`** — you need to click "Reload agents" in
  the Agents page (or restart).
- **Edits to `config/**`** — same as `agents/**`, plus the app
  re-reads the config on next agent load.

### Hot-reload limitations

- **Changes to `package.json`** — you need to restart `npm run dev`
  (or `npm ci` if the deps changed).
- **Changes to `vite.config.*.ts`** — restart `npm run dev`.
- **Changes to `electron-builder.yml`** — restart `npm run dev`
  (and the electron shell).
- **Changes to `biome.json`** — restart your editor (Biome needs
  to reload its config).

---

## Project structure

```
src/
├── main/                # Electron main process (Node 22)
│   ├── ipc/             # IPC handler modules — one entry file per domain, handleIpc skeleton by default
│   ├── services/        # Service modules — incl. dsh/ (agent runtime), pi-ai/ (provider catalog), channels/
│   ├── preload/         # contextBridge bridge
│   ├── utils/           # logger etc.
│   └── index.ts         # main entry
├── renderer/            # React 19 renderer
│   ├── pages/           # page modules
│   ├── components/      # shared UI
│   ├── hooks/           # shared hooks (loading / confirm / mount-guard, ...)
│   ├── stores/          # Zustand stores
│   ├── i18n/            # zh-CN + en-US
│   ├── lib/             # typed IPC client
│   └── main.tsx         # renderer entry
└── shared/              # code shared by main + renderer
    ├── ipc-channels.ts  # IPC channel constants
    └── types/           # shared type modules
```

Exact counts (pages, routes, IPC channels, service files, stores, …)
are auto-generated — see the repository-scale table at the top of
[`ARCHITECTURE.md`](./ARCHITECTURE.md) (`npm run doc:stats`).

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#where-to-read-the-code)
for a 30-minute reading order.

---

## Coding standards

### TypeScript

- **Strict mode** is on. `any` is allowed only at module
  boundaries (the IPC bridge can use `unknown` and validate with
  TypeBox).
- **Path aliases**: `@main/*`, `@renderer/*`, `@shared/*`.
- **No default exports** for modules with multiple exports; use
  named exports.
- **No circular dependencies** between `src/main/` and
  `src/renderer/`.
- All public functions have a JSDoc comment explaining the
  contract.

### React

- **Function components** only (no class components).
- **Hooks** follow the
  [rules of hooks](https://react.dev/reference/rules/rules-of-hooks).
- **No inline styles** for anything that needs to be themable;
  use the Tailwind utility classes or the CSS variables in
  `src/renderer/styles/globals.css`.
- **No hand-written `useEffect` + `setState` data loading** — use the
  shared hooks: `useIpcQuery` (single-source IPC load, stale-guarded),
  `useMultiLoader` (multi-source parallel load), or a Zustand store
  (`stores/lib/create-shared-list-store.ts` for list domains). The
  typed IPC client (`lib/ipc-client.ts`) is what those hooks call.

### Linting

- **Biome 2.3** is the source of truth. Run `npm run lint:fix` to
  auto-fix the safe ones.
- The custom a11y rules (`useButtonType`, `noLabelWithoutControl`,
  …) are `warn`, not `error`, but please address them in new
  code.

### File size

- Soft cap at **500 lines per file**. The current exception is
  `src/main/services/agent-service.ts` (1 031 lines) — it's on
  the refactor list.

### Naming

- Files: `kebab-case.ts` for non-component files; `PascalCase.tsx`
  for React components.
- Classes / types: `PascalCase`.
- Functions / variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for IPC channel names, `camelCase`
  for the rest.

### Error handling

- Never `catch` an error and ignore it. Either re-throw, log, or
  surface to the user via the toast store.
- Use `unknown` and narrow with `instanceof Error` or a type
  guard.
- The privacy engine and the EAA bridge are the two places where
  errors **must** be human-readable. Every other layer can be
  technical.

### i18n

- Every user-facing string in the renderer goes through `useT()`
  from `src/renderer/i18n/index.ts`.
- Add the new key to **both** `zh.json` and `en.json` in the same
  PR.
- The key naming convention is `domain.subdomain.label`, e.g.
  `agents.class-monitor.description`.

### Security

- Never log a real API key, a real student name, or a real phone
  number.
- The privacy engine is **always on** by default. If you need to
  disable it for a specific call, document the reason in a
  comment.
- The renderer **never** touches `fs`, `path`, `child_process`,
  or `ipcRenderer` directly. Everything goes through the preload
  bridge.

---

## TypeScript aliases

The project uses three path aliases:

| Alias | Maps to | Used in |
| --- | --- | --- |
| `@main/*` | `src/main/*` | Main process imports |
| `@renderer/*` | `src/renderer/*` | Renderer imports |
| `@shared/*` | `src/shared/*` | Both |

Defined in `tsconfig.json`:

```json
"paths": {
  "@main/*": ["src/main/*"],
  "@renderer/*": ["src/renderer/*"],
  "@shared/*": ["src/shared/*"]
}
```

The Vite configs (`vite.config.main.ts` and
`vite.config.renderer.ts`) re-define these aliases for the
bundler. If you add a new alias, update both `tsconfig.json` and
the relevant Vite config.

---

## The vendored pi-ai package

One `@earendil-works/*` package is still referenced as a local `file:`
dependency:

```json
"dependencies": {
  "@earendil-works/pi-ai": "file:./vendor/pi-ai"
},
"overrides": {
  "@earendil-works/pi-ai": "file:./vendor/pi-ai"
}
```

`pi-agent-core` is gone — the agent loop runs in a dsh subprocess (see
[The dsh agent runtime](#the-dsh-agent-runtime)). `pi-ai` stays because
the app reuses its provider/model catalog and LLM API surface, and
because dsh's own LLM adapter (`dsh-llm-pi-ai`) is built against it.

Provenance model:

- `vendor/pi-ai/dist/` and `package.json` come from the **published npm
  tarball** of `@earendil-works/pi-ai` 1.3.0. The vendored copy has no
  `src/` — you cannot edit provider sources in place.
- The one local modification ships as
  `scripts/patches/earendil-works__pi-ai@1.4.0.dsh-toolcall.patch`
  (DeepSeek Harness: removes per-delta re-parsing of streamed tool-call
  arguments).
- After touching anything in `vendor/pi-ai/`, run
  `node scripts/update-vendor-pi-provenance.mjs` to refresh
  `vendor/pi-ai/UPSTREAM.json` — the per-file sha256 manifest that lets
  `verify:vendor` and the drift tests do tamper detection
  (`--check` is the CI mode; it fails when the manifest no longer
  matches the tree).
- `npm run verify:vendor` (`scripts/verify-vendor.mjs`) validates the
  pin itself: version, `dist/` entry points, and that the key exports
  still import.

This means `git clone && npm ci` still works without any sibling
checkouts, and every deviation from upstream is either the recorded
patch or a `UPSTREAM.json` sha256 mismatch away from being caught.

---

## The dsh agent runtime

Model calls no longer run inside the Electron main process. The agent
loop talks to a **dsh subprocess** (`@deepseek-ai/dsh` 0.2.2-rc.1)
through `@deepseek-ai/dsh-sdk-client`, and the code owning that
conversation lives in `src/main/services/dsh/`:

| File | Responsibility |
| --- | --- |
| `runtime.ts` | Subprocess lifecycle: loads the ESM-only SDK client at runtime (hidden dynamic import), spawns `dsh --profile sdk`, JSONRPC `initialize` / `prompt` / `subscribe`, retires and respawns the subprocess when the provider/model route changes |
| `agent-facade.ts` | The Agent-shaped facade `agent/execution.ts` consumes: projects dsh turn events into `AgentEvent` and releases idle at turn end |
| `stream-mapper.ts` | dsh `SessionEvent` → renderer `StreamEvent` (the same event contract IPC pushes and the renderer already speak) |
| `tool-bridge.ts` | Per-run tool mounting: dsh has no tool-registration API, so each run gets its own MCP endpoint (served in-process by `eaa-mcp-server.ts` on `127.0.0.1`, Bearer-token protected) plus a one-endpoint cordis patch — that is what makes per-role least privilege possible |
| `im-host.ts` | The connection center: runs `dsh web` in its own `DSH_HOME` with `vendor/dsh-im` and the education plugins linked into the web profile (see [`ARCHITECTURE.md`](./ARCHITECTURE.md#the-connection-center-dsh-im)) |
| `skill-mount.ts` | Copies only the current role's skills into a dsh-discoverable directory and pins it with a `skill-filesystem` patch |

Two more files you will meet along the way: `hardening.ts` (the cordis
patch that turns off dsh's bundled harness tools — bash, file, web,
subagents, … — so a role only ever sees its own tool set) and
`dsh-node.ts` (the spawn hook that launches dsh with a stock Node
binary instead of Electron's own exe — dsh 0.2.1 rejects Electron
43.2.0's runtime fingerprint, and the packaged app ships that Node
binary in `vendor/dsh-node/`).

When you change anything under `src/main/services/dsh/`, run its test
suite:

```bash
npx vitest --run src/main/services/dsh
```

### Prepackage staging

`npm run package` auto-runs the `prepackage` hook first, which is three
scripts in a row:

1. `scripts/prebuild-check.mjs` — resource readiness gate (same as the
   `prebuild` hook).
2. `scripts/stage-dsh-node.mjs` — copies a stock `node.exe` from your
   machine into the gitignored `vendor/dsh-node/`; skipped when a copy
   is already staged.
3. `scripts/stage-dsh-im-deps.mjs` — installs `vendor/dsh-im/`
   production dependencies with the repo's own pnpm (they are not part
   of the plugin zip); skipped when already installed.

Both staging scripts are no-ops once their output exists. Re-run
triggers: a fresh clone (`vendor/dsh-node/` is gitignored), or deleting
`vendor/dsh-node/` / `vendor/dsh-im/node_modules/` — e.g. after
upgrading dsh or dsh-im.

---

## The vendored Submitty schema reference

`vendor/submitty/` holds a small, pinned subset of the upstream
[Submitty](https://github.com/Submitty/Submitty) project (BSD-3-Clause):
the two authoritative PostgreSQL schema dumps
(`migration/migrator/data/{course_tables,submitty_db}.sql`) plus the
upstream `LICENSE.md`, recorded in `UPSTREAM.json` (tag / commit /
per-file sha256).

It is **not** the upstream application — the upstream PHP server is
never executed. The dumps are the **data-model blueprint** for the
built-in AI grading subsystem (「批改作业」 page): the native model in
`src/main/services/grading/` mirrors Submitty's grading chain
(`gradeable → gradeable_component → gradeable_component_mark →
grade_override`, with `autograding_testcase` as the per-item scoring
analogue of AI per-question grading).

Guard rails:

- `tests/main/submitty-vendor-drift.test.ts` fails when upstream
  renames/removes a table or column our native model maps from —
  pull a new reference, then update the mapping.
- `npm run verify:vendor` validates the pin (existence + sha256).
- `npm run rollback:vendor` also restores this directory.

Updating (upstream releases monthly, `vYY.MM.NN`):

```bash
npm run update:vendor:submitty                  # latest release tag
npm run update:vendor:submitty -- --tag v26.08.01
```

Then run the drift test; if red, update the native mapping before
committing. See `vendor/submitty/README.md` for details.

---

## Running tests

```bash
# Run all tests
npm run test

# Watch mode
npm run test:watch

# Run a specific file
npx vitest --run eaa-tools

# Run with coverage
npx vitest --run --coverage
```

The Vitest config has two projects:

- `renderer` (jsdom env) — tests under
  `src/renderer/**/__tests__/`
- `main` (node env) — tests under `src/main/**/__tests__/` and
  `tests/main/**`, plus the e2e tests under `tests/e2e/`

The e2e test exercises the full agent loop without spawning a
real Electron process. It's a good integration check.

### Conventions

- One test file per source file. `foo.ts` → `foo.test.ts`.
- One `describe` per exported function, one `it` per behavior.
- Test names read as sentences: `it('returns null when the
  student does not exist')`.
- Use real SQLite (in-memory or `node:os.tmpdir()`) for DB
  tests, not mocks.
- Use `vi.fn()` for LLM / network mocks, but only at the IPC
  boundary, not deep in the service layer.

---

## Linting and formatting

```bash
# Lint (check only)
npm run lint

# Lint with auto-fix
npm run lint:fix

# Format (Biome's built-in)
npx biome format --write src/
```

Biome 2.3 enforces:

- 2-space indentation
- 100-character line width
- Single quotes for strings
- No semicolons (except where required)
- Trailing newline at end of file
- LF line endings (the `.editorconfig` will convert CRLF
  automatically on save)

The custom rules (`noExplicitAny: warn`, six a11y rules) are
also enforced.

---

## Debugging tips

### The main process

The main process logs go to:

- **DevTools console** (you can open it via View → Toggle
  Developer Tools in the Electron window)
- **Files in `userData/logs/main-*.log`** (5-level rotating,
  capped at 20 MB total)

To debug a specific issue:

1. Set the log level to `debug` in Settings → General.
2. Reproduce the issue.
3. Open the Logs page in Settings.
4. Filter by the relevant agent / handler.

### The renderer

The renderer is a normal Chromium devtools instance. Open
DevTools (View → Toggle Developer Tools or `Ctrl+Shift+I`) and
you have the full Chrome devtools.

The renderer console messages are also forwarded to the main
process logs (see `useForwardConsole` in
`src/renderer/hooks/useForwardConsole.ts`). Look for
`[Renderer N]` prefixed lines.

### The EAA bridge

The bridge logs every request and response at `debug` level.
See [`EAA_BRIDGE.md#debugging`](./EAA_BRIDGE.md#debugging) for
the full debug guide.

### The privacy engine

The privacy engine writes to `userData/eaa-data/privacy/audit.log`.
This is a separate file from the main log; it's append-only and
is the authoritative record of every `anonymize` /
`deanonymize` call.

---

## Common tasks

### Add a new IPC channel

1. Add the constant to `src/shared/ipc-channels.ts`.
2. Add the handler in the relevant
   `src/main/ipc/<domain>-handlers.ts` file.
3. Expose the method on `window.api` in
   `src/main/preload/index.ts`.
4. Add the method to the typed client in
   `src/renderer/lib/ipc-client.ts`.
5. Add a test in `tests/main/`.
6. Update the documentation (`docs/` and the relevant JSDoc).

### Add a new agent

See [`AGENT_AUTHORING.md`](./AGENT_AUTHORING.md) — it's a
5-minute process.

### Add a new page

1. Create the directory `src/renderer/pages/MyPage/`.
2. Create `MyPage.tsx` exporting the component.
3. Add the route to `src/renderer/App.tsx`.
4. Add the sidebar link in `src/renderer/layouts/MainLayout.tsx`.
5. Add the i18n keys to both `src/renderer/i18n/zh.json` and
   `en.json`.
6. Add a test in `src/renderer/pages/MyPage/__tests__/`.

### Update the bundled EAA binary

1. Bump the version in `core/eaa-cli/Cargo.toml`.
2. Bump the version in `core/eaa-cli/VERSION_HISTORY.md` (if it
   exists).
3. Build a release: `npm run build:eaa` (compiles from `core/eaa-cli/`
   source via `scripts/build-eaa.mjs`; requires the Rust toolchain).
4. Commit the new binary in
   `resources/eaa-binaries/<platform>/`.
5. Update the root `CHANGELOG.md`.

### Add a new LLM provider

There is no provider list in this repo to edit: `vendor/pi-ai` contains
only the built `dist/` of the published npm package — there is no
`src/` to drop a new provider file into. The chain today:

1. **Catalog data** — `builtinProviders()` from
   `@earendil-works/pi-ai/providers/all` (the vendored package) is the
   single source of provider + model metadata.
2. **Main-process consumers** —
   `src/main/services/pi-ai/providers.ts` (provider list, OAuth flags,
   display names) and `pi-ai/model-utils.ts` / `pi-ai/provider-models.ts`
   (model lists: static catalog + online fetch + user custom models).
3. **dsh subprocess routing** —
   `src/main/services/dsh/provider-patch.ts` declares a dsh route for
   every provider the app holds a key for (route names resolved by
   `route-names.ts`, including the built-in
   `deepseek → deepseek-official` alias and user renames under
   `settings.models.dshRoutes`). The API key itself never enters the
   patch file — only an env-var name; the value is injected into the
   subprocess environment at launch.

So adding a provider means:

1. Contribute the provider upstream in
   [`earendil-works/pi`](https://github.com/earendil-works/pi).
2. Once it ships in a published `pi-ai` release, upgrade the vendored
   copy (new tarball `dist/` + provenance refresh — see
   [The vendored pi-ai package](#the-vendored-pi-ai-package)).
3. If the provider needs custom endpoint or credential handling on the
   dsh side, extend `profile-overrides.ts` / `provider-patch.ts`
   accordingly.

---

## Contributing a change

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the full
workflow. The short version:

```bash
# 1. Branch
git checkout -b feat/my-change main

# 2. Make the change
# ... edit files ...

# 3. Run the quality gates
npm run typecheck
npm run lint
npm run test

# 4. Commit
git add -A
git commit -m "feat(agents): add my new agent"

# 5. Push
git push origin feat/my-change

# 6. Open a PR
gh pr create --fill
```

CI runs the same four quality gates on every PR. Local green is
the contract.

### IPC contract checks

Two complementary modes (both must pass before pushing):

```bash
# Static — pure text parsing, no Electron needed (also runs in CI):
npm run ipc:contract

# Runtime — deep test against a LIVE app: invokes ~20 key window.api
# methods and validates return shapes against the contract.
# Needs the app running with CDP enabled:
ENABLE_CDP=1 EA_CDP_PORT=9444 npx electron .
EA_CDP_PORT=9444 npm run ipc:runtime
```

The runtime mode catches gaps static parsing cannot see (e.g. a
preload method removed while its channel constant survives, or a
handler returning an unexpected envelope).

A machine-readable snapshot of the preload surface also lives in
[`docs/ipc-api-dump.json`](./ipc-api-dump.json) — captured from a live
app over CDP (`capturedAt` 2026-09-06). After adding or changing a
preload API, regenerate it: launch the app with `ENABLE_CDP=1`, then
run `EA_CDP_PORT=9444 node scripts/devtools-cdp/cdp-api-dump.mjs`.

---

## Next steps

- [ARCHITECTURE.md](./ARCHITECTURE.md) — the big picture.
- [EAA_BRIDGE.md](./EAA_BRIDGE.md) — the bridge to the Rust
  backend.
- [AGENT_AUTHORING.md](./AGENT_AUTHORING.md) — how to write
  agents.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — the contributor
  workflow.
