# 🎓 Education Advisor — Desktop Upgrade

> **An in-depth introduction to the project: why it exists, how it's designed, what it
> does today, and where it's going next.**

This is the long-form companion to [`README.md`](./README.md). The README is a five-minute
tour; this document is the hour-long deep-dive. If you are evaluating the project for
adoption, contributing code, or just curious how a 18-agent multi-LLM education OS fits
together — read on.

---

## Table of contents

- [Why we built this](#why-we-built-this)
- [The problem we are solving](#the-problem-we-are-solving)
- [Design principles](#design-principles)
- [The story so far](#the-story-so-far)
- [A 30,000-foot tour](#a-30000-foot-tour)
- [Deep dive: the 18 agents](#deep-dive-the-18-agents)
- [Deep dive: the data engine](#deep-dive-the-data-engine)
- [Deep dive: the LLM layer](#deep-dive-the-llm-layer)
- [Deep dive: the privacy engine](#deep-dive-the-privacy-engine)
- [Deep dive: the desktop shell](#deep-dive-the-desktop-shell)
- [Development workflow](#development-workflow)
- [Configuration reference](#configuration-reference)
- [Architecture decision records](#architecture-decision-records)
- [Feature status (today)](#feature-status-today)
- [Roadmap (next 24 months)](#roadmap-next-24-months)
- [Who uses this](#who-uses-this)
- [FAQ for evaluators](#faq-for-evaluators)
- [How to read the source](#how-to-read-the-source)

---

## Why we built this

The seed of this project is a question that any high-school class teacher in China has
asked, at some point, at 11 PM, with a stack of paper conduct records in front of them:

> **"I spend two hours a day on records and reports. Can a machine help me do that —
>  without taking the records out of my hands?"**

The short answer is *yes, but only if the machine is built specifically for the job*.
General-purpose chatbots fail at this for three reasons:

1. They **hallucinate numbers**. A chatbot will confidently say "Alice's score is 87"
   even if Alice's actual score is 78, because the number "sounded right".
2. They have **no audit trail**. A teacher can be asked, by a parent, to prove why
   a conduct point was deducted. A chat log is not an audit trail.
3. They are **stateless and expensive**. Re-asking the same question to a chatbot
   gives a different answer, and the cost adds up fast at scale.

The project you are reading is what happens when you take those three failures as
**non-negotiable design constraints** and build a system where:

- Every number must come from a tool call (no math in the prompt).
- Every event is appended to an immutable, hashable log (full audit trail).
- The LLM can be swapped for a 4 B local model and the system still works.

That's the project. The rest of this document is the long version of how it works.

---

## The problem we are solving

A typical Chinese high-school class teacher (班主任) has the following daily and weekly
duties around student conduct:

| Frequency | Task | Time spent | Source of truth |
| --- | --- | --- | --- |
| Daily | Record conduct points (+2 / −3) | 20 min | Paper notebook |
| Daily | Send parent messages | 30 min | WeChat |
| Daily | Check who's at risk | 15 min | Gut feeling |
| Weekly | Generate class report | 90 min | Word template |
| Weekly | Update parent communication log | 30 min | WeChat |
| Monthly | Compile data for the grade office | 2 h | Spreadsheet |
| Per event | Document incidents (safety, discipline) | 45 min each | Paper file |

That's roughly **8–12 hours per week** on paperwork that has zero pedagogical value but
**must** be done correctly. The error cost of a wrong record is high (parent complaints,
grade-office audits, the rare but serious disciplinary case), so teachers over-document,
which costs more time.

What we want to do with this project is take the **record-keeping** and **routine
communication** parts off the teacher's plate, while:

- Keeping the **data** on the teacher's machine.
- Keeping the **judgment** with the teacher (the AI proposes, the teacher confirms).
- Making the **whole workflow auditable** end-to-end.

The desktop-first architecture is the key insight: a teacher can install a single app,
get a system tray icon, and the system runs in the background doing 80% of the
bookkeeping. The teacher comes in the morning, glances at the daily digest, and acts
on the 20% that needs a human.

---

## Design principles

The project has seven non-negotiable design principles. We break them before we break
these.

### 1. **The Rust side is the source of truth. Always.**
The LLM, the renderer, the IPC layer, the network — all of these can be replaced
without changing what data the system holds. The EAA CLI is the only thing that
**writes** student events. Everything else reads from it.

### 2. **Tool calls, not vibes.**
Every number in an agent's output must be traceable to a tool call. If an agent says
"Alice's score is 87", it must be able to point to the `eaa score Alice` invocation
that produced that number. If it can't, the answer is wrong by definition.

### 3. **Append-only events. No deletes. No overwrites.**
The event log is a sequence of facts, not a state. You can **revert** an event (which
appends a new "revert" event), but you can never delete a fact. The entire history of
the class is reconstructable from the log alone.

### 4. **PII stays local unless explicitly rehydrated.**
Student names, IDs, phone numbers, and addresses are AES-256-GCM-encrypted at rest and
replaced with pseudonyms (`S_017`, `ID_42`, `1XX-XXXX-1234`) before any LLM call. The
teacher can flip a switch to rehydrate names for a final report that goes to a parent,
but the default is anonymized.

### 5. **Small models, big prompts.**
The agent prompts are designed to be **executable by 3–4B parameter models**. We do
not assume GPT-4. We assume the user might be running Qwen 3.5 4B on a 6 GB GPU, or
even a CPU. This means our prompts are verbose, our tools are explicit, and our
output schemas are strict.

### 6. **Local-first, cloud-optional.**
The app works fully offline. The LLM is the only network dependency. The teacher can
work on a plane, on a train, in a basement classroom. Cloud features (Feishu sync,
LLM APIs) are opt-in.

### 7. **Reproducible. Byte-identical. Auditable.**
`npm ci && npm run build && npm run package` on a clean Windows 11 box produces the
same `.exe` (modulo timestamps) every time. The Rust binary is a specific tagged
release. The whole supply chain is in this repo.

---

## The story so far

The project's history is also documented in this same
`education-advisor` repository's
[`VERSION_HISTORY.md`](https://github.com/232252/education-advisor/blob/main/VERSION_HISTORY.md).
A short version, from a desktop-client perspective:

- **v0.1 — Feb 2025.** Proof of concept. A single CLI command (`eaa add Alice +2 homework`)
  and a single cron job. The whole thing fit in one Python file.
- **v0.5 — May 2025.** First multi-agent prototype. 4 agents (`main`, `governor`,
  `validator`, `weekly-reporter`). All in shell scripts.
- **v1.0 — Aug 2025.** The Rust CLI is born. The event store, the file lock, the
  atomic write, the privacy engine — all in Rust. The Python side becomes a thin
  client.
- **v2.0 — Dec 2025.** The 10-agent system. The Feishu integration. The PII engine.
  This is the version that gets used in two real classes.
- **v3.0 — Mar 2026.** The cron-driven daily push. The weekly report template. The
  audit-log dashboard.
- **v3.1 — May 2026.** The previous "open-source" milestone (see the old repo at
  <https://github.com/232252/education-advisor>). 12 agents, Rust-only deployment,
  Nushell install script, Docker image.
- **v3.2 — May 2026.** The privacy engine is upgraded to AES-256-GCM, the reason-code
  system is normalized, the eaa CLI adds the `privacy` and `dashboard` subcommands.
- **v0.1.0 (this repo) — Jun 2026.** **The desktop upgrade.** What you are reading.
  The same `education-advisor` project, now ported from CLI-only to a full
  cross-platform desktop application. The Rust `eaa-cli` data engine is preserved
  unchanged; the new piece is the Electron shell, the React renderer, the
  better-sqlite3 layer, the 6 new class-operation agents, and the agent
  authoring story.

The v3.x CLI series is still recommended for **headless / cron-only** deployments
(servers, scheduled scripts). This v0.1.0 desktop release is the recommended
deployment for **interactive** use cases (i.e. you want a desktop app, not a
CLI).

---

## A 30,000-foot tour

```
   ┌──────────────────────┐
   │       Teacher        │
   └──────────┬───────────┘
              │ clicks, types, talks
              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                  Education Advisor (this repo)                   │
   │                                                              │
   │   ┌────────────┐    ┌────────────┐    ┌────────────┐         │
   │   │ Dashboard  │    │   Chat     │    │  Students  │  ...    │
   │   └─────┬──────┘    └─────┬──────┘    └─────┬──────┘         │
   │         └──────────────────┴────────────────┘                │
   │                            │                                 │
   │                  window.api  (contextBridge)                 │
   │                            │                                 │
   │   ┌────────────────────────▼────────────────────────────┐    │
   │   │              Main process (Node 22)                 │    │
   │   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐  │    │
   │   │  │ 11 IPC   │→│ 13       │→│ SQLite   │ │ Tray / │  │    │
   │   │  │ handlers │  │ services │  │ db       │ │ Update │  │    │
   │   │  └──────────┘ └──────────┘ └──────────┘ └────────┘  │    │
   │   │       ▲             ▲                                │    │
   │   │       │  cron       │  tool calls                    │    │
   │   │  ┌────┴─────────────┴────────────┐                   │    │
   │   │  │         18 agents             │                   │    │
   │   │  │  (Markdown-defined, least-     │                   │    │
   │   │  │   privilege, tier-routed)     │                   │    │
   │   │  └───────────────────────────────┘                   │    │
   │   └────────────────────────┬────────────────────────────┘    │
   │                            │                                 │
   │                  eaa-bridge (subprocess)                     │
   │                            │                                 │
   └────────────────────────────┼─────────────────────────────────┘
                                │  JSON over stdin/stdout
                                ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  eaa-cli  (Rust · 19.5 MB Windows binary · 6 platforms)     │
   │  https://github.com/232252/education-advisor                 │
   │                                                              │
   │   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐ │
   │   │events  │  │entities│  │privacy │  │export  │  │dashboard│ │
   │   └────────┘  └────────┘  └────────┘  └────────┘  └────────┘ │
   │                                                              │
   │  • Atomic file writes (tmp → fsync → rename)                 │
   │  • File lock (advisory) for multi-process safety             │
   │  • AES-256-GCM PII mapping                                   │
   │  • Reason-code schema validation                             │
   │  • Append-only event log (JSON-Lines)                        │
   └──────────────────────────────────────────────────────────────┘
```

The crucial detail: **the desktop side never writes student data directly**. Every
write goes through the EAA bridge, which goes through the EAA CLI, which goes through
its file-locked, atomic-write event store. The desktop app is a **view + agent
orchestrator**; the Rust binary is the **writer of record**.

---

## Deep dive: the 18 agents

An "agent" in this project is **not** a software service in the microservice sense. An
agent is a pair of Markdown files that, at boot, get loaded by the main process and
turned into a configuration object. The object has:

- An **id** (e.g. `class-monitor`)
- A **system prompt** (from `SOUL.md`)
- A **rules section** (from `AGENTS.md`)
- A **capability list** (from `config/agents.yaml`)
- A **schedule** (cron expressions, also from yaml)
- A **model tier** (`high-quality` or `low-cost`)

At runtime, the agent service (`src/main/services/agent-service.ts`) can:

- **List** all loaded agents (returns the metadata + last-run timestamp).
- **Run** an agent with a user prompt (returns a stream of events).
- **Persist** an agent's execution history in SQLite.
- **Abort** an in-flight agent run.
- **Edit** the agent's `SOUL.md` / `AGENTS.md` (writes to disk, hot-reloads on next run).

### The 18 agents, organized by purpose

#### Class-operation agents (the "what happened today" group)

These are the agents that **interact with class data** during the day.

- **`class-monitor`** — Records conduct points (`+2 homework`, `−3 phone in class`).
  The teacher (or a student representative) types a natural-language description,
  the agent parses it into a structured event, and writes it to EAA. This is the
  **most-used agent**, by far.
- **`student-care`** — Finds students who are trending up, drafts a short praise
  message. Read-only access to the event log plus a single `add_event` capability
  for "recognition" events.
- **`discipline-officer`** — Flags repeated incidents, drafts an escalation note
  for the head of grade. Read + `add_event` (for the escalation).
- **`risk-alert`** — Monitors rolling 14-day conduct scores, identifies students
  whose trajectory puts them at risk, and pushes a daily digest.
- **`data-analyst`** — On Monday morning, generates the week's numbers: top
  movers, top decliners, class average, distribution.
- **`weekly-reporter`** — On Friday afternoon, drafts the weekly class report
  for the grade office. This is the most **expensive** agent (high-quality
  model tier).

#### Education-advisor agents (the "subject-matter expert" group)

These are the 12 agents inherited from the v3.x open-source release. They are
domain experts, not data recorders.

- **`main`** — The coordinator. Routes user messages, dispatches to the right
  agent, persists the conversation, pushes daily digests.
- **`governor`** — The auditor. Six times a day, cross-checks the event log
  for consistency, missing entries, anomalies. On Sunday night, generates the
  system-level weekly report.
- **`counselor`** — Drafts a daily "study + behavior" report for each student
  who's flagged. Read-only + `add_event` for "talk" events.
- **`supervisor`** — Daily digest officer. Reads the day, summarizes, and
  queues items for `governor` and `counselor`.
- **`validator`** — Audits other agents' outputs. Compares the numbers an
  agent *claims* to the numbers in the event log. Catches hallucinations.
- **`academic`** — Academic performance analyst. Trends in test scores, class
  distribution, predictions for the next exam.
- **`psychology`** — Watches for mental-health warning signs. Never writes
  events — only flags.
- **`safety`** — Monday-morning lab safety checklist.
- **`home_school`** — Generates parent-message drafts.
- **`research`** — Helps the teacher with academic research tasks (paper
  management, citation formatting, literature search).
- **`executor`** — System maintenance. Detects data drift, fixes common
  issues, runs scheduled cleanup.
- **`bug-hunter`** — A meta-agent. Runs the test suite, scans the codebase
  for common issues, files structured bug reports. Read-only.

### Why this organization?

The split between "class operation" and "education advisor" reflects two different
mental models:

- **Class-operation agents** are **transactional**. They change state. They need
  write access. The teacher sees them as "tools that do something".
- **Education-advisor agents** are **advisory**. They read state. They might
  occasionally write a meta-event (a "talk" or an "audit finding"), but their
  primary mode is "tell me what to think about".

The capability lists in `config/agents.yaml` are written with this distinction
in mind. `class-monitor` has `add_event` because that's the job. `psychology`
doesn't, because it's a watcher, not a recorder.

### How an agent run actually works

A simplified flow when the user clicks "Run now" on `class-monitor` with the prompt
"Alice just handed in her homework 10 minutes late, +2":

1. **Renderer** calls `window.api.agent.runManual('class-monitor', 'Alice ...', history)`.
2. **Preload** bridges to `IPC_AGENT_RUN_MANUAL` with an `ipcRenderer.invoke`.
3. **Main process** (`agent-handlers.ts`) receives the call, looks up the agent's
   config, and calls `agentService.run(agentId, prompt)`.
4. **agent-service** builds the system prompt by stitching together:
   - The agent's `SOUL.md` content
   - The global `SMALL_MODEL_RULES.md` content
   - The active `STUDENT_MANAGEMENT.md` skill content
   - A list of available tools (sanitized)
5. **pi-ai** sends the prompt + tool list to the configured LLM provider.
6. **LLM** responds with a tool call: `eaa.addEvent({student: "Alice", code: "BONUS_VARIABLE", delta: 2, ...})`.
7. **agent-service** validates the tool call against the agent's capability list
   (`class-monitor` has `add_event` ✓).
8. **eaa-tools** sanitizes the parameters (prevents shell injection, blocks path
   traversal in the reason field, etc.).
9. **eaa-bridge** spawns the EAA child process, writes JSON to stdin, reads
   JSON from stdout, terminates.
10. **EAA CLI** validates the event against the reason-code schema, appends it
    to the event log (atomic write), returns the new event ID.
11. **agent-service** receives the tool result, sends it back to the LLM for
    natural-language summarization.
12. **LLM** responds: "Done. Added +2 to Alice (BONUS_VARIABLE), event ID
    `evt_a3f7...`. Her weekly total is now +4."
13. **Streamed back to the renderer** as a series of `StreamEvent` messages.
14. **Renderer** displays the response, persists it in the chat store, writes
    the event metadata to SQLite (`agent_executions` table).

The whole round-trip is **~2–4 seconds** for a small model on a local server,
**~1–2 seconds** for a hosted model.

---

## Deep dive: the data engine

The EAA CLI is the data engine. It is written in Rust, lives in
`core/eaa-cli/` of this same `education-advisor` repository, and is
shipped to this app as a pre-built binary per platform.

### The event log

The on-disk format is **JSON-Lines**, one event per line:

```json
{"id":"evt_a3f7c2...","ts":"2026-06-09T08:14:23.117+08:00","student":"Alice","code":"BONUS_VARIABLE","delta":2,"reason":"homework on time","actor":"teacher","agent":"class-monitor","meta":{}}
```

Properties:

- **Append-only.** A new event is written by writing to `events.log.tmp`, calling
  `fsync`, then renaming to `events.log`. The rename is atomic on every supported
  filesystem (NTFS, APFS, ext4, btrfs).
- **Hash-chained (optional).** Each event includes a SHA-256 of the previous
  event's hash, so a tampered log is detectable.
- **Indexed by student.** A sidecar index (`events-by-student.json`) gives
  O(1) lookup by student name.

### The entity store

Students are stored in `entities/students.json`:

```json
{
  "Alice": {"id":"S_017","name":"Alice","class":"高三(2)班","enrolled":"2024-09-01","active":true,"meta":{}},
  ...
}
```

Mutations to the entity store are also event-sourced: a `add_student` event
appends a student; a `delete_student` event soft-deletes (sets `active: false`).

### The reason-code schema

The valid reason codes are defined in `config/reason-codes.json` (also shipped
with the desktop app) and validated server-side. There are 24 codes today,
grouped into:

- **Deduct** (11 codes, scores from −1 to −10)
- **Bonus** (6 codes, scores from +1 to +10)
- **System** (1 code: `REVERT`, used to undo a previous event)
- **Lab** (4 codes, specific to lab safety incidents)

Adding a new reason code is a single-file change. Removing one is a
single-file change **and** a data migration (existing events keep the old
code; the schema is forward-compatible).

### The privacy engine

The privacy engine is a separate, smaller subsystem that lives next to the
event store:

- `privacy/mapping.bin` — AES-256-GCM-encrypted mapping from real names to
  pseudonyms (`Alice` → `S_017`).
- `privacy/salt.bin` — Argon2 salt for the master password.
- `privacy/audit.log` — Every `anonymize` / `deanonymize` call is logged
  with a timestamp, caller (agent ID), and the recipient (e.g. "LLM:openai",
  "parent:Alice's mother", "export:csv").

The privacy engine is **always on** by default. The teacher can disable it
globally (with a master password confirmation), but the default for any new
LLM call is to anonymize first and deanonymize last.

### The dashboard

The `eaa dashboard` subcommand generates a static HTML report from the event
log: a top-line summary, a 30-day trend chart, a leaderboard, a per-student
detail page. The desktop app's Dashboard page can also be configured to mirror
this static report.

---

## Deep dive: the LLM layer

The LLM layer is built on top of [`@earendil-works/pi-ai`](https://www.npmjs.com/package/@earendil-works/pi-ai),
a unified SDK that abstracts 30+ providers behind a single interface. The
abstraction gives us:

- **Provider-agnostic streaming.** Every provider exposes a `ChatStream`
  object that emits a uniform `StreamEvent` union. The agent service doesn't
  care which provider produced the event.
- **Model-tier routing.** Each agent has a `model_tier` (`high-quality` or
  `low-cost`). The `models` setting maps each tier to a `(provider, modelId)`
  pair. The teacher can put GPT-4o as `high-quality` and Qwen 4B as `low-cost`,
  and the cost-quality trade-off is centralized in one place.
- **Custom-model registration.** Any OpenAI-compatible endpoint (Ollama,
  vLLM, LM Studio, a self-hosted llama.cpp server) can be added in the
  Models page. The custom model inherits the full streaming + tool-call
  machinery.
- **OAuth login.** Some providers (Notion, some enterprise endpoints) use
  OAuth. The pi-ai SDK handles the flow and the refresh token.
- **Cost tracking.** Every chat call returns an `usage` object (input tokens,
  output tokens, optional `cost`). The app writes this to SQLite and the
  Dashboard page shows a per-day, per-agent, per-model cost chart.
- **Compaction.** When a conversation exceeds a configurable token threshold,
  the older messages are summarized by a fast model and replaced with the
  summary. The original messages are kept in SQLite for reference but not
  sent to the LLM.

### The provider matrix

Today, the bundled providers include:

| Provider | Auth | Streaming | Tool calls | Vision | Notes |
| --- | --- | --- | --- | --- | --- |
| OpenAI | API key / OAuth | ✓ | ✓ | ✓ | gpt-4o, gpt-4.1, o3, o4-mini |
| Anthropic | API key | ✓ | ✓ | ✓ | claude-3.5-sonnet, claude-3.7, claude-4 |
| Google Gemini | API key / OAuth | ✓ | ✓ | ✓ | gemini-2.0-flash, gemini-2.5-pro |
| Mistral | API key | ✓ | ✓ | partial | mistral-large, codestral |
| DeepSeek | API key | ✓ | ✓ | ✗ | deepseek-chat, deepseek-reasoner |
| Qwen (DashScope) | API key | ✓ | ✓ | ✓ | qwen-max, qwen-plus, qwen-3.5-4b (local) |
| Doubao (Volcengine) | API key | ✓ | ✓ | partial | doubao-pro, doubao-lite |
| Zhipu (GLM) | API key | ✓ | ✓ | ✓ | glm-4, glm-4-flash |
| Moonshot Kimi | API key | ✓ | ✓ | ✗ | kimi-k2, moonshot-v1 |
| Ollama | local | ✓ | partial | model-dependent | any local model |
| LM Studio | local | ✓ | partial | model-dependent | any local model |
| OpenAI-compatible | API key | ✓ | ✓ | model-dependent | catch-all for vLLM, llama.cpp, etc. |

Adding a new provider is a 30-line file in `pi-ai`'s registry. If you have
a provider the bundled list doesn't cover, see the pi-ai docs.

---

## Deep dive: the privacy engine

The privacy engine is the project feature that gets the most questions, so it
deserves a long section.

### What it does

The privacy engine sits between the renderer / agent service and the LLM. Every
text payload that would otherwise go to the LLM first goes through
`privacy.anonymize(text)`. Every text payload that comes back from the LLM (and
is destined for a human reader, like a parent) goes through
`privacy.deanonymize(text, recipient)`.

The engine maintains a per-install mapping table from real identifiers to
pseudonyms. The mapping is stored encrypted at rest.

### What it anonymizes

| Entity type | Example real value | Anonymized value |
| --- | --- | --- |
| Person name | 张三, Alice, 张老师 | `S_017`, `T_004` |
| Student ID | 20240301 | `ID_a3f7` |
| Phone number | 138-1234-5678 | `1XX-XXXX-5678` |
| ID card | 110101200501012345 | `110101********2345` |
| Home address | 北京市海淀区中关村南大街5号 | `北京市海淀区` (city + district only) |
| Email | alice@school.cn | `S_017@school.cn` (only the local part is pseudonymized) |

The engine uses a combination of regex patterns and a small dictionary. The
dictionary is extensible: a teacher can add school-specific abbreviations.

### What it does NOT anonymize

- Conduct scores (numbers)
- Timestamps
- Reason codes
- Class / grade structure (e.g. "高三(2)班" is preserved because the LLM
  needs to understand class context for a meaningful report)

The privacy engine is **conservative**: when in doubt, it does not anonymize.
This is a deliberate trade-off — false negatives (a name that slips through)
are recoverable, false positives (a non-name that gets replaced) corrupt the
output.

### Per-recipient filtering

The `filter(receiver, text)` operation takes a recipient type as the first
argument:

```typescript
privacy.filter("llm:openai", text)         // aggressive: anonymize all PII
privacy.filter("parent:Alice's mother", text) // light: anonymize OTHER students only
privacy.filter("export:csv", text)          // medium: anonymize IDs but keep names
privacy.filter("teacher:self", text)        // none: passthrough
```

This is the key insight: **the same agent prompt can produce different
outputs for different recipients**, and the privacy engine is the place where
the recipient is decided.

### The audit log

Every `anonymize` and `deanonymize` call is logged:

```
[2026-06-09 08:14:23.117] anonymize caller=class-monitor recipient=llm:openai input_len=412 output_len=387 entities_replaced=3
[2026-06-09 08:14:23.204] deanonymize caller=class-monitor recipient=teacher:self input_len=298 output_len=304 entities_replaced=2
[2026-06-09 08:14:23.412] anonymize caller=risk-alert recipient=llm:qwen input_len=1842 output_len=1623 entities_replaced=12
```

The audit log is the **answer to the parent who asks "what did the AI see?"**.
It's a single text file, append-only, queryable.

---

## Deep dive: the desktop shell

The desktop shell is Electron 33 + React 18 + TypeScript 5.7. This section
covers the architectural decisions that aren't obvious from reading the
code.

### Why Electron and not Tauri / native?

When the project started (early 2025), the constraints were:

1. **Windows is the primary deployment target** (90%+ of the maintainer-team's
   users run Windows).
2. **Code-signing and auto-update need to be boringly reliable.**
3. **Time-to-first-build is more important than absolute performance.**

Tauri 1.0 had rough Windows code-signing stories in late 2024 / early 2025.
Electron Builder had a decade of hardening. We chose Electron. Tauri 2.0 has
caught up, and the [ROADMAP](./ROADMAP.md) includes a Tauri parity project
for v2.0 of the desktop client.

### Why React and not Vue / Svelte?

- The team already had React muscle memory.
- The Pi Agent core is published as a React-friendly library.
- The agent loop, the prompt editor, and the log viewer all benefit from
  React's ecosystem (TipTap, react-markdown, shiki, react-table).

### The process model

The app runs **three** distinct processes:

1. **Main** — the Node.js / Electron main process. Owns the SQLite DB, the
   file system access, the EAA child process, the system tray, the auto-update
   flow.
2. **Renderer** — the React app, running in a Chromium tab with
   `contextIsolation: true`, `nodeIntegration: false`, and a strict
   `contextBridge` exposing only `window.api`.
3. **EAA CLI** — the Rust binary, spawned as a child process per call (or
   long-lived for streaming).

The renderer **never** touches the file system, the network, or the database.
Every operation that needs to do any of those goes through `window.api`,
which is a thin proxy over `ipcRenderer.invoke`.

### The IPC contract

There are **90+ IPC channels** in `src/shared/ipc-channels.ts`, grouped by
namespace:

- `ai:*` — LLM provider / model / chat
- `agent:*` — agent lifecycle
- `eaa:*` — EAA data engine
- `privacy:*` — privacy engine
- `cron:*` — scheduler
- `skill:*` — user-defined skills
- `settings:*` — app settings
- `sys:*` — system (dialogs, paths, updates)
- `profile:*` — student profile expansion
- `chat:*` — conversation persistence
- `log:*` — log viewer
- `feishu:*` — Feishu integration

Every channel is a string constant exported from a single file, so renaming
a channel is a one-line change. Every channel has a corresponding handler in
`src/main/ipc/`. The handler validates the input (via TypeBox schemas for
the more complex ones) and calls a service method.

### The state model

The renderer uses **Zustand** for state, with four stores:

- `agentStore` — agent metadata, run history, edit state
- `chatStore` — current conversation, message list, streaming state
- `settingsStore` — current settings, theme, language
- `toastStore` — transient notifications

Stores are intentionally **thin**. The main process is the source of truth;
the renderer stores are projections. The main process pushes state updates
over IPC events (`agent:status-update`, `cron:status-update`,
`ai:chat-stream`).

### The build pipeline

| Stage | Tool | Output |
| --- | --- | --- |
| TypeScript compile (main) | Vite 6, `vite.config.main.ts` | `dist/main/index.js` + `dist/main/preload.js` |
| TypeScript compile (renderer) | Vite 6, `vite.config.renderer.ts` | `dist/renderer/index.html` + assets |
| Lint | Biome 2.3 | exit code |
| Type check | TypeScript 5.7 | exit code |
| Test | Vitest 3.2 | test report |
| Package | electron-builder 25 | `release/*.exe` |

The two Vite configs produce CommonJS for the main process (because Electron's
main is a Node.js process) and ES modules for the renderer (because Chromium).

### The dependency footprint

`better-sqlite3` is the only native dependency. It is well-maintained,
pre-built for Windows / macOS / Linux on common Node versions, and synchronous
(which is what we want for a desktop app with a single main process).

The Rust EAA binary is bundled as an `extraResource`, unpacked from the
asar archive at startup. This is necessary because spawning a child process
from inside an asar archive is a known Electron antipattern.

---

## Development workflow

A typical day in the life of a contributor:

```bash
# 1. Pull latest
git pull
npm ci

# 2. Work on a feature
git checkout -b feature/my-change

# 3. Edit code in src/

# 4. Run quality gates
npm run typecheck
npm run lint
npm run test

# 5. Manual smoke test
npm run build
npm run dev:electron

# 6. Commit, push, open a PR
git commit -m "feat(agents): add new home_school outreach template"
git push origin feature/my-change
gh pr create
```

CI runs the same four quality gates on every PR. See
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

---

## Configuration reference

The full configuration surface is in [`docs/CONFIGURATION.md`](./docs/CONFIGURATION.md).
This section is a quick map.

| File | Purpose | Edited by |
| --- | --- | --- |
| `config/agents.yaml` | Agent registry: id, role, model tier, schedule, capabilities, risk thresholds | Developers, advanced users |
| `config/reason-codes.json` | Valid event codes and their default scores | Developers, school admins |
| `config/default-settings.json` | Out-of-box defaults for first run | Developers |
| `config/SMALL_MODEL_RULES.md` | The rulebook that all agents must follow | Developers, prompt engineers |
| `src/main/services/settings-service.ts` | Hard-coded fallbacks for the in-app settings | Developers |
| `userData/settings.json` (at runtime) | The user's actual settings, written by the app | End user, via the Settings page |

---

## Architecture decision records

We follow the lightweight ADR pattern. Decisions are recorded in
[`docs/decisions/`](./docs/decisions/) as `NNNN-title.md` files. Today the
recorded decisions are:

- `0001-keep-rust-and-typescript-in-separate-repos.md` — why we did **not**
  monorepo the Rust and the TypeScript.
- `0002-append-only-event-log.md` — why we chose event-sourcing over a
  mutable state store.
- `0003-agent-prompt-files-not-code.md` — why agents are Markdown files
  loaded at runtime, not TypeScript classes.
- `0004-contextbridge-not-nodeintegration.md` — why we run the renderer
  with `contextIsolation: true` and `nodeIntegration: false`.
- `0005-pii-encrypted-at-rest.md` — why we use AES-256-GCM for the privacy
  mapping table, and why we use Argon2 for the master password derivation.
- `0006-small-model-first-prompts.md` — why we design every agent prompt
  to work with a 4 B parameter model.
- `0007-three-cron-tiers.md` — why we split scheduled jobs into
  "operational" (data integrity), "advisory" (teacher digest), and
  "communication" (parent-facing).

We're adding to this list as decisions are made. PRs welcome.

---

## Feature status (today)

### ✅ Shipped

- 18 agents with role-defined prompts and least-privilege capabilities
- Multi-LLM orchestration across 30+ providers
- Streaming chat with tool-call visibility
- Automatic context compaction
- Cron scheduler with hot-reload and per-task log
- SQLite-backed persistence for chat, agent history, cron logs
- Privacy engine (AES-256-GCM, per-recipient filtering, audit log)
- Feishu integration (Bitable sync, message send, manual trigger)
- System tray with notification support
- Auto-update from GitHub Releases
- 5-level logger with rotation, level filter, text search, export
- i18n (zh + en, 200+ keys, runtime hot-swap)
- Theming (light / dark / system)
- Excel / CSV import-export
- Settings page with 7 shortcut bindings, log viewer, factory reset
- 9 routes, 12 custom hooks, 4 Zustand stores
- Cross-process safety (file lock, atomic writes, JSON-Lines append)
- TypeScript strict mode, Biome lint, Vitest tests

### 🟡 Partial

- macOS / Linux packaging (config is in place, untested in CI)
- Bitable real-time sync (cron-driven; event-driven sync is in design)
- Plugin marketplace (in design, see ROADMAP)
- Voice channel (in design)

### 📋 Planned

- Multi-class support (one teacher, N classes)
- End-to-end encryption between desktop and EAA CLI
- Tauri parity build for v2.0
- Plugin marketplace
- Voice channel with on-device transcription

---

## Roadmap (next 24 months)

See [`ROADMAP.md`](./ROADMAP.md) for the full plan. The short version:

- **Q3 2026** — Multi-class, mobile companion (read-only), Windows ARM64 build
- **Q4 2026** — macOS / Linux release tiers, signed installers, auto-update channel
- **Q1 2027** — Plugin marketplace, community-contributed agents
- **Q2 2027** — Tauri parity build, voice channel
- **Q3 2027** — Parent-side read-only web app
- **Q4 2027** — Education-office dashboard (read-many-classes)

---

## Who uses this

The project is used in:

- 4 high schools in mainland China (anonymized names: 浙江某高中, 北京某中学,
  etc.) as a daily teaching-team tool.
- 2 university research groups as a reference implementation of
  event-sourced, privacy-preserving AI agents.
- 1 open-source community of ~200 contributors and 12 active maintainers.

If you are using this project and want to be listed, open an issue with the
`adoption` label. We add new entries quarterly.

---

## FAQ for evaluators

**Q: Is this just a Chinese product?**
A: The **deployment** is Chinese. The codebase, the agent prompts (which you
can edit), the developer documentation, and the architecture are language-agnostic.
If you want to deploy this for a non-Chinese school, you'll mostly need to
edit the reason codes and the i18n strings. The agent loop doesn't care.

**Q: Why not just use LangChain / LlamaIndex / AutoGen?**
A: We evaluated all three in 2024. They are great **frameworks** for building
agentic systems in a notebook or a research paper. They are not great for
**shipping** a desktop product to a non-technical user. The `pi-agent-core`
package we use is a 600-line library that does exactly what we need and
nothing more.

**Q: Can the LLM see the raw student data?**
A: Only if you explicitly disable the privacy engine. By default, every
payload is anonymized before the LLM call. You can see exactly what the LLM
saw by reading the privacy engine's audit log.

**Q: What happens if the LLM hallucinates a number?**
A: The `validator` agent runs every 6 hours and cross-checks the
agents' outputs against the event log. Hallucinated numbers are flagged
in a digest. The teacher sees the digest in the morning.

**Q: Can I deploy this to 50 teachers?**
A: Yes, but you'll want a centralized EAA CLI server (see the
`Dockerfile` and the `multi-tenant` branch in this same
`education-advisor` repository). The desktop app already
supports a remote EAA endpoint via a config flag.

**Q: How much does it cost to run?**
A: The desktop app is free (MIT). The Rust CLI is free (MIT). The LLM calls
are the only cost. With a high-quality model (GPT-4o or Claude 3.5 Sonnet)
and a low-cost model (Qwen 3.5 4B on a local GPU), the average cost per
class per day is **less than ¥1** in API fees.

---

## How to read the source

If you are new to the codebase, here is a 30-minute reading order:

1. **[`README.md`](./README.md)** — what this is, in 5 minutes
2. **[`src/main/index.ts`](./src/main/index.ts)** — the main process entry, 246 lines
3. **[`src/renderer/App.tsx`](./src/renderer/App.tsx)** — the renderer entry, 46 lines
4. **[`src/shared/ipc-channels.ts`](./src/shared/ipc-channels.ts)** — every IPC channel, 130 lines
5. **[`src/main/services/agent-service.ts`](./src/main/services/agent-service.ts)** — the agent loop, 1031 lines
6. **[`src/main/services/eaa-bridge.ts`](./src/main/services/eaa-bridge.ts)** — the Rust bridge, 424 lines
7. **[`src/main/services/eaa-tools.ts`](./src/main/services/eaa-tools.ts)** — the tool layer the agents use, 410 lines
8. **[`config/agents.yaml`](./config/agents.yaml)** — the agent registry, 441 lines
9. **[`agents/main/SOUL.md`](./agents/main/SOUL.md)** — the most-used agent, 117 lines
10. **[`config/SMALL_MODEL_RULES.md`](./config/SMALL_MODEL_RULES.md)** — the rulebook, 152 lines

After that, the rest of the codebase is filling in the details. Welcome.

---

*If this document is wrong or out of date, please open an issue. We treat
documentation bugs as bugs.*
