# 0008 — EAA CLI output stays single-language (zh) until real demand

**Status**: Accepted
**Date**: 2026-09-07
**Authors**: The maintainer team

## Context

The renderer UI is fully bilingual since R8 (i18n bare-Chinese
baseline at zero; every UI string routes through `t()`/`tr()` with
both `zh.json` and `en.json` populated). However, GUI audits in en
mode still surface Chinese text inside pages. Tracing each hit to its
source shows three distinct categories:

1. **Enumerated labels from the Rust binary.** `EAARiskLevel`
   (`低`/`中`/`高`/`极高`) is baked into the EAA binary's JSON output
   and mirrored as literal keys in `src/shared/types/eaa.ts`.
2. **Reason-code labels from config.** All 22 labels in
   `config/reason-codes.json` (e.g. `SPEAK_IN_CLASS` → `课堂讲话`)
   are single-language Chinese; the binary reads this file and the
   renderer re-reads it for dashboard charts
   (`REASON_CODE_LABELS` in `ReasonDistCard.tsx`).
3. **Free-text CLI/AI output.** `doctor` issue descriptions, table
   headers from `--format table` renders, and all LLM-generated
   agent/chat text.

## Options considered

- **A. Renderer-side mapping (bounded enums only).** Keep data flow
  untouched; add i18n keys for the 4 risk levels + 22 reason codes
  and format at render time. Feasible — the sets are finite and
  code-keyed — but touches every display site (charts, tables,
  reports, agent prompt renderers) and duplicates the vocabulary in
  a second source of truth.
- **B. Bilingual config + binary support.** Add `label_en` to
  `reason-codes.json` and teach the Rust binary to emit per-locale
  output. Cross-repo version coupling (binary ↔ config schema),
  breaks the append-only simplicity of the data file, and gains
  nothing for the current user base.
- **C. Keep original text.** Chinese remains the data language for
  EAA-domain values, exactly like student names, class names and
  session titles.

## Decision

**C — keep original**, with A pre-approved as the follow-up path if
demand appears:

- The product's users are Chinese teachers; reason-code labels are
  the school's own conduct vocabulary — closer to user data than to
  UI chrome. An English teacher reading `课堂讲话` is no worse served
  than one reading a student's name.
- Free-text output (category 3) is unfixable without binary/LLM-side
  changes; doing A for categories 1–2 only yields a mixed-language
  surface that is arguably worse than consistent zh.
- The en interface exists so non-Chinese-reading maintainers can
  navigate and operate the app chrome; EAA domain data stays
  authoritative in Chinese.

**Trigger to revisit**: a real request for a fully-English
experience from an actual user. At that point implement option A in
this order: (1) risk levels via the existing `EAARiskLevel` keys,
(2) reason codes via `reason.<CODE>` i18n keys generated from
`reason-codes.json`, (3) leave category 3 as-is.

## Consequences

- GUI i18n audits treat categories 1–3 as expected findings, not
  defects (see `scripts/devtools-cdp/cdp-i18n-audit.mjs`).
- No changes to the binary, config schema, or data flow.
- The en dictionary deliberately stays free of EAA-domain labels,
  keeping the dictionaries in sync with what the UI actually renders.
