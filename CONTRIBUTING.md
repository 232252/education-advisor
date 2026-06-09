# Contributing to Education Advisor

> **Thank you for taking the time to contribute.**
> This project is a teaching tool used by real class teachers, so we hold
> contributions to a high standard: every line of code should make the
> teacher's day a little easier, or make the system a little more
> trustworthy. We have written this guide to help you contribute in
> a way that gets your change merged quickly.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Where to start](#where-to-start)
- [Reporting bugs](#reporting-bugs)
- [Suggesting features](#suggesting-features)
- [Submitting a pull request](#submitting-a-pull-request)
- [Development setup](#development-setup)
- [Project structure](#project-structure)
- [Coding standards](#coding-standards)
- [Commit message format](#commit-message-format)
- [Adding a new agent](#adding-a-new-agent)
- [Adding a new IPC channel](#adding-a-new-ipc-channel)
- [Adding a new LLM provider](#adding-a-new-llm-provider)
- [Testing](#testing)
- [Documentation](#documentation)
- [Release process](#release-process)

---

## Code of conduct

This project follows the [Contributor Covenant](./CODE_OF_CONDUCT.md).
By participating, you agree to uphold it. Please report unacceptable
behavior to the maintainers (see the bottom of the COC file for
contact info).

---

## Where to start

- **🐛 Good first issues** — look for the
  [`good first issue`](https://github.com/232252/education-advisor/issues?q=is%3Aopen+label%3A%22good+first+issue%22)
  label in the issue tracker. These are scoped, well-documented, and
  have a mentor assigned.
- **📖 Documentation** — typos, broken links, unclear sentences, missing
  examples. Every doc PR is welcome; no contribution is "too small".
- **🌐 Translations** — add a new language file under
  `src/renderer/i18n/`. We currently ship zh-CN and en-US; we'd love
  ja-JP, ko-KR, es-ES, fr-FR.
- **🧪 Tests** — increase coverage on the agent loop, the EAA bridge,
  or the privacy engine. The full coverage report is in
  `coverage/index.html` after running `npm run test:coverage`.

If you're not sure where to start, **open an issue and ask**. We respond
within two business days.

---

## Reporting bugs

A great bug report has three properties: **reproducible**, **scoped**, and **kind**.

Before opening a bug:

1. Search the existing issues (open and closed) to make sure it's not
   already reported.
2. Try the latest `main` branch — your bug might be fixed already.
3. Disable any custom agents / skills / settings and reproduce.

When you open the bug report, use the **Bug report** template (it will
be selected automatically) and fill in:

- **What happened** — the actual behavior.
- **What you expected** — the expected behavior.
- **Steps to reproduce** — minimal, numbered, copy-paste-able.
- **Environment** — OS, Node version, app version (`Settings → About`),
  LLM provider + model, agent IDs involved.
- **Logs** — from the Logs page in Settings, or `userData/logs/main-*.log`
  if the app crashed.
- **Screenshots / screen recordings** — if the bug is visual.

Please **do not** include real student data in bug reports. Anonymize or
use the `examples/students/` set.

---

## Suggesting features

We love feature requests, but please follow the process:

1. Open an issue with the **Feature request** template.
2. Describe the **user story** (As a teacher, I want … so that …).
3. Describe the **proposed solution** at a high level.
4. List **alternatives considered** and why you rejected them.
5. Note any **breaking changes** the feature would require.
6. Mark whether you'd like to **implement it yourself** or are asking
   the maintainer team to pick it up.

The maintainers will respond within a week with one of:

- ✅ Accepted — we'll work with you on the design.
- ⏸️ Deferred — the feature is on the roadmap but not the current cycle.
- ❌ Declined — with a clear reason.

---

## Submitting a pull request

### The flow

```text
fork → branch → commits → push → PR → review → CI green → merge
```

### 1. Fork and branch

```bash
git clone https://github.com/<your-username>/education-advisor.git
cd education-advisor
git checkout -b feat/my-change main
```

Branch naming:

- `feat/...` — new feature
- `fix/...` — bug fix
- `chore/...` — refactor, dependency update, tooling
- `docs/...` — documentation only
- `test/...` — tests only
- `agent/...` — new or updated agent

### 2. Make the change

- Keep the change **scoped**. One feature, one fix, one refactor per PR.
- Keep the **diff small**. A 1 000-line PR is harder to review than five
  200-line PRs.
- Update **documentation** in the same PR.
- Update **tests** in the same PR.

### 3. Run the quality gates

```bash
npm run typecheck     # must be 0 errors
npm run lint          # must be 0 errors
npm run test          # must be all green
npm run build         # must succeed
```

CI runs the same gates on every PR. Local green is the contract.

### 4. Commit

We follow the [Conventional Commits](https://www.conventionalcommits.org/)
spec. See [Commit message format](#commit-message-format) below.

### 5. Push and open a PR

```bash
git push origin feat/my-change
gh pr create --fill
```

Fill in the PR template. The maintainers will review within two business
days. You can expect:

- An **automatic CI run** (typecheck + lint + test + build).
- A **maintainer review** — we might ask for changes. Please don't take
  it personally; the goal is to keep the codebase healthy for the next
  five years.
- A **squash-merge** when the PR is approved, with the PR title as the
  final commit message.

### 6. After merge

- Delete your branch (the GitHub UI prompts you).
- Update your local `main`: `git checkout main && git pull`.
- If your change was user-facing, consider opening a follow-up issue
  to write a release note (or ping the maintainer team to draft one).

---

## Development setup

### Prerequisites

- Node.js **22** or later (`node -v` should print `v22.x.x`)
- npm **10** or later (`npm -v` should print `10.x.x`)
- A working C++ toolchain (so `better-sqlite3` can compile its native binding)
  - Windows: `npm install --global windows-build-tools` (or use Visual Studio Build Tools)
  - macOS: `xcode-select --install`
  - Linux: `apt install build-essential python3`
- Git
- A code editor with TypeScript + React support (we use VS Code + Biome extension)

### One-time setup

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
npm ci
npm run build:eaa     # downloads the Rust eaa binary
```

### Daily development

```bash
# Terminal 1: dev servers (HMR for renderer, watch for main)
npm run dev

# Terminal 2: launch the Electron shell
npm run dev:electron
```

The renderer is at `http://localhost:5173`. DevTools open automatically
in detached mode.

### Common gotchas

- **`better-sqlite3` rebuild needed?** Run `npm rebuild better-sqlite3` after
  switching Node versions.
- **`EAA binary not found` on startup?** Run `npm run build:eaa` again, or
  place the binary manually in `resources/eaa-binaries/<platform>/`.
- **`preload not found` at startup?** The vite main config produces
  `dist/main/preload.js`; check that the file actually exists after
  `npm run build`.
- **Renderer can't reach the main process?** Check that
  `process.env.VITE_DEV_SERVER_URL` is set, or that you're loading the
  `dist/renderer/index.html` file directly.

---

## Project structure

The 30 000-foot overview is in [PROJECT_INTRO.md](./PROJECT_INTRO.md#a-30000-foot-tour).
This section covers the parts you'll touch as a contributor.

```
src/
├── main/                # Electron main process (Node 22)
│   ├── ipc/             # IPC handler modules — 11 files
│   ├── services/        # Service modules — 13 files
│   ├── preload/         # contextBridge bridge — 1 file
│   ├── utils/           # logger etc.
│   └── index.ts         # main entry — read this first
├── renderer/            # React 18 renderer
│   ├── pages/           # 9 page modules — read these to learn the app
│   ├── components/      # shared UI — keep small
│   ├── hooks/           # 12 custom hooks
│   ├── stores/          # 4 Zustand stores
│   ├── i18n/            # zh-CN + en-US
│   ├── lib/             # typed IPC client
│   └── main.tsx         # renderer entry
└── shared/              # code shared by main + renderer
    ├── ipc-channels.ts  # 90+ channel constants
    └── types/           # 539 lines of shared types
```

The two most important files for a new contributor are:

- `src/main/index.ts` — the main process entry, 246 lines, reads end-to-end in 10 minutes.
- `src/renderer/App.tsx` — the renderer entry, 46 lines, shows the routing.

The two most important **directories** for a feature contributor are:

- `src/main/services/` — the business logic lives here.
- `src/renderer/pages/` — the UI lives here.

---

## Coding standards

### TypeScript

- **Strict mode** is on. `any` is allowed only at module boundaries (the IPC bridge
  can use `unknown` and validate with TypeBox).
- **Path aliases**: `@main/*`, `@renderer/*`, `@shared/*`.
- **No default exports** for modules with multiple exports; use named exports.
- **No circular dependencies** between `src/main/` and `src/renderer/`.
- All public functions have a JSDoc comment explaining the contract.

### React

- **Function components** only (no class components).
- **Hooks** follow the [rules of hooks](https://react.dev/reference/rules/rules-of-hooks).
- **No inline styles** for anything that needs to be themable; use the
  Tailwind utility classes or the CSS variables in `src/renderer/styles/globals.css`.
- **No `useEffect` for data fetching** — use the typed IPC client in
  `src/renderer/lib/ipc-client.ts` and a Zustand store instead.

### Linting

- **Biome 2.3** is the source of truth. Run `npm run lint:fix` to auto-fix
  the safe ones.
- The custom a11y rules (`useButtonType`, `noLabelWithoutControl`, …) are
  `warn`, not `error`, but please address them in new code.

### File size

- Soft cap at **500 lines per file**. The current exception is
  `src/main/services/agent-service.ts` (1 031 lines) — it's on the
  refactor list.

### Naming

- Files: `kebab-case.ts` for non-component files; `PascalCase.tsx` for
  React components.
- Classes / types: `PascalCase`.
- Functions / variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for IPC channel names, `camelCase` for the rest.

### Error handling

- Never `catch` an error and ignore it. Either re-throw, log, or
  surface to the user via the toast store.
- Use `unknown` and narrow with `instanceof Error` or a type guard.
- The privacy engine and the EAA bridge are the two places where errors
  **must** be human-readable. Every other layer can be technical.

### i18n

- Every user-facing string in the renderer goes through `useT()` from
  `src/renderer/i18n/index.ts`.
- Add the new key to **both** `zh.json` and `en.json` in the same PR.
- The key naming convention is `domain.subdomain.label`, e.g.
  `agents.class-monitor.description`.

### Security

- Never log a real API key, a real student name, or a real phone number.
- The privacy engine is **always on** by default. If you need to
  disable it for a specific call, document the reason in a comment.
- The renderer **never** touches `fs`, `path`, `child_process`, or
  `ipcRenderer` directly. Everything goes through the preload bridge.

---

## Commit message format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) spec.

```
<type>(<scope>): <short summary>

<body — explain the why, not the what>

<footer — references to issues, breaking changes, etc.>
```

**Types**: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`,
`style`, `build`, `ci`, `agent`, `skill`.

**Scopes**: `main`, `renderer`, `shared`, `agent`, `eaa`, `privacy`,
`cron`, `i18n`, `theme`, `build`, `ci`, `docs`.

**Examples**:

```text
feat(agents): add new home_school outreach template

The home_school agent now generates a parent-message template that
includes the student's conduct delta and the next-day homework plan.

Refs: #142
```

```text
fix(privacy): handle empty deanonymize input

Previously, calling deanonymize('') threw a NullPointerException in
the Rust engine. Now it returns an empty string.

Fixes: #205
```

```text
docs(README): add macOS build instructions

Refs: #312
```

---

## Adding a new agent

A new agent is a pair of Markdown files plus a YAML entry. The full guide
is in [`docs/AGENT_AUTHORING.md`](./docs/AGENT_AUTHORING.md), but the
TL;DR:

```bash
# 1. Create the directory
mkdir -p agents/my-new-agent

# 2. Write SOUL.md (personality + scope)
cat > agents/my-new-agent/SOUL.md <<'EOF'
# My New Agent

## 角色
A short description in Chinese of what this agent does.

## 核心职责
- Bullet 1
- Bullet 2

## 工具清单
- `eaa.score`
- `eaa.history`
EOF

# 3. Write AGENTS.md (working rules, references SMALL_MODEL_RULES.md)
cat > agents/my-new-agent/AGENTS.md <<'EOF'
# Working rules

See /config/SMALL_MODEL_RULES.md for the global rulebook.
EOF

# 4. Register the agent in config/agents.yaml
#    (add a new entry to the agents: list with id, name, role, capabilities, schedule)

# 5. Restart the app, see the agent in the Agents page
```

---

## Adding a new IPC channel

1. Add the constant to `src/shared/ipc-channels.ts`.
2. Add the handler in the relevant `src/main/ipc/<domain>-handlers.ts` file.
3. Expose the method on `window.api` in `src/main/preload/index.ts`.
4. Add the method to the typed client in `src/renderer/lib/ipc-client.ts`.
5. Add a test in `tests/main/`.
6. Update the documentation (`docs/` and the relevant JSDoc).

---

## Adding a new LLM provider

The provider list lives in the `@earendil-works/pi-ai` package, **not** in this
repository. To add a provider:

1. Open an issue here describing the use case.
2. File a PR against
   [`earendil-works/pi-ai`](https://github.com/earendil-works/pi-ai) with the
   new provider file.
3. Once the provider is merged upstream, open a PR here to pin the new
   version in `package.json`.

---

## Testing

We use [Vitest](https://vitest.dev/) for unit and integration tests. The
config lives in `vitest.config.ts` with two projects:

- **`renderer`** — jsdom environment, tests under `src/renderer/**/__tests__/`
- **`main`** — node environment, tests under `src/main/**/__tests__/`
  and `tests/main/**`

The e2e test is under `tests/e2e/` and exercises the full agent loop
without spawning a real Electron process.

### Conventions

- One test file per source file. `foo.ts` → `foo.test.ts`.
- One `describe` per exported function, one `it` per behavior.
- Test names read as sentences: `it('returns null when the student does not exist')`.
- Use real SQLite (in-memory or `node:os.tmpdir()`) for DB tests, not mocks.
- Use `vi.fn()` for LLM / network mocks, but only at the IPC boundary,
  not deep in the service layer.

### Running

```bash
npm test                 # run all
npm run test:watch       # re-run on change
npx vitest --run eaa     # run a specific file
```

---

## Documentation

Documentation lives in `docs/`. The convention:

- One file per topic. Topic is a noun (`architecture`, `eaa-bridge`), not
  a sentence.
- Every doc has a **table of contents** at the top.
- Code samples in docs are **copy-paste-runnable**. If a code sample needs
  a setup step, say so in the surrounding prose.
- Every doc links back to `README.md` and `PROJECT_INTRO.md` for context.

When you add a feature, add a doc. When you change a feature, update the
doc. When you remove a feature, mark the doc as deprecated and link to
the new location.

---

## Release process

The maintainer team follows a monthly release cadence:

1. **Week 1** — open the milestone, triage incoming issues, finalize scope.
2. **Week 2** — feature freeze, focus on bug fixes and docs.
3. **Week 3** — release candidate (tag `v0.x.0-rc.N`), run the
   e2e test suite, smoke-test the install.
4. **Week 4** — release (tag `v0.x.0`), update `CHANGELOG.md`, publish
   the auto-update manifest, announce on the discussion board.

Hotfix releases (`v0.x.Y`) ship on demand for security or data-integrity
issues.

---

## Questions?

- The [discussion board](https://github.com/232252/education-advisor/discussions)
  is the right place for "how do I …" questions.
- The issue tracker is for "this is broken" / "I'd like this feature".
- For security issues, see [`SECURITY.md`](./SECURITY.md) — please do
  **not** open a public issue for security reports.

Thanks again for contributing. The maintainers are friendly; please
don't be shy.
