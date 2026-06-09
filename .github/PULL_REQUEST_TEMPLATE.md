# Pull request template — Education Advisor

> Thank you for your contribution. Please read
> [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR — it
> covers the workflow, the commit-message format, and the coding
> standards.

## What does this PR do?

<!-- One-paragraph summary of the change. Link to the relevant
     issue, if any. -->

**Fixes**: #
**Refs**: #

## Type of change

<!-- Pick one. Delete the others. -->

- [ ] 🐛 Bug fix (non-breaking change that fixes an issue)
- [ ] ✨ New feature (non-breaking change that adds functionality)
- [ ] 💥 Breaking change (fix or feature that would change existing behavior)
- [ ] 📝 Documentation (no code change)
- [ ] 🧹 Refactor / chore (no user-facing change)
- [ ] 🤖 Agent change (new or modified `agents/<id>/`)
- [ ] 🌐 Translation / i18n
- [ ] 🧪 Tests only

## How was this tested?

<!-- Describe the test plan you ran. -->

- [ ] `npm run typecheck` is green
- [ ] `npm run lint` is green
- [ ] `npm run test` is green
- [ ] `npm run build` produces a working installer (for changes that affect packaging)
- [ ] Manual smoke test (describe below)

**Smoke test notes**:

<!-- What did you click, what did you type, what did you observe? -->

## Checklist

- [ ] I have read [`CONTRIBUTING.md`](./CONTRIBUTING.md) and
      [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)
- [ ] My changes are documented (updated the relevant doc in `docs/`,
      or added a new doc)
- [ ] My changes are tested (added a `*.test.ts` next to the changed file)
- [ ] If this PR adds or changes a user-facing string, both `zh.json`
      and `en.json` are updated
- [ ] If this PR adds a new IPC channel, it is added to
      `src/shared/ipc-channels.ts`, the corresponding handler in
      `src/main/ipc/`, the `window.api` exposure in
      `src/main/preload/`, and the typed client in
      `src/renderer/lib/ipc-client.ts`
- [ ] If this PR adds a new agent, both `SOUL.md` and `AGENTS.md` are
      written, and a corresponding entry is added to
      `config/agents.yaml`
- [ ] I have **not** included any real student data, real teacher
      names, or any other PII in this PR (commits, screenshots, or
      comments)
- [ ] I have checked that my changes do not break the existing
      auto-update flow (no changes to the `latest.yml` schema, no
      changes to the `extraMetadata.version`)

## Screenshots / recordings (if applicable)

<!-- Drag images here. -->

## Additional context

<!-- Anything else the reviewer should know. CI quirks, known
     follow-ups, design trade-offs you made, links to the
     maintainer-team discussion thread, etc. -->
