# Standard Operating Procedure

> **The SOP for working on this codebase.** This is the short
> version — the long version is in
> [`CONTRIBUTING.md`](../CONTRIBUTING.md) and
> [`DEVELOPMENT.md`](../DEVELOPMENT.md). Read this first; it
> covers the must-knows in 5 minutes.

## The 6-step flow

1. **Worktree** — `git worktree add ../education-advisor-feat feature/my-change`
2. **Quality gate (local)** — `npm run typecheck && npm run lint && npm run test`
3. **Self-check (manual)** — `npm run build && npm run dev:electron`,
   click through the changed flow, confirm no regressions
4. **Peer review** — push, open a PR, wait for a review
5. **CI gate** — wait for the green CI badge
6. **Merge + cleanup** — squash-merge, delete the worktree and
   the remote branch

## The must-knows

- **Never commit to `main` directly.** Always a branch + PR.
- **Never commit `dist/`, `release/`, `node_modules/`, `*.log`,
  `verify-*`, `e2e-test.mjs`, `.env`, or the AI tool directories
  (`.agent_history/`, `.arts/`, etc.). They're in `.gitignore`
  for a reason.
- **Never include real student data, real teacher names, or any
  other PII** in commits, screenshots, or comments. Use the
  `examples/students/` data set.
- **Always run the quality gate locally before pushing.** CI
  will catch it, but a local run is faster.
- **Always update the i18n files when you add a user-facing
  string.** Both `zh.json` and `en.json`, in the same PR.
- **Always write tests for new code.** Coverage is currently
  low; every PR should add at least one test.
- **Always update `CHANGELOG.md` for user-facing changes.**
  The maintainer team uses it for the release notes.

## The file size budget

- Soft cap at **500 lines per file**.
- If your change pushes a file over the cap, refactor in the
  same PR.
- The current exceptions (in the refactor list):
  - `src/main/services/agent-service.ts` (1 031 lines)
  - `src/main/services/pi-ai-service.ts` (946 lines)
  - `src/renderer/pages/Settings/SettingsPage.tsx` (~740 lines)
  - `src/renderer/stores/chatStore.ts` (536 lines)
  - `src/shared/types/index.ts` (539 lines)

## The naming conventions

- Files: `kebab-case.ts` for non-component files,
  `PascalCase.tsx` for React components.
- Classes / types: `PascalCase`.
- Functions / variables: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for IPC channel names,
  `camelCase` for the rest.

## The commit message format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

<body — explain the why, not the what>

<footer — references to issues, breaking changes, etc.>
```

Examples:

```text
feat(agents): add new home_school outreach template

Refs: #142
```

```text
fix(privacy): handle empty deanonymize input

Previously, calling deanonymize('') threw a NullPointerException
in the Rust engine. Now it returns an empty string.

Fixes: #205
```

## The release cadence

The maintainer team follows a monthly cadence:

- **Week 1**: open the milestone, triage issues, finalize scope.
- **Week 2**: feature freeze, focus on bug fixes and docs.
- **Week 3**: release candidate, smoke-test the install.
- **Week 4**: release, update `CHANGELOG.md`, publish the
  auto-update manifest, announce on the discussion board.

Hotfix releases ship on demand for security or data-integrity
issues.

## The escalation path

If you need help, in order:

1. **The docs** — `docs/` is comprehensive.
2. **The Discussions** — for usage questions.
3. **The Issues** — for actionable, scoped work.
4. **The maintainer team** — for security issues, see
   [`SECURITY.md`](../SECURITY.md).

## The "do not" list

- ❌ Do not run `npm run package:portable` on a machine that
  doesn't have the matching EAA binary in `resources/eaa-binaries/`.
  The result is a 0-byte .exe.
- ❌ Do not commit `resources/icon.ico` if you've replaced it
  with a real icon — make sure the new one is a valid 256x256
  .ico.
- ❌ Do not add new dependencies without first checking
  `npm ls <package>` for license compatibility (MIT / Apache
  2.0 only) and for known security issues
  (`npm audit`).
- ❌ Do not push directly to `main` — always a branch + PR.
- ❌ Do not include real student data in tests, fixtures, or
  documentation.
