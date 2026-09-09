# Cron (scheduler)

> **The cron scheduler is the engine that runs the 18 agents on
> schedule.** This document covers the cron service, the schedule
> format, the per-task logging, and the troubleshooting for
> scheduled jobs that don't fire.

## Table of contents

- [What is the cron service?](#what-is-the-cron-service)
- [The schedule format](#the-schedule-format)
- [The default schedule](#the-default-schedule)
- [Per-task configuration](#per-task-configuration)
- [Per-task logging](#per-task-logging)
- [Manual triggers](#manual-triggers)
- [Hot reload](#hot-reload)
- [Concurrency](#concurrency)
- [Error handling](#error-handling)
- [Time zones](#time-zones)
- [Overlapping jobs](#overlapping-jobs)
- [Troubleshooting](#troubleshooting)

---

## What is the cron service?

The cron service is a small in-process scheduler built on
[`node-cron`](https://www.npmjs.com/package/node-cron). It runs
in the main process, alongside the agent service.

The flow:

```
┌────────────────────────────────────────────────────┐
│                  main process                      │
│  ┌─────────────────┐    ┌──────────────────────┐  │
│  │  cron-service.ts │───▶│  agent-service.ts    │  │
│  │  (node-cron)     │    │  (runs the agent)    │  │
│  └─────────────────┘    └──────────────────────┘  │
│           │                       │                │
│           │  triggers             │  result        │
│           ▼                       ▼                │
│  ┌──────────────────────────────────────────────┐ │
│  │              cron_logs table                 │ │
│  │  (start, end, status, output, error)         │ │
│  └──────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

The cron service:

1. **Loads** the schedule from `config/agents.yaml` at boot.
2. **Registers** each cron expression with `node-cron`.
3. **On tick**: builds the prompt, calls `agent-service.run()`,
   captures the result, logs it.
4. **Persists** every run to the `cron_logs` table in SQLite.
5. **Hot-reloads** when the schedule changes (e.g. the teacher
   edits a job in the Scheduler page).

---

## The schedule format

The schedule format is the standard 5-field cron expression:

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ day of week (0–7, 0 and 7 are Sunday)
│ │ │ └─── month (1–12)
│ │ └───── day of month (1–31)
│ └─────── hour (0–23)
└───────── minute (0–59)
```

`node-cron` extends this with an optional 6-field format that
adds seconds at the front:

```
* * * * * *
│ │ │ │ │ │
│ │ │ │ │ └─ day of week
│ │ │ │ └─── month
│ │ │ └───── day of month
│ │ └─────── hour
│ └───────── minute
└─────────── second
```

### Examples

| Expression | Meaning |
| --- | --- |
| `0 8 * * *` | Every day at 08:00. |
| `0 8 * * 1` | Every Monday at 08:00. |
| `*/15 * * * *` | Every 15 minutes. |
| `0 9-17 * * 1-5` | Hourly from 9 AM to 5 PM, Monday to Friday. |
| `0 0 1 * *` | The 1st of every month at midnight. |
| `0 0 8 * * *` | Every day at 08:00:00 (with seconds). |
| `*/30 * * * * *` | Every 30 seconds (with seconds). |

---

## The default schedule

The shipped schedule has **23 entries across 17 agents** (extracted
from `config/agents.yaml`; `main` has an empty schedule). Full list:

| Time | Agent | Tier | Expression |
| --- | --- | --- | --- |
| Fri 16:00 | `weekly-reporter` | high_quality | `0 16 * * 5` |
| Fri 17:00 | `governor` | low_cost | `0 17 * * 5` |
| Fri 17:00 | `risk-alert` | low_cost | `0 17 * * 5` |
| Mon 08:00 | `safety` | low_cost | `0 8 * * 1` |
| Mon 09:00 | `data-analyst` | high_quality | `0 9 * * 1` |
| Mon-Fri 08:00 | `risk-alert` | low_cost | `0 8 * * 1-5` |
| Sun 22:00 | `governor` | low_cost | `0 22 * * 0` |
| Sun 22:00 | `supervisor` | low_cost | `0 22 * * 0` |
| daily 01:00 | `executor` | low_cost | `0 1 * * *` |
| daily 06:00 | `governor` | low_cost | `0 6 * * *` |
| daily 06:00 | `supervisor` | low_cost | `0 6 * * *` |
| daily 07:05 | `academic` | high_quality | `5 7 * * *` |
| daily 07:25 | `counselor` | low_cost | `25 7 * * *` |
| daily 08:30 | `home_school` | low_cost | `30 8 * * *` |
| daily 12:00 | `governor` | low_cost | `0 12 * * *` |
| daily 18:00 | `governor` | low_cost | `0 18 * * *` |
| daily 20:00 | `counselor` | low_cost | `0 20 * * *` |
| daily 21:00 | `psychology` | low_cost | `0 21 * * *` |
| daily 22:00 | `governor` | low_cost | `0 22 * * *` |
| daily 22:00 | `supervisor` | low_cost | `0 22 * * *` |
| daily 22:10 | `research` | low_cost | `10 22 * * *` |
| every 6h at :00 | `validator` | low_cost | `0 */6 * * *` |
| monthly D1 09:00 | `governor` | low_cost | `0 9 1 * *` |

The high-quality jobs are the weekly/monthly reports and the
data-analyst run; everything else is low_cost.--- | --- | --- | --- |
| 01:00 | `executor` | Nightly self-maintenance | low-cost |
| 06:00 | `governor` | Morning data quality check | low-cost |
| 07:00 | `main` | Morning push (today's digest) | high-quality |
| 07:05 | `counselor` | Daily study + behavior report | high-quality |
| 08:00 | `risk-alert` | Weekday risk check | low-cost |
| 08:30 | `home_school` | Family-school outreach | low-cost |
| 12:00 | `governor` | Midday data validation | low-cost |
| 12:00 | `validator` | Midday data + agent audit | high-quality |
| 18:00 | `governor` | Evening data validation | low-cost |
| 18:00 | `validator` | Evening data + agent audit | high-quality |
| 20:00 | `counselor` | Update conversation plans | low-cost |
| 21:00 | `psychology` | Mental health check | high-quality |
| 22:00 | `governor` | Daily review + digital twin | high-quality |
| 22:10 | `research` | Paper data collection | high-quality |
| 22:30 | `main` | Evening push (consolidated) | high-quality |
| Mon 08:00 | `safety` | Lab safety check | low-cost |
| Fri 16:00 | `weekly-reporter` | Weekly report | high-quality |
| Fri 17:00 | `governor` | Friday conversation reminder | low-cost |
| Sun 22:00 | `governor` | System weekly report | high-quality |
| Mon 09:00 | `data-analyst` | Weekly data analysis | high-quality |
| 1st @ 00:00 | `governor` | Monthly data check | low-cost |

The high-quality jobs (~10) are deliberately the morning/evening
push and the weekly/monthly reports. The low-cost jobs (~11) are
the validation and routine checks.

---

## Built-in system tasks

Two system tasks are registered outside `agents.yaml` and do **not**
count against the user-task quota:

| Task ID | Agent route | Default schedule | Setting |
| --- | --- | --- | --- |
| `auto-backup` | `__backup__` | `0 3 * * *` | `backup.autoBackupEnabled` / `backup.autoBackupCron` |
| `feishu-bitable-sync` | `__feishu__` | `0 */6 * * *` | `feishu.bitableSync.enabled` / `.syncInterval` |

Both go through the same circuit breaker as user tasks (see
`src/main/services/cron/auto-backup-task.ts` and
`cron/bitable-sync.ts`).

## Per-task configuration

Each task is registered in `config/agents.yaml`. The relevant
fields:

```yaml
- id: class-monitor
  name: 班务助理
  schedule:
    cron:
      - "0 8 * * 1-5"   # weekday mornings
```

The `schedule.cron` is a **list** because a single agent can
have multiple scheduled runs (e.g. once in the morning, once in
the evening).

### Per-task prompt

`schedule.cron` entries support **two forms** (parsed in
`src/main/services/agent/config.ts`):

- **String** — `"0 6 * * *"`: expression only; the task prompt
  falls back to the generic `执行 {agent.name} 的定时任务`.
- **Object** — `{ cron: "0 6 * * *", prompt: "执行晨间数据质量检查: …" }`:
  the entry carries its own instructions.

19 of the 23 shipped schedule entries carry a per-task prompt
(see `schedulePrompts` in `src/shared/types/agent.ts`; the fallback
literal lives in `cron/task-persistence.ts`). The prompt is what the
agent receives as the run instruction — e.g. `governor`'s 06:00
entry says exactly what to validate, and `risk-alert`'s morning scan
tells the agent to pass `n=999` for the full ranking.

---

## Per-task logging

Every cron run is logged to the `cron_logs` SQLite table. The
actual schema has **6 columns** (see `src/main/services/db/schema.ts`):
`id`, `task_id`, `level`, `message`, `timestamp`, `metadata`.
Manual runs are recorded with `triggered_by = 'manual'` inside the
`message`/`metadata` payload.


## Manual triggers

The **Scheduler** page has a "Run now" button on each task.
Clicking it:

1. Bypasses the cron schedule.
2. **Triggers the agent with the same per-task prompt** that the
   cron schedule would have delivered (schedulePrompts entry or
   the generic fallback).
3. Streams the output in real time to the page.
4. Persists the run to `cron_logs` with `triggered_by = 'manual'`.

Manual triggers are useful for:

- Testing a new agent or schedule.
- Running a one-off operation (e.g. "regenerate today's digest").
- Re-running a failed job.

---

## Hot reload

The cron service hot-reloads the schedule when:

- The teacher edits a job in the Scheduler page.
- The teacher edits `config/agents.yaml` (and the file watcher
  picks it up).
- A new agent is registered.

The hot reload:

1. **Stops** all existing cron jobs.
2. **Reads** the new schedule.
3. **Starts** the new cron jobs.

Existing in-flight runs are **not** aborted; they finish
normally.

---

## Concurrency

The cron service has a **reentrancy guard per agent**: if a
scheduled job is still running when the next tick fires, the
new tick is **skipped** (not queued, not delayed). This prevents
a slow agent from causing a backlog.

To override this, set the agent's `concurrency: parallel` in
`config/agents.yaml`. The default is `concurrency: skip`.

### When to use parallel

- The agent is read-only and idempotent (e.g. `data-analyst`).
- You want every tick to run, even if the previous one is
  still going (e.g. for testing).

### When NOT to use parallel

- The agent writes to the event log (e.g. `class-monitor`).
  Concurrent writes can cause race conditions.
- The agent sends messages to parents (e.g. `home_school`).
  Concurrent sends can cause duplicate messages.
- The agent is expensive (high-quality model). Concurrent runs
  can blow your API budget.

---

## Error handling

If a scheduled run fails (LLM error, tool error, timeout), the
cron service:

1. **Logs** the run to `cron_logs` (table `cron_logs`: `id`,
   `task_id`, `level`, `message`, `timestamp`, `metadata` — see
   `src/main/services/db/schema.ts`).
2. **Does not retry.** The next tick will run normally.

### Circuit breaker (quota-class errors only)

The breaker counts **quota-class errors only** — HTTP 429 /
rate-limit / quota messages (see
`src/main/services/cron/execution.ts`). Other failures mark the
run failed but do not advance the breaker.

After **3 consecutive** quota-class failures on the same task:

1. The task is **paused from automatic triggering** — it is
   *not* disabled; the schedule entry stays in place.
2. The skip is logged to `cron_logs`
   (`status = skipped_circuit_breaker`).

The breaker resets when a **manual run** (`cron:run-now`) of that
task succeeds, or the task is toggled off and on. This prevents a
quota-exhausted agent from hammering the provider on every tick.

---

## Time zones

The schedule timezone comes from **Settings → General → Timezone**
(`settings.general.timezone`, IANA name, default
`Asia/Shanghai`) — see
`src/main/services/cron/scheduler-binding.ts`. Chat timestamps use
the same setting.

---

## Overlapping jobs

The cron service runs at most
`settings.general.maxConcurrentCronTasks` (default 5) agents at
once; additional same-tick runs **queue**. A single task never
runs concurrently with itself (per-task `runningTasks` lock — see
`src/main/services/cron/task-executor.ts`).

If you need to spread load further, **stagger the schedule**
(e.g. 07:00 and 07:01 instead of 07:00 and 07:00).

---

## Troubleshooting

### A cron job isn't firing

1. **Check the Logs page** in Settings. Look for the cron
   service's startup messages; it should say "Loaded N jobs".
2. **Check the cron expression** in the Scheduler page. Use a
   tool like <https://crontab.guru/> to verify.
3. **Check the time zone**. The cron expression is in the
   system's local time, not UTC.
4. **Check the app's running state**. The cron only runs when
   the app is open. If the teacher closes the app at 22:00,
   the 22:00 job won't run.
5. **Check the agent's `enabled` flag**. If the agent is
   disabled, its cron jobs are skipped.

### A cron job fires but the agent errors out

1. **Check the LLM provider** in Settings → Models. Make sure
   the API key is still valid.
2. **Check the agent's `capabilities` list**. If a tool call
   requires a capability the agent doesn't have, the call
   fails.
3. **Check the EAA bridge logs** for the data engine
   errors.
4. **Check the privacy engine**. If the engine is disabled
   and the agent tries to anonymize, the call fails.

### A cron job is firing too often

The `node-cron` library has a quirk: if the app's clock jumps
backward (e.g. NTP correction), the next tick fires
immediately. To mitigate, restart the app after any clock
adjustment.

### A cron job is taking too long

Each agent run has a timeout of
`settings.general.agentTimeoutMins` (**minutes**, default 5,
`-1` = unlimited — see Settings → General → "Agent execution
timeout", consumed in
`src/main/services/agent/execution.ts`). If the agent exceeds
it, the run is aborted and recorded with `status = timeout`
(distinct from `error`, so misconfigurations and bugs are not
confused).

### The cron schedule isn't picked up

After editing `config/agents.yaml`, reload the schedule from the
Agents page (agent edits persist to `config/agents.user.yaml`).
If changes still don't apply:

1. Check the file watcher's logs in the Logs page.
2. Try clicking "Reload agents" in the Agents page.
3. Restart the app.

---

## Next steps

- [`AGENT_AUTHORING.md`](./AGENT_AUTHORING.md) — how to write
  agents and assign them schedules.
- [`CONFIGURATION.md`](./CONFIGURATION.md) — the full
  configuration reference.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — the big list of
  common issues.
