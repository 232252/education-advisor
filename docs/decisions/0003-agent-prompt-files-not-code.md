# 0003 — Agent prompts are Markdown files, not TypeScript classes

**Status**: Accepted
**Date**: 2026-06-09
**Authors**: The maintainer team

## Context

In the early prototypes (v0.1, v0.5 of the original
`education-advisor` project), each agent was a TypeScript class
that extended a base `Agent` interface. The prompt was a string
constant, and the agent's behavior was a mix of code and prompt.

This had two problems:

1. **Prompt engineering required a code change.** To tweak an
   agent's prompt, you had to edit the TypeScript, recompile,
   and re-deploy. Slow iteration cycle.
2. **Non-developers couldn't contribute prompts.** A school
   administrator with great ideas for the `home_school` agent's
   tone couldn't easily contribute.

## Decision

Agents are **plain Markdown files**:

- `agents/<id>/SOUL.md` — the system prompt (personality, role,
  scope, tools).
- `agents/<id>/AGENTS.md` — the working rules (output format,
  tool patterns, failure handling).

The agent service reads these files at boot, concatenates them
with the global `config/SMALL_MODEL_RULES.md` and any active
skills, and passes the result to the LLM as the system prompt.

The agent's **registration** (id, name, role, model tier,
capabilities, schedule) is a YAML entry in
`config/agents.yaml`.

## Rationale

- **Fast iteration.** A prompt change is a Markdown edit and an
  app restart. No TypeScript, no compile, no re-deploy.
- **Non-developer contribution.** Anyone who can write Markdown
  can contribute an agent. The maintainer team only needs to
  review the prompt, not the code.
- **Version control friendly.** Markdown diffs are easy to
  review. The prompt's history is the agent's history.
- **Multi-language support.** A non-Chinese agent prompt is just
  a non-Chinese `SOUL.md`. No code changes needed.
- **Separation of concerns.** The agent's **what** (prompt) and
  **how** (capability list, schedule) are in different files. The
  prompt author doesn't need to know about the IPC channels; the
  capability author doesn't need to know about prompt engineering.

## Consequences

- **Good**: faster prompt iteration, broader contribution base.
- **Good**: easier to maintain a library of community
  contributions.
- **Bad**: prompt authors can write prompts that look fine but
  are subtly broken (e.g. ambiguous tool references). We
  mitigate with the `npm run test` and the manual smoke test in
  the Agents page.
- **Bad**: we lose TypeScript's type safety on the prompt
  itself. The prompt is treated as a string. We mitigate with
  the `validate-prompt.ts` script (in `scripts/`) that checks
  for common mistakes (missing `## Tools` section, missing
  boundary section, etc.).

## Alternatives considered

- **TypeScript classes with a `.prompt.md` resource**: rejected
  because the prompt is still loaded from a resource, not a file.
- **YAML prompts**: rejected because YAML is harder to write
  long-form content in.
- **JSON prompts**: rejected for the same reason.

## References

- [`AGENT_AUTHORING.md`](../AGENT_AUTHORING.md) — the full guide
  to writing agents
- [`CONFIGURATION.md#configagentsyaml--the-agent-registry`](./CONFIGURATION.md#configagentsyaml--the-agent-registry) — the registry schema
