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

The shipped schedule has 18 jobs. Here's the full list:

| Time | Agent | Trigger | Tier |
| --- | --- | --- | --- |
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

When a cron job fires, the agent service builds the prompt as:

```
[Automated run]
Date: {today}
Day of week: {day-of-week}
Class: {default-class}
Reason: scheduled

[End of automated run header]
```

The agent knows it's an automated run (not a manual user prompt)
and adjusts its output accordingly (e.g. shorter, more
action-oriented, fewer pleasantries).

---

## Per-task logging

Every cron run is logged to the `cron_logs` SQLite table:

| Column | Type | Description |
| --- | --- | --- |
| `id` | INTEGER | The auto-incrementing ID. |
| `task_id` | TEXT | The agent ID + the cron expression. |
| `agent_id` | TEXT | The agent that ran. |
| `started_at` | INTEGER | The Unix timestamp of the start. |
| `ended_at` | INTEGER | The Unix timestamp of the end. |
| `status` | TEXT | `success`, `failed`, or `aborted`. |
| `duration_ms` | INTEGER | The duration in milliseconds. |
| `output` | TEXT | The first 1 KB of the agent's output. |
| `error` | TEXT | The error message if `status = failed`. |
| `tokens_input` | INTEGER | The LLM input tokens. |
| `tokens_output` | INTEGER | The LLM output tokens. |
| `cost` | REAL | The LLM cost in USD. |

The full logs are viewable in the **Scheduler** page in the app.
You can filter by agent, by status, by date range.

---

## Manual triggers

The **Scheduler** page has a "Run now" button on each task.
Clicking it:

1. Bypasses the cron schedule.
2. Triggers the agent with the same prompt template that the
   cron would have used.
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

1. **Logs** the failure to `cron_logs` with `status = failed`.
2. **Does not retry.** The next tick will run normally.
3. **Sends a toast notification** to the user (if the app is
   in the foreground) with the error message.
4. **Sends a system notification** (if the system supports it
   and the user has enabled "Notify on cron failure" in
   Settings).

If **3 or more consecutive runs** of the same task fail, the
cron service:

1. **Disables the task** automatically.
2. **Sends a stronger notification** ("Task X has been disabled
   after 3 consecutive failures").
3. **Logs the auto-disable event** to `cron_logs` for review.

This prevents a misconfigured agent from repeatedly hammering
the LLM provider (and racking up API costs).

To re-enable a disabled task, visit the Scheduler page and
click "Re-enable".

---

## Time zones

The cron service uses the **system's local time** by default.
On most systems, this is the time zone the user set up the OS
with.

To set a specific time zone for cron, set the `TZ` environment
variable before launching the app:

```bash
# Windows
set TZ=Asia/Shanghai
npm run dev

# macOS / Linux
export TZ=Asia/Shanghai
npm run dev
```

This is **global to the app** — the same time zone is used for
the chat timestamps, the audit log, and the cron schedule.

---

## Overlapping jobs

If two jobs are scheduled at the same time, they run
**sequentially** (not in parallel). The cron service has a
single-threaded event loop; it can't run two agents at the
same time.

This is by design: a teacher's machine is not a server, and
running two LLM calls in parallel can:

- **Blow the rate limit** of the LLM provider.
- **Confuse the user** (two notifications at once).
- **Cause subtle data races** in the SQLite database.

If you need parallel cron jobs, the recommended approach is to
**stagger the schedule** (e.g. 07:00 and 07:01 instead of
07:00 and 07:00).

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

Each agent has a default 60-second timeout (configurable in
the agent's settings). If the agent exceeds this, the cron
service kills the run and logs a `timeout` error.

To increase the timeout, edit the agent's settings in the
Scheduler page or in `config/agents.yaml`.

### The cron schedule isn't picked up

After editing `config/agents.yaml`, the file watcher should
pick up the change and hot-reload the schedule. If it doesn't:

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
