# 0001 — Keep the Rust and TypeScript codebases in separate repos

**Status**: Accepted
**Date**: 2026-06-09
**Authors**: The maintainer team

## Context

The project has two distinct codebases:

- The **Rust data engine** (`education-advisor/core/eaa-cli/`) — a
  stable, audited, audited data engine that handles all student
  data writes.
- The **TypeScript desktop client** (`education-advisor/`, this repo)
  — an Electron + React app that provides the UI and orchestrates
  the agents.

The two codebases are tightly coupled at runtime (the desktop
client spawns the Rust CLI as a child process), but they have
different release cadences, different reviewers, and different
deployment stories.

We considered three options:

1. **Monorepo** — one repo with both, using Cargo workspaces +
   npm workspaces. Standard tooling.
2. **Two repos with binary distribution** — this repo + a separate
   repo for the Rust code. The Rust code is published as a binary
   per platform; the desktop client downloads the binary.
3. **One repo, two top-level directories** — the simplest possible
   layout.

## Decision

We chose **option 2**: two repos, with the Rust CLI published as
a pre-built binary per platform.

## Rationale

- **Separation of concerns.** The Rust side is a stable, audited
  data engine. The TypeScript side is where the agents, the UI,
  and the LLM integration live. Keeping them in separate repos
  lets the data engine be reviewed and re-used independently.
- **Reproducible builds.** When the desktop client downloads the
  Rust binary, it's a **specific tagged artifact** with a SHA-256
  manifest. The user can verify the binary's integrity before
  running it. A monorepo would mean the binary is re-built per
  machine, which is harder to verify.
- **Different release cadences.** The Rust CLI changes rarely
  (schema changes, security fixes). The desktop client changes
  often (UI improvements, new agents, LLM provider updates). Two
  repos with their own release workflows are easier to manage.
- **Different reviewer pools.** The Rust code is reviewed by
  Rust-experienced maintainers; the TypeScript code is reviewed by
  TypeScript-experienced maintainers. Two repos let us assign
  CODEOWNERS per language.
- **Smaller repo size.** The Rust crates are not needed for
  desktop-only contributors. Two repos keep the desktop repo
  light.

## Consequences

- **Good**: cleaner repo for desktop-only contributors. The
  `npm ci` step is fast (no Rust toolchain required for most
  development).
- **Good**: the Rust CLI can be re-used by other clients
  (e.g. a CLI-only deployment, a server deployment, a different
  GUI).
- **Bad**: contributors who work on both sides have to clone two
  repos.
- **Bad**: the version pinning between the desktop client and the
  Rust CLI must be maintained manually (via
  `EAA_RELEASE_TAG`).

## Alternatives considered

- **Option 1 (monorepo)**: rejected because of the build-time
  coupling. The Rust toolchain is not available on all
  contributors' machines, and the `cargo build` step would slow
  down the desktop-only CI matrix significantly.
- **Option 3 (one repo, two directories)**: rejected because the
  Rust code is large enough that it would dominate the repo's
  size, and the two languages have different tooling and review
  processes.

## References

- [`EAA_BRIDGE.md`](../EAA_BRIDGE.md) — the bridge protocol
- [`README.md`](../README.md#architecture-at-a-glance) — the
  architecture diagram
- [`docs/QUICK_START.md#4-fetch-the-rust-eaa-binary`](../QUICK_START.md#4-fetch-the-rust-eaa-binary) — how the binary is fetched
