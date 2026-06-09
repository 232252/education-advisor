# Backlog

> **The maintainer team's working backlog.** Items are added to
> this file by the maintainers and by community contributors
> through the
> [`good first issue`](https://github.com/232252/education-advisor/issues?q=is%3Aopen+label%3A%22good+first+issue%22)
> workflow.
>
> **The full feature backlog is in
> [`docs/features/`](./features/)** as standalone feature
> briefs. This file is the at-a-glance summary.

## Status legend

- 🟢 **Shipped** — in a released version.
- 🟡 **In progress** — assigned to a maintainer or contributor,
  with a target release.
- ⚪ **Planned** — accepted into the roadmap, target release
  not yet set.
- 🔵 **Considering** — under discussion, not yet accepted.

## Pillar 1: Multi-class support

| Item | Status | Owner | Target |
| --- | --- | --- | --- |
| Multi-class data model | ⚪ Planned | — | v0.4.0 (Q3 2026) |
| Cross-class analytics page | ⚪ Planned | — | v0.4.0 (Q3 2026) |
| Per-class agent overrides | ⚪ Planned | — | v0.4.0 (Q3 2026) |
| Mobile companion (read-only v0) | ⚪ Planned | — | v0.4.0 (Q3 2026) |
| Tablet view pass | ⚪ Planned | — | v0.4.0 (Q3 2026) |

## Pillar 2: Plugin marketplace

| Item | Status | Owner | Target |
| --- | --- | --- | --- |
| Plugin manifest format | ⚪ Planned | — | v0.5.0 (Q4 2026) |
| Verified plugin registry | ⚪ Planned | — | v0.6.0 (Q1 2027) |
| Plugin sandboxing | ⚪ Planned | — | v0.6.0 (Q1 2027) |
| Plugin marketplace UI | ⚪ Planned | — | v0.6.0 (Q1 2027) |

## Pillar 3: Cross-platform parity

| Item | Status | Owner | Target |
| --- | --- | --- | --- |
| macOS release tier (signed + notarized) | ⚪ Planned | — | v0.4.0 (Q3 2026) |
| Linux release tier (.deb + AppImage) | ⚪ Planned | — | v0.5.0 (Q4 2026) |
| Windows ARM64 installer | ⚪ Planned | — | v0.5.0 (Q4 2026) |
| Tauri parity build v0 | ⚪ Planned | — | v0.7.0 (Q2 2027) |

## Pillar 4: Voice + on-device intelligence

| Item | Status | Owner | Target |
| --- | --- | --- | --- |
| Voice channel (push-to-talk) | ⚪ Planned | — | v0.5.0 (Q4 2026) |
| Always-on capture v2 | ⚪ Planned | — | v0.7.0 (Q2 2027) |
| On-device LLM (4–7B quantized) | ⚪ Planned | — | v0.7.0 (Q2 2027) |

## Pillar 5: Privacy, compliance, audit

| Item | Status | Owner | Target |
| --- | --- | --- | --- |
| Compliance report generator | ⚪ Planned | — | v0.6.0 (Q1 2027) |
| End-to-end encryption (desktop ↔ EAA) | ⚪ Planned | — | v0.7.0 (Q2 2027) |
| Differential privacy for aggregates | ⚪ Planned | — | v0.8.0 (Q3 2027) |

## Pillar 6: Educational outcomes

| Item | Status | Owner | Target |
| --- | --- | --- | --- |
| Opt-in usage telemetry | ⚪ Planned | — | v0.6.0 (Q1 2027) |
| Case studies | ⚪ Planned | — | v0.8.0 (Q3 2027) |
| Open data release (de-identified) | ⚪ Planned | — | v0.8.0 (Q3 2027) |

## Smaller items

These are smaller-scope improvements, usually a single PR:

| Item | Status | Owner | Target |
| --- | --- | --- | --- |
| Better Chinese name disambiguation in the privacy engine | 🔵 Considering | — | — |
| International phone number support | 🔵 Considering | — | — |
| Address parsing for non-mainland addresses | 🔵 Considering | — | — |
| Per-class theming | 🔵 Considering | — | — |
| Bulk student import from Excel | 🔵 Considering | — | — |
| Bulk event rollback (with audit) | 🔵 Considering | — | — |
| Agent prompt versioning | 🔵 Considering | — | — |
| Agent A/B testing framework | 🔵 Considering | — | — |
| LLM call cost cap per agent | 🔵 Considering | — | — |
| Per-student risk dashboard drill-down | 🔵 Considering | — | — |
| Parent-message templates (5+ languages) | 🔵 Considering | — | — |
| Class-schedule integration (ICS import) | 🔵 Considering | — | — |
| Read-only web view for parents | ⚪ Planned | — | v0.9.0 (Q3 2027) |
| Education-office dashboard | ⚪ Planned | — | v1.0.0 (Q4 2027) |

## "Won't do" (yet)

These have been considered and explicitly deferred:

- ❌ **Multi-tenant SaaS** — the project is local-first by
  design. SaaS would require a different architecture.
- ❌ **LMS integration** (Moodle, Canvas) — the export to
  Feishu Bitable is the integration; we don't compete with
  the LMS.
- ❌ **Video / image analysis pipeline** — the voice channel is
  the edge of the data-capture surface; we don't go further.
- ❌ **Custom LLM training** — we use hosted / local models
  as-is, we don't fine-tune.
- ❌ **Mobile-first rewrite** — the desktop is the cockpit;
  the mobile is read-only.

## How to add an item

1. Open an issue using the **Feature request** template.
2. If the maintainer team accepts it, the issue gets added to
   the appropriate pillar here.
3. The maintainer team updates the **Owner** column when the
   item is picked up.

## How to claim an item

Comment on the corresponding issue. The maintainer team will
assign you within 2 business days.
