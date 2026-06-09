# Development

> **How to set up your dev environment and start hacking on the
> codebase.** This document is for contributors — if you only want
> to use the app, see [QUICK_START.md](./QUICK_START.md) instead.

## Table of contents

- [Prerequisites](#prerequisites)
- [The two repositories](#the-two-repositories)
- [Initial setup](#initial-setup)
- [Daily development loop](#daily-development-loop)
- [Project structure](#project-structure)
- [Coding standards](#coding-standards)
- [TypeScript aliases](#typescript-aliases)
- [The local Pi monorepo](#the-local-pi-monorepo)
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

## The two repositories

This project is **half** of a two-repo system:

1. **This repo** (`education-advisor`, the desktop client) — Electron
   + React + TypeScript. What you're reading.
2. **The EAA CLI repository** (`education-advisor`, the Rust CLI) —
   Rust, the data engine. See
   <https://github.com/232252/education-advisor>.

For day-to-day UI work, you only need the desktop repo. For
work that touches the data engine (adding a new EAA subcommand,
fixing a bug in the privacy engine, etc.), you need both.

The two repos are **kept in sync** via a versioned, downloaded
binary: the `npm run build:eaa` script fetches the matching
Rust binary for your platform.

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

### 3. Fetch the EAA binary

```bash
npm run build:eaa
```

See [`EAA_BRIDGE.md`](./EAA_BRIDGE.md#manual-install) for the
manual install if this fails.

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

## The local Pi monorepo

The two `@earendil-works/*` packages (the LLM SDK and the agent
core) are referenced via `file:` paths in `package.json`:

```json
"dependencies": {
  "@earendil-works/pi-agent-core": "file:../pi/packages/agent",
  "@earendil-works/pi-ai": "file:../pi/packages/ai"
}
```

This means the project expects a sibling `pi` directory
containing the monorepo source:

```
parent-dir/
├── education-advisor/        # this repo
└── pi/                    # the Pi monorepo
    └── packages/
        ├── agent/
        └── ai/
```

If you don't have the Pi monorepo locally, `npm ci` will fail
with a "file not found" error. To work around this:

### Option A: Clone the Pi monorepo

```bash
cd ..  # go to the parent of this repo
git clone https://github.com/earendil-works/pi.git
cd education-advisor
npm ci
```

### Option B: Use the published versions

If you have the `pi` packages on npm, edit `package.json` to use
the published versions:

```json
"dependencies": {
  "@earendil-works/pi-agent-core": "^0.5.0",
  "@earendil-works/pi-ai": "^0.5.0"
}
```

Then `npm ci` will work without the local monorepo.

> **Note**: Option A is recommended for development. The
> `vite.config.main.ts` and `tsconfig.json` are tuned to the
> monorepo layout; published versions may need a Vite config
> adjustment.

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

1. Update the version in `package.json`'s `eaa-pin` comment (or
   the `EAA_RELEASE_TAG` env var).
2. Run `npm run build:eaa`.
3. Commit the new binary in `resources/eaa-binaries/<platform>/`.
4. Update `docs/CHANGELOG.md` (well, the root `CHANGELOG.md`).

### Add a new LLM provider

The provider list lives in the `@earendil-works/pi-ai` package,
**not** in this repository. To add a provider:

1. Open an issue here describing the use case.
2. File a PR against
   [`earendil-works/pi-ai`](https://github.com/earendil-works/pi-ai)
   with the new provider file.
3. Once the provider is merged upstream, open a PR here to pin
   the new version in `package.json`.

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
