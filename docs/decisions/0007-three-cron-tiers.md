# 0007 — Three cron tiers

**Status**: Accepted
**Date**: 2026-06-09
**Authors**: The maintainer team

## Context

The cron scheduler runs 18 agents. The agents have very different
operational characteristics:

- Some are **operational** — they need to run reliably because
  the system depends on them. Examples: `executor` (system
  self-maintenance), `governor` (data validation).
- Some are **advisory** — they generate a digest for the
  teacher. Missing a run is inconvenient but not catastrophic.
  Examples: `main` (morning push), `counselor` (daily study
  report).
- Some are **communication** — they send messages to parents.
  These are the most user-visible and the most
  failure-sensitive. Examples: `home_school`, `main`'s
  evening push.

The original design had a single cron tier — all jobs had the
same priority and the same retry policy. This was wrong for
two reasons:

1. **A failed `home_school` job at 08:30** (a parent message
   that didn't send) is much worse than **a failed `governor`
   data validation at 06:00** (a routine check).
2. **A failed `executor` self-maintenance at 01:00** shouldn't
   retry 3 times in a row — if it can't run at 01:00, it'll
   likely fail at 01:05 too.

## Decision

We split scheduled jobs into three tiers, with different
operational characteristics:

### 1. Operational

- **Examples**: `executor` (01:00), `governor` validation
  (06:00, 12:00, 18:00), `validator` (12:00, 18:00).
- **Retry policy**: 3 retries, exponential backoff.
- **On persistent failure**: disable the job, notify the
  teacher, file an issue.
- **Why this tier**: these jobs are the system's self-checks.
  If they fail, the data is in an unknown state, and we need
  the teacher to know.

### 2. Advisory

- **Examples**: `main` (07:00, 22:30), `counselor` (07:05),
  `academic` (07:05), `home_school` (08:30).
- **Retry policy**: 1 retry after 5 minutes.
- **On persistent failure**: log the failure, do not notify
  the teacher, do not disable.
- **Why this tier**: these jobs are nice-to-haves. A missed
  push is inconvenient but the teacher can re-run manually.

### 3. Communication

- **Examples**: `home_school` parent messages, `main` evening
  push.
- **Retry policy**: 3 retries with exponential backoff.
- **On persistent failure**: notify the teacher, do not
  disable (the next day's run might succeed).
- **Why this tier**: these are user-visible. A failed parent
  message needs to be flagged.

## Rationale

- **Different failure modes need different responses.** A failed
  data validation is a bug; a failed parent message is a
  process failure; a failed morning push is a transient error.
- **Different retry policies for different jobs.** An
  operational job should be aggressive; a communication job
  should be persistent.
- **Different notification policies.** Operational failures
  should page the teacher; advisory failures should be
  silent.

## Consequences

- **Good**: the right response for each failure type.
- **Good**: the teacher's notification inbox isn't full of
  advisory noise.
- **Bad**: more configuration. The agent's YAML entry has a
  new `cron_tier` field.
- **Bad**: the maintainer team has to choose a tier for each
  new agent. This is straightforward but easy to forget.

## Alternatives considered

- **Single tier with global defaults**: rejected because the
  needs are too different.
- **Per-job full configuration**: rejected as over-engineered.
  The three tiers capture the most important axes.

## References

- [`CRON.md#error-handling`](../CRON.md#error-handling) — the
  error handling per tier
- [`CONFIGURATION.md#configagentsyaml--the-agent-registry`](./CONFIGURATION.md#configagentsyaml--the-agent-registry) — the
  `cron_tier` field schema
