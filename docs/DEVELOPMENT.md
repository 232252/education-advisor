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
- [The in-tree vendored pi packages](#the-in-tree-vendored-pi-packages)
- [Running tests](#running-tests)
- [Linting and formatting](#linting-and-formatting)
- [Debugging tips](#debugging-tips)
- [Common tasks](#common-tasks)
- [Contributing a change](#contributing-a-change)

---

## Prerequisites

- **Node.js 22.x or later** (we use the latest LTS). Check with
  `node -v`.
- **npm 10.x or later** (bundled with Node 22). Check with
  `npm -v`.
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
| `vendor/pi-agent-core/`, `vendor/pi-ai/` | The LLM SDK + agent core, vendored in-tree (no sibling monorepo required) |
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

If all four pass, you're good to go.

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
`dist/main/index.js`.

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
│   ├── ipc/             # IPC handler modules — 11 files
│   ├── services/        # Service modules — 13 files
│   ├── preload/         # contextBridge bridge — 1 file
│   ├── utils/           # logger etc.
│   └── index.ts         # main entry
├── renderer/            # React 18 renderer
│   ├── pages/           # 9 page modules
│   ├── components/      # shared UI
│   ├── hooks/           # 12 custom hooks
│   ├── stores/          # 4 Zustand stores
│   ├── i18n/            # zh-CN + en-US
│   ├── lib/             # typed IPC client
│   └── main.tsx         # renderer entry
└── shared/              # code shared by main + renderer
    ├── ipc-channels.ts  # 90+ channel constants
    └── types/           # 539 lines of shared types
```

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
- **No `useEffect` for data fetching** — use the typed IPC client
  in `src/renderer/lib/ipc-client.ts` and a Zustand store instead.

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

## The in-tree vendored pi packages

The two `@earendil-works/*` packages (the LLM SDK and the agent
core) are referenced via `file:` paths in `package.json`:

```json
"dependencies": {
  "@earendil-works/pi-agent-core": "file:./vendor/pi-agent-core",
  "@earendil-works/pi-ai": "file:./vendor/pi-ai"
}
```

Both are **vendored in-tree** under `vendor/`. They were copied
from the upstream monorepo and stripped of `.map` source-map
files (to keep the repo small and pass electron-builder asar
integrity checks). The package metadata (`package.json`,
`dist/`, `README.md`, `LICENSE`) is intact.

This means:

- `git clone && npm ci` works without any sibling checkouts.
- Patches you make to `vendor/pi-agent-core/` or `vendor/pi-ai/`
  are committed to this repo (no separate PR dance).
- To update the vendored copy, run the vendoring script
  (see `scripts/vendor-pi.mjs`, if present) or copy the new
  `dist/` manually and re-commit.

> **Why not published npm versions?** The pi packages are not yet
> published to the public registry. Vendoring them is the only
> way to ship a self-contained build.

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

The provider list lives in the **vendored** `@earendil-works/pi-ai`
package, under `vendor/pi-ai/src/providers/`. To add a provider:

1. Add a new file under `vendor/pi-ai/src/providers/`.
2. Register it in the provider index in the same directory.
3. Re-run `npm run build` to pick it up.
4. Commit the change to `vendor/pi-ai/` and to the desktop code
   that uses the new provider.

If the upstream monorepo has your provider in a later release,
just re-vendor: copy `vendor/pi-ai/` from the latest source and
re-commit.

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

---

## Next steps

- [ARCHITECTURE.md](./ARCHITECTURE.md) — the big picture.
- [EAA_BRIDGE.md](./EAA_BRIDGE.md) — the bridge to the Rust
  backend.
- [AGENT_AUTHORING.md](./AGENT_AUTHORING.md) — how to write
  agents.
- [CONTRIBUTING.md](../CONTRIBUTING.md) — the contributor
  workflow.
