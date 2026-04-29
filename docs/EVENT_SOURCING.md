# Event Sourcing Architecture

## Core Principles

1. **Events are immutable** - Once written, never modified or deleted
2. **State is derived** - Current scores are computed by replaying events
3. **Audit trail is complete** - Every change has a traceable history
4. **Revert, don't delete** - Use `reverted_by` to logically undo events

## Event Structure

```json
{
  "event_id": "evt_a1b2c3d4e5f6",
  "entity_id": "ent_001",
  "event_type": "CONDUCT_DEDUCT",
  "reason_code": "SPEAK_IN_CLASS",
  "original_reason": "物理课讲话",
  "score_delta": -2.0,
  "operator": "班主任",
  "timestamp": "2026-04-17T14:30:00",
  "is_valid": true,
  "reverted_by": null,
  "note": "课堂讲话",
  "category_tags": ["课堂纪律"]
}
```

## Score Computation

```
base_score = 100
for each event where is_valid && reverted_by is null:
    score += event.score_delta
```

## Data Integrity

- **Atomic writes**: File-based mode uses write-to-temp + rename
- **File locking**: `fs2` exclusive lock prevents concurrent writes
- **Strong typing**: Rust type system prevents invalid events at compile time
- **Validation**: `eaa validate` checks all events against schema
- **Append-only (PG)**: PostgreSQL trigger blocks UPDATE/DELETE on events table

## Privacy Engine

Student names are mapped to pseudonyms (S_001..S_052) using AES-256-GCM encryption.

```
真名 → eaa privacy anonymize → S_024
S_024 → eaa privacy deanonymize → 真名
```

Mapping table is encrypted and stored separately from event data.
