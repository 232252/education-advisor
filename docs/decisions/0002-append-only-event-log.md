# 0002 — Append-only event log

**Status**: Accepted
**Date**: 2026-06-09
**Authors**: The maintainer team

## Context

The project needs to store every student-related event: conduct
points, conversations, grades, lab incidents, etc. This data is
used for:

- Real-time queries (current score, today's events).
- Historical analysis (weekly trends, year-over-year comparison).
- Audit (parent complaints, school audits).

The naive approach is a **mutable state store**: a SQL table with
a row per student, and the conduct score is a column that gets
updated in place. This is the standard approach for "CRUD" apps.

But:

- **Auditability**: a mutable store doesn't preserve history. If
  Alice's score was 85 yesterday and 78 today, the store says
  78, with no record of the change.
- **Reproducibility**: a mutable store can't be replayed. If a
  bug in the recalculation step produces wrong scores, we can't
  reproduce the bug.
- **Concurrency**: a mutable store requires careful locking on
  every update. A class teacher recording 5 events per minute
  would generate a lot of lock contention.

## Decision

We use an **append-only event log** as the source of truth:

- Every event is a JSON-Lines record appended to `events.log`.
- The "current state" (e.g. Alice's current score) is a
  **projection** of the event log, computed on demand by replay.
- Events can never be deleted. To "undo" an event, we append a
  new `REVERT` event that points to the original event.

## Rationale

- **Auditability**: the full history is in one file. Any state
  can be explained by replaying from the beginning.
- **Reproducibility**: the same event log always produces the
  same projection. Bugs are reproducible.
- **Concurrency**: append-only writes are O(1) and require only
  a file lock for atomicity. No read-modify-write cycles.
- **Simplicity**: the schema is one file, one row per event.
  No joins, no migrations.
- **Audit log**: the event log **is** the audit log. We don't
  need a separate audit table.

## Consequences

- **Good**: full audit trail, deterministic replay, simple schema.
- **Good**: easy to back up (one file).
- **Bad**: queries that span the whole log can be slow for very
  large classes. Mitigated by an in-memory index
  (`events-by-student.json`) that's recomputed on every write.
- **Bad**: storage grows unbounded. Mitigated by an `eaa prune`
  command that archives old events to cold storage.
- **Bad**: schema changes require a migration. Mitigated by
  forward-compatibility (new fields are optional).

## Alternatives considered

- **Mutable SQL store**: rejected for the reasons above.
- **Event log + materialized state**: we considered this, but
  the materialized state would need to be invalidated on every
  event, which adds complexity. Replay on demand is fast enough
  for our use cases (a class with 50 students and 10 events per
  day takes ~5 ms to replay).
- **CRDT**: rejected as over-engineered for the use case.

## References

- [`PROJECT_INTRO.md#deep-dive-the-data-engine`](../PROJECT_INTRO.md#deep-dive-the-data-engine) — the data engine architecture
- [`EAA_BRIDGE.md#the-protocol`](./EAA_BRIDGE.md#the-protocol) — the bridge protocol
