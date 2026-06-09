# Agent authoring

> **A new agent is one of the highest-leverage contributions you can make
> to this project.** This document is the step-by-step guide to writing
> one that fits the project's design principles.

## Table of contents

- [What is an agent?](#what-is-an-agent)
- [The anatomy of an agent](#the-anatomy-of-an-agent)
- [Walkthrough: a new agent in 5 minutes](#walkthrough-a-new-agent-in-5-minutes)
- [SOUL.md — the personality & scope](#soulmd--the-personality--scope)
- [AGENTS.md — the working rules](#agentsmd--the-working-rules)
- [Registering the agent](#registering-the-agent)
- [Writing the prompt for small models](#writing-the-prompt-for-small-models)
- [Capabilities — the least-privilege list](#capabilities--the-least-privilege-list)
- [Schedule — cron expressions](#schedule--cron-expressions)
- [Risk thresholds](#risk-thresholds)
- [Testing your agent](#testing-your-agent)
- [Common mistakes](#common-mistakes)
- [Submitting your agent as a PR](#submitting-your-agent-as-a-pr)

---

## What is an agent?

In this project, an "agent" is **not a piece of code in the
microservice sense**. An agent is:

- A pair of Markdown files (`SOUL.md` + `AGENTS.md`).
- An entry in `config/agents.yaml`.
- An in-memory runtime object that the agent service builds at boot.

The agent service (in `src/main/services/agent-service.ts`) reads
the Markdown files, concatenates them with the global rulebook
(`config/SMALL_MODEL_RULES.md`) and any active skills
(`skills/STUDENT_MANAGEMENT.md`, etc.), and passes the whole thing
to the LLM as the system prompt.

When the user (or a cron job) triggers the agent, the agent loop:

1. Loads the system prompt.
2. Loads the conversation history (if any).
3. Sends the user's prompt to the LLM.
4. Receives a response — either a natural-language message or a
   tool call.
5. If a tool call: validates it against the agent's `capabilities`
   list, sanitizes the parameters, calls the EAA bridge, returns
   the result to the LLM.
6. Repeats from 4 until the LLM produces a final natural-language
   response.
7. Streams the response to the renderer.
8. Persists the conversation to SQLite.

The agent itself is **just a prompt**. The framework handles
everything else.

---

## The anatomy of an agent

```
agents/
└── my-agent/
    ├── SOUL.md         # 角色 + 核心职责 + 工具清单
    └── AGENTS.md       # 工作规则（引用 SMALL_MODEL_RULES.md）

config/
└── agents.yaml         # 注册条目（id, capabilities, schedule, ...）
```

That's the whole filesystem footprint. No code, no TypeScript
classes, no dependencies.

---

## Walkthrough: a new agent in 5 minutes

Let's add a new agent called `lab-supervisor` that watches the
chemistry lab's equipment and consumables.

### 1. Create the directory

```bash
mkdir -p agents/lab-supervisor
```

### 2. Write `SOUL.md`

```markdown
# 实验监督员 / Lab Supervisor

## 角色

你是 Education Advisor 的实验监督员 Agent。你的工作是监控化学实验室的设备状态和
试剂库存，发现异常时记录事件并提醒实验管理员。

## 核心职责

- **每日巡检**：检查当天的设备使用情况和试剂消耗。
- **异常报告**：发现设备损坏、试剂过期、库存不足时记录事件。
- **周度汇总**：每周五汇总本周的实验数据。
- **月度盘点**：每月最后一天检查盘点情况。

## 工具清单

- `eaa.list_students` - 列出使用实验室的班级
- `eaa.history` - 查询学生使用实验室的历史
- `eaa.search` - 搜索特定的实验事件
- `eaa.add_event` - 记录设备/试剂相关事件（仅限 lab_ 系列原因码）
- `eaa.codes` - 查询可用的 lab_ 系列原因码
- `feishu.send` - 向实验管理员发送提醒

## 边界

- **不要**记录学生个人的操行分（这是 class-monitor 的工作）。
- **不要**修改任何 reason-codes。
- **不要**访问隐私引擎以外的 PII 数据。

## 数据铁律

参考 `/config/SMALL_MODEL_RULES.md` 的全局规则，特别是"防幻觉铁律"。
所有数字必须从工具调用获取。
```

### 3. Write `AGENTS.md`

```markdown
# Working rules

The global rulebook at `/config/SMALL_MODEL_RULES.md` applies in full.
This file adds lab-supervisor-specific rules.

## Lab-specific output format

When reporting an issue, the output format is:

```
[lab-supervisor] {date} 巡检报告
- {issue 1}
- {issue 2}
- {issue 3}
```

## Lab-specific tool patterns

When a tool call is needed:

1. For inventory checks: `eaa.search --query "lab_"`
2. For a specific reagent: `eaa.search --query "{reagent_name}"`
3. For today's events: `eaa.range --start {today} --end {today}`

## Lab-specific failure handling

If `eaa.add_event` returns `INVALID_REASON_CODE`, the code is not
in the lab_ series — refuse the call and explain why.
```

### 4. Register in `config/agents.yaml`

Add a new entry under the `agents:` list:

```yaml
  - id: lab-supervisor
    name: 实验监督员
    role: 实验室设备与试剂监控
    description: |
      监控化学实验室的设备状态和试剂库存，发现异常时记录事件并提醒。
    enabled: true
    model_tier: low-cost
    capabilities:
      - eaa.read
      - eaa.add_event
      - feishu.send
    schedule:
      cron:
        - "0 8 * * 1"     # 每周一 08:00 设备巡检
        - "0 8 * * 5"     # 每周五 08:00 试剂库存
        - "0 18 28-31 * *" # 每月最后一天 18:00 盘点
    risk_thresholds:
      high: 85
      medium: 93
      low: 93
```

### 5. Restart the app, see the new agent

```bash
npm run dev
# In another terminal
npm run dev:electron
```

Visit `#/agents`. The new `lab-supervisor` should appear in the list.
Click on it, click **Run manual**, type "检查今天的设备状态", and see
what happens.

---

## SOUL.md — the personality & scope

`SOUL.md` is the **system prompt** that gets sent to the LLM. It
should be **in Chinese** (the project is for Chinese class teachers),
**specific** (vague prompts produce vague agents), and
**example-driven** (show, don't tell).

### Recommended structure

```markdown
# {Name} / {English Name}

## 角色

2–3 sentences. Who is this agent? What problem does it solve?

## 核心职责

A bullet list. Each bullet is a concrete behavior.

## 工具清单

A bullet list, one per tool. Each bullet has:
- The tool name
- A one-sentence description of when to use it

## 边界

What the agent **must not** do. This is critical for safety.

## 数据铁律

A pointer to the global rulebook + any agent-specific additions.
```

### What makes a good SOUL.md

- **Specific examples.** Don't say "process conduct points"; say
  "record a +2 conduct point for a student who handed in their
  homework on time".
- **Negative examples.** Don't just say "be helpful"; say "do not
  record conduct points for students you don't have data on".
- **Bilingual labels.** Use both Chinese and English for clarity
  (the maintainer team is bilingual).
- **Tool descriptions that read like documentation.** "Use
  `eaa.history` to retrieve a student's event history. Returns the
  last 100 events by default."

### What makes a bad SOUL.md

- **Vague role descriptions.** "You are a helpful agent" is not
  useful.
- **Long philosophical preambles.** The LLM has limited attention
  budget; every word in the prompt costs tokens.
- **Inconsistent tone.** Mixing formal and informal language
  confuses the model.
- **Hard-coded student names.** "Watch Alice closely" — agents
  shouldn't have per-student hard-codes; that's per-student
  configuration, not prompt engineering.

---

## AGENTS.md — the working rules

`AGENTS.md` is the **operational handbook** for the agent. It's
read in addition to `SOUL.md` and the global `SMALL_MODEL_RULES.md`.

The recommended structure:

```markdown
# Working rules

Reference the global rulebook first.

## {Agent}-specific output format

If the agent has a specific output format (e.g. a structured report),
specify it here.

## {Agent}-specific tool patterns

If the agent has a particular way of calling tools (e.g. always
calls `eaa.search` before `eaa.add_event`), specify it here.

## {Agent}-specific failure handling

If the agent has a particular way of handling errors, specify it
here.

## {Agent}-specific safety

Any agent-specific safety rules that aren't in the global rulebook.
```

The `AGENTS.md` is **not** a place to repeat the global rulebook.
Reference it instead.

---

## Registering the agent

The agent is registered in `config/agents.yaml`. The full schema is
in [`CONFIGURATION.md#configagentsyaml--the-agent-registry`](./CONFIGURATION.md#configagentsyaml--the-agent-registry).

A minimal registration:

```yaml
  - id: my-agent
    name: My Agent
    role: One-line role description
    model_tier: low-cost
    capabilities:
      - eaa.read
    schedule:
      cron: []
```

`enabled` defaults to `true`. The agent is loaded on the next app
restart (or "Reload agents" click in the Agents page).

---

## Writing the prompt for small models

The project's most distinctive design constraint is that **the
prompts must work with small (3–7B) models**. Here's how to write
for that constraint.

### Be explicit, not implicit

❌ **Bad**: "Check if the student needs help"
✅ **Good**: "Use `eaa.history --student {name}` to retrieve the
last 14 days of events. If the score is below 85, recommend
intervention."

The small model doesn't know what "needs help" means. The large
model can guess; the small model needs to be told.

### Use JSON, not English, for tool arguments

The agent's tool calls go through a sanitization layer. If you
write the prompt with English descriptions of the tool, the model
might produce ambiguous JSON. Instead, give the model a strict
schema and an example.

❌ **Bad**: "Pass the student's name and a number"

✅ **Good**:

```yaml
tool: eaa.add_event
args:
  student: string  # 学生姓名，必须在 eaa.list_students 中存在
  code: enum  # 必须是 reason-codes.json 中的合法 code
  delta: integer  # 分数变化
  reason: string  # 简短原因，不超过 50 字
```

### Test on the small model

Before merging, run your agent with the `low-cost` model tier
(Qwen 3.5 4B, GPT-4o-mini, etc.). If it doesn't work on the small
model, it won't work for the average user.

### Avoid multi-step reasoning

The small model loses track after 3–4 tool calls. If your agent
needs to do something complex, **break it into two agents** that
hand off via a shared state.

---

## Capabilities — the least-privilege list

The `capabilities` list is the **single most important security
mechanism** in the project. Every agent should have the **minimum**
capabilities it needs.

### Default deny

Any capability not in the list is rejected at the tool layer. This
is enforced in `src/main/services/eaa-tools.ts` and is the **only**
place where the whitelist is checked.

### Examples

| Agent | Capabilities | Why |
| --- | --- | --- |
| `class-monitor` | `eaa.read`, `eaa.add_event` | Reads the event log; writes new events. |
| `psychology` | `eaa.read`, `eaa.history` | Read-only; never writes events. |
| `home_school` | `eaa.read`, `feishu.send` | Reads data, sends messages. |
| `bug-hunter` | `eaa.read` | Read-only; never writes. |
| `weekly-reporter` | `eaa.read`, `eaa.export` | Reads data, exports reports. |

### The principle

> **An agent should not have a capability it doesn't need, even
> if it would be "convenient".** If you find yourself wanting to
> add a capability "just in case", that's a sign you should split
> the agent into two.

---

## Schedule — cron expressions

The `schedule.cron` field is a list of cron expressions. Each one
triggers a run of the agent.

### Format

The cron format is the standard 5-field format:

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ day of week (0–7, 0 and 7 are Sunday)
│ │ │ └─── month (1–12)
│ │ └───── day of month (1–31)
│ └─────── hour (0–23)
└───────── minute (0–59)
```

### Examples

| Expression | Meaning |
| --- | --- |
| `0 8 * * *` | Every day at 08:00. |
| `0 8 * * 1` | Every Monday at 08:00. |
| `*/15 * * * *` | Every 15 minutes. |
| `0 9-17 * * 1-5` | Hourly from 9 AM to 5 PM, Monday to Friday. |
| `0 0 1 * *` | The 1st of every month at midnight. |

The cron service uses `node-cron`, which extends the standard
format with seconds (6 fields). To use seconds, prefix with the
seconds field:

```
0 0 8 * * *   # every day at 08:00:00
*/30 * * * * * # every 30 seconds
```

### Caveats

- **Cron is timezone-aware.** The default is the system's local
  time. To set a specific timezone, configure the `TZ` env var.
- **Cron jobs do not run while the app is closed.** If you need
  always-on scheduling, deploy the EAA CLI on a server and use
  its built-in cron. See the EAA CLI's documentation.
- **Cron jobs can overlap.** If a job takes longer than its
  interval, the next tick will still fire. The agent service has
  a reentrancy guard per agent to prevent double-execution.

---

## Risk thresholds

The `risk_thresholds` field is an object with three integer keys:

```yaml
risk_thresholds:
  high: 85    # conduct score at or below this is "high risk"
  medium: 93
  low: 93
```

The thresholds are used by agents that perform risk assessment
(e.g. `risk-alert`, `psychology`). When the agent's computed
"risk level" is `high`, it pushes a digest to the user; when it's
`medium` or `low`, it stays in the agent's log.

The defaults are tuned for a 100-point conduct score system where:

- 0–84: high risk (3+ serious incidents in 14 days)
- 85–92: medium risk (1–2 incidents in 14 days)
- 93–100: low risk (clean)

If your school uses a different scale, edit the defaults in
`config/agents.yaml`.

---

## Testing your agent

### Manual smoke test

1. Restart the app (or click "Reload agents").
2. Visit `#/agents`, find your agent, click **Run manual**.
3. Type a realistic prompt.
4. Observe the response. The response should:
   - Use at least one tool (the model should be calling
     `eaa.*` or `feishu.*`).
   - Cite the data it received from the tool (no hallucinated
     numbers).
   - Match the format you specified in `AGENTS.md`.
5. If the response is wrong, edit `SOUL.md` and try again.

### Automated test

The agent service is tested in `tests/main/`. To add a test for
your agent:

1. Open `tests/main/agent-service.test.ts` (create if it doesn't
   exist).
2. Add a `describe('lab-supervisor', ...)` block.
3. Mock the EAA bridge and the LLM provider.
4. Run your agent with a fixed prompt.
5. Assert on the response.

Example:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { agentService } from '../../src/main/services/agent-service'
import { eaaBridge } from '../../src/main/services/eaa-bridge'

describe('lab-supervisor', () => {
  it('records a lab_equipment_damage event when prompted', async () => {
    vi.spyOn(eaaBridge, 'addEvent').mockResolvedValue({
      event_id: 'evt_test',
      ts: '2026-06-09T08:00:00.000+08:00',
    })
    const result = await agentService.run(
      'lab-supervisor',
      'The chemistry lab\'s beaker #3 broke today',
    )
    expect(result).toMatchObject({
      tool_calls: expect.arrayContaining([
        expect.objectContaining({
          name: 'eaa.addEvent',
          args: expect.objectContaining({
            code: 'LAB_EQUIPMENT_DAMAGE',
          }),
        }),
      ]),
    })
  })
})
```

---

## Common mistakes

### 1. Over-broad capabilities

❌ **Bad**: `capabilities: ['all']`
✅ **Good**: `capabilities: ['eaa.read', 'eaa.add_event']`

The first version lets the agent do anything. The second version
constrains it to exactly what it needs.

### 2. Vague role descriptions

❌ **Bad**: "You are a helpful agent that watches the lab."
✅ **Good**: "You monitor the chemistry lab's equipment status and
reagent inventory. When something is broken or out of stock, you
record an event and notify the lab supervisor."

The first is too vague for a small model. The second is specific
and actionable.

### 3. Hidden tool assumptions

❌ **Bad**: "Look up the student's last incident" (assumes
`eaa.history` is available)
✅ **Good**: "Use `eaa.history --student {name} --limit 1` to get
the most recent incident."

The first leaves the choice of tool to the model. The second is
explicit.

### 4. Missing output format

❌ **Bad**: "Report what you found."
✅ **Good**: "Output as a bullet list, one item per finding, with
the date and a one-sentence description."

The first produces inconsistent output. The second is parseable
and consistent.

### 5. Inheriting too much from another agent

If your agent's `SOUL.md` is 90% the same as another agent's,
consider whether the two should be **the same agent with a
parameter**, not two separate agents.

### 6. Not testing on the small model

The default model is `low-cost`. If your agent doesn't work on
GPT-4o-mini / Qwen 4B, it won't work for the average user.

### 7. Hard-coding student names

The agent should not have a `AGENTS.md` that says "watch Alice
closely". That's per-student configuration, which lives in
`entities/students.json` and is read by the agent at runtime.

---

## Submitting your agent as a PR

1. Fork the repo.
2. Create a branch: `git checkout -b agent/lab-supervisor`.
3. Add the files: `agents/lab-supervisor/SOUL.md`,
   `agents/lab-supervisor/AGENTS.md`, and the entry in
   `config/agents.yaml`.
4. Add a test in `tests/main/agent-service.test.ts`.
5. Update `config/agents.yaml` documentation in
   [`CONFIGURATION.md`](./CONFIGURATION.md) if you added a new
   capability.
6. Run the quality gates: `npm run typecheck && npm run lint && npm run test`.
7. Push and open a PR using the **Agent change** checkbox in the
   PR template.
8. Wait for review. The maintainer team will respond within a
   week.

Welcome aboard. We're excited to see what you build.
