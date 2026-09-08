# Vendored Submitty schema reference

This directory vendors a small, pinned subset of the upstream
[Submitty](https://github.com/Submitty/Submitty) project (BSD-3-Clause,
© Submitty contributors). It is **not** the upstream application — the
upstream PHP/PostgreSQL server is never executed here. It is the
**schema blueprint** for the built-in AI grading subsystem
(「批改作业」/ Grading page), whose native data model mirrors Submitty's
grading chain:

```
gradeable ─ gradeable_component ─ gradeable_component_mark   (rubric: 题目 → 评分点)
    │              └ gradeable_component_data (每题给分)
    ├ electronic_gradeable(_data/_version)                  (提交与版本)
    ├ autograding_testcase(_data)                           (自动批改逐项得分 ≈ AI 逐题给分)
    └ grade_override                                        (教师复核覆盖)
```

## Contents

| File | What it is |
| --- | --- |
| `sql/course_tables.sql` | Per-course database dump (gradeable / submission / grading chain) |
| `sql/submitty_db.sql` | Master database dump (terms / courses / courses_users / users) |
| `LICENSE.md` | Upstream license, must be kept when redistributing |
| `UPSTREAM.json` | Pin: repo URL, tag, commit, fetch date, per-file sha256 |

The dumps are kept in sync with upstream migrations (verified: latest
migration columns are present in the dump), so they reflect the current
authoritative schema of a new install.

## Why / how it is used

- `tests/main/submitty-vendor-drift.test.ts` asserts that every
  table/column our native grading model maps from still exists in these
  dumps — when upstream renames something, the test goes red the same day
  we pull a new reference, forcing the mapping to be updated.
- `npm run verify:vendor` validates the pin (existence + sha256).

## Updating (follow upstream releases, ~monthly `vYY.MM.NN`)

```bash
npm run update:vendor:submitty                 # latest release tag
npm run update:vendor:submitty -- --tag v26.08.01
```

Then run the drift test; if it fails, update the native mapping in
`src/main/services/grading/` accordingly before committing.
