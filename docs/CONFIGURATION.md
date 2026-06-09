# Configuration

> **All the knobs you can turn, where to find them, and which one
> matters for what.** Most users will only ever touch the in-app
> **Settings** page. This document is for the maintainer team, plugin
> authors, and people who like to edit YAML.

## Table of contents

- [Configuration layers](#configuration-layers)
- [`config/agents.yaml` — the agent registry](#configagentsyaml--the-agent-registry)
- [`config/reason-codes.json` — the event taxonomy](#configreason-codesjson--the-event-taxonomy)
- [`config/default-settings.json` — first-run defaults](#configdefault-settingsjson--first-run-defaults)
- [`config/SMALL_MODEL_RULES.md` — the prompt rulebook](#configsmall_model_rulesmd--the-prompt-rulebook)
- [In-app settings](#in-app-settings)
- [Environment variables](#environment-variables)
- [.env file format](#env-file-format)
- [Per-install overrides](#per-install-overrides)

---

## Configuration layers

The app reads its configuration from three places, in order of
precedence (highest first):

1. **In-app Settings page** (`#/settings`) — runtime config, persisted
   to `userData/settings.json`. The user changes these through the
   Settings UI.
2. **`config/` directory** in the installation — defaults shipped with
   the app. Editable on disk by the maintainer / advanced user.
3. **Hard-coded fallbacks** in `src/main/services/settings-service.ts`
   — for first-run, used only if both the user settings and the
   shipped config are missing.

```
┌──────────────────────────────────────────────────┐
│  in-app settings (user-edited, highest priority) │
├──────────────────────────────────────────────────┤
│  config/ directory (shipped defaults)            │
├──────────────────────────────────────────────────┤
│  hard-coded fallbacks (in settings-service.ts)   │
└──────────────────────────────────────────────────┘
```

This layering lets the maintainer team ship sensible defaults while
the user can override anything in the UI.

---

## `config/agents.yaml` — the agent registry

This is the **canonical registry of all 18 agents**. The Agents page
in the app reads from this file (and writes back to it when you edit
an agent).

### Schema

```yaml
agents:
  - id: string                  # unique id, kebab-case
    name: string                # human-readable name (Chinese or English)
    role: string                # one-line role description
    description: string         # multi-line role description
    enabled: boolean            # default: true
    model_tier: 'high-quality' | 'low-cost'
    capabilities:               # least-privilege list
      - 'eaa.read'
      - 'eaa.add_event'
      - 'eaa.history'
    schedule:
      cron:                     # list of cron expressions
        - '0 8 * * 1'           # Monday 08:00
    risk_thresholds:
      high: 85                  # conduct score below which is "high risk"
      medium: 93
      low: 93
```

### Field-by-field

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | string | yes | — | Unique across the registry. Kebab-case. |
| `name` | string | yes | — | Display name. Bilingual OK. |
| `role` | string | yes | — | One-line role description. |
| `description` | string | no | `""` | Long description. Shown in the Agents page. |
| `enabled` | bool | no | `true` | Whether the agent is loaded at boot. |
| `model_tier` | enum | yes | — | `'high-quality'` or `'low-cost'`. |
| `capabilities` | list | yes | `[]` | The operations this agent is allowed to call. |
| `schedule.cron` | list | no | `[]` | Cron expressions. Each one triggers a run. |
| `risk_thresholds` | object | no | `{high: 85, medium: 93, low: 93}` | Per-agent overrides of the global risk thresholds. |

### Valid capabilities

The full list of capabilities the agent loop understands:

| Capability | Operations |
| --- | --- |
| `eaa.read` | score, history, search, range, tag, stats, validate, list_students, codes, doctor, summary, info |
| `eaa.add_event` | add_event |
| `eaa.revert_event` | revert_event |
| `eaa.delete_student` | delete_student |
| `eaa.export` | export |
| `eaa.import` | import |
| `eaa.dashboard` | dashboard |
| `privacy.anonymize` | privacy.anonymize |
| `privacy.deanonymize` | privacy.deanonymize (with recipient check) |
| `privacy.filter` | privacy.filter |
| `privacy.list` | privacy.list |
| `feishu.send` | feishu.send |
| `feishu.sync` | feishu.sync_now (manual trigger) |
| `settings.read` | settings.get |
| `settings.write` | settings.set |
| `cron.read` | cron.list |
| `cron.write` | cron.add, cron.update, cron.toggle |
| `log.read` | log.list, log.read, log.filter, log.search |
| `log.write` | log.export, log.write_renderer |
| `chat.read` | chat.load_messages, chat.list_sessions |
| `chat.write` | chat.save_message |
| `chat.delete` | chat.delete_session |
| `agent.read` | agent.list, agent.get, agent.get_soul, agent.get_rules, agent.get_history |
| `agent.write` | agent.toggle, agent.update, agent.set_soul, agent.set_rules, agent.run_manual |
| `agent.abort` | agent.abort |
| `sys.notify` | sys.notification |
| `sys.open_external` | sys.open_external (with URL allow-list check) |
| `skill.read` | skill.list, skill.get |
| `skill.write` | skill.save, skill.delete |
| `profile.read` | profile.get |
| `profile.write` | profile.set |

**Default deny**: any capability not in the agent's list is rejected
at the `eaa-tools.ts` boundary.

### The 18 default agents

| `id` | `name` | `model_tier` | `capabilities` |
| --- | --- | --- | --- |
| `main` | 教育参谋 | high-quality | read, write, notify, push, settings.read |
| `governor` | 督导 | low-cost | eaa.read, privacy.filter |
| `counselor` | 辅导员 | low-cost | eaa.read, eaa.add_event |
| `supervisor` | 督导汇总 | low-cost | eaa.read |
| `validator` | 数据效验 | low-cost | eaa.read |
| `academic` | 学业分析师 | high-quality | eaa.read, eaa.stats |
| `psychology` | 心理危机监测 | low-cost | eaa.read, eaa.history |
| `safety` | 安全检查员 | low-cost | eaa.read, eaa.add_event |
| `home_school` | 家校沟通 | low-cost | eaa.read, feishu.send |
| `research` | 科研助理 | low-cost | eaa.read |
| `executor` | 系统执行员 | low-cost | eaa.read, eaa.codes |
| `bug-hunter` | Bug Hunter | low-cost | eaa.read |
| `class-monitor` | 班务助理 | low-cost | eaa.read, eaa.add_event |
| `risk-alert` | 风险预警员 | low-cost | eaa.read, eaa.stats |
| `data-analyst` | 数据分析师 | high-quality | eaa.read, eaa.stats |
| `student-care` | 学生关怀员 | low-cost | eaa.read, eaa.add_event |
| `discipline-officer` | 纪律管理员 | low-cost | eaa.read, eaa.add_event |
| `weekly-reporter` | 周报撰写员 | high-quality | eaa.read, eaa.export |

The YAML file is the single source of truth. The Agents page in the
app reads from this file and writes back to it (via the
`agent:update` IPC channel).

---

## `config/reason-codes.json` — the event taxonomy

Defines the valid event codes. The EAA CLI validates every event
against this schema.

### Schema

```json
{
  "version": 1,
  "categories": {
    "deduct": [
      {
        "code": "SPEAK_IN_CLASS",
        "label": "课堂讲话",
        "label_en": "Speaking in class",
        "default_delta": -2,
        "description": "..."
      }
    ],
    "bonus": [
      {
        "code": "BONUS_VARIABLE",
        "label": "教师裁量加分",
        "label_en": "Teacher discretionary bonus",
        "default_delta": 0,
        "description": "...",
        "is_variable": true
      }
    ]
  }
}
```

### Field-by-field

| Field | Type | Description |
| --- | --- | --- |
| `version` | int | The schema version. Bump when adding / removing codes. |
| `categories.deduct` | list | Codes that subtract from the conduct score. |
| `categories.bonus` | list | Codes that add to the conduct score. |
| `categories.system` | list | Internal codes (e.g. `REVERT`). |
| `categories.lab` | list | Lab-safety-specific codes. |

For each code:

| Field | Type | Description |
| --- | --- | --- |
| `code` | string | Unique code, `UPPER_SNAKE_CASE`. |
| `label` | string | Display name (Chinese). |
| `label_en` | string | Display name (English). |
| `default_delta` | int | The default score change. Positive for bonus, negative for deduct. |
| `description` | string | What this code means, in one sentence. |
| `is_variable` | bool | (optional) If true, the LLM must specify the delta explicitly. |

### The 24 default codes

<details>
<summary>Click to expand the full list</summary>

| Code | Category | Default delta | Description |
| --- | --- | --- | --- |
| `SPEAK_IN_CLASS` | deduct | −2 | Speaking without permission in class |
| `SLEEP_IN_CLASS` | deduct | −2 | Sleeping in class |
| `LATE` | deduct | −2 | Arriving late to class or assembly |
| `SCHOOL_CAUGHT` | deduct | −5 | Caught by the school for a rule violation |
| `MAKEUP` | deduct | −2 | Failed to submit homework on time |
| `DESK_UNALIGNED` | deduct | −1 | Desk not aligned during inspection |
| `PHONE_IN_CLASS` | deduct | −5 | Using a phone in class |
| `SMOKING` | deduct | −10 | Smoking on school grounds |
| `DRINKING_DORM` | deduct | −5 | Drinking alcohol in the dormitory |
| `OTHER_DEDUCT` | deduct | −1 | Other teacher-discretionary deduction |
| `APPEARANCE_VIOLATION` | deduct | −2 | Dress code or appearance violation |
| `BONUS_VARIABLE` | bonus | variable | Teacher discretionary bonus (LLM specifies the delta) |
| `ACTIVITY_PARTICIPATION` | bonus | +1 | Active participation in class |
| `CLASS_MONITOR` | bonus | +10 | Awarded for class-monitor-of-the-week |
| `CLASS_COMMITTEE` | bonus | +5 | Awarded for class-committee-of-the-week |
| `CIVILIZED_DORM` | bonus | +3 | Awarded for civilized-dorm-of-the-week |
| `MONTHLY_ATTENDANCE` | bonus | +2 | Perfect attendance for the month |
| `REVERT` | system | 0 | Undoes a previous event |
| `LAB_EQUIPMENT_DAMAGE` | lab | −5 | Damaged lab equipment |
| `LAB_SAFETY_VIOLATION` | lab | −10 | Violated lab safety rules |
| `LAB_UNSAFE_BEHAVIOR` | lab | −5 | Unsafe behavior in the lab |
| `LAB_CLEAN_UP` | lab | −1 | Failed to clean up after lab work |

</details>

### Adding a new code

To add a new reason code:

1. Open `config/reason-codes.json`.
2. Add the new entry to the appropriate category.
3. Bump the `version` field.
4. Restart the app.

The EAA CLI hot-reloads the schema on the next invocation.

### Removing a code

To remove a reason code:

1. Open `config/reason-codes.json`.
2. Remove the entry.
3. Bump the `version` field.
4. (Optional) Run a data migration if existing events use the old code:

```bash
eaa migrate --rename-code OLD_CODE NEW_CODE
```

The schema is forward-compatible: events with the old code remain in
the log but the agent prompts will no longer reference them.

---

## `config/default-settings.json` — first-run defaults

The settings that are seeded into `userData/settings.json` on first
run. After first run, the user's edits in the Settings page take
precedence and this file is no longer consulted.

### Schema

```json
{
  "general": {
    "dataDir": "",
    "defaultOperator": "teacher",
    "theme": "system",
    "language": "zh-CN",
    "autoUpdate": true,
    "telemetry": false,
    "logLevel": "info",
    "autoStart": false,
    "minimizeToTray": true,
    "closeBehavior": "ask"
  },
  "models": {
    "defaultProvider": "openai",
    "defaultModel": "gpt-4o-mini",
    "highQualityModel": "openai/gpt-4o",
    "lowCostModel": "openai/gpt-4o-mini",
    "enabledModels": ["openai/gpt-4o", "openai/gpt-4o-mini"],
    "transport": "https",
    "cacheRetention": 7,
    "retry": {
      "maxAttempts": 3,
      "initialDelayMs": 1000,
      "maxDelayMs": 30000,
      "backoffFactor": 2
    },
    "providerBlacklist": [],
    "customModels": []
  },
  "chat": {
    "compaction": {
      "enabled": true,
      "thresholdTokens": 60000,
      "targetTokens": 30000,
      "modelTier": "low-cost"
    },
    "steeringMode": "append",
    "followUpMode": "queue",
    "showImages": true,
    "maxTokens": 4096,
    "conversationLogging": true
  },
  "privacy": {
    "enabled": true,
    "autoAnonymize": true
  },
  "feishu": {
    "appId": "",
    "appSecret": "",
    "userOpenId": "",
    "bitableSync": {
      "enabled": false,
      "syncInterval": 300
    }
  },
  "advanced": {
    "shellPath": "",
    "sessionDir": "",
    "httpIdleTimeoutMs": 60000
  },
  "shortcuts": {
    "chat.new": "Ctrl+N",
    "chat.send": "Enter",
    "chat.abort": "Escape",
    "nav.dashboard": "Ctrl+1",
    "nav.chat": "Ctrl+2",
    "nav.students": "Ctrl+3",
    "nav.agents": "Ctrl+4"
  }
}
```

The runtime defaults (used as a fallback if `default-settings.json` is
missing) are in
`src/main/services/settings-service.ts` and are more detailed.

---

## `config/SMALL_MODEL_RULES.md` — the prompt rulebook

Every agent's system prompt includes this file. It defines the
non-negotiable rules that the agent must follow, especially when
running on a small (3–7B parameter) model.

The file is included verbatim in the agent's system prompt, so its
**length affects the LLM's per-call cost**. The current file is
~150 lines / ~3 KB.

To edit the rulebook:

1. Open `config/SMALL_MODEL_RULES.md`.
2. Edit the content.
3. Restart the app (or click "Reload agents" in the Agents page).

The rulebook is **not** versioned per agent — all agents share the
same rulebook. If you need per-agent rules, write them in the
agent's own `AGENTS.md` file.

---

## In-app settings

The in-app Settings page (`#/settings`) exposes the most-used
configuration. The full list of settings and their descriptions:

### General

| Setting | Default | Description |
| --- | --- | --- |
| Data directory | (auto) | Where the app stores SQLite, logs, and EAA data. |
| Default operator | `teacher` | The name used in the `actor` field of new events. |
| Theme | `system` | `light`, `dark`, or `system` (follows OS). |
| Language | `zh-CN` | `zh-CN` or `en-US`. |
| Auto update | `true` | Check for updates on launch. |
| Telemetry | `false` | Send anonymous usage metrics. **Off by default.** |
| Log level | `info` | `debug`, `info`, `warn`, `error`, or `fatal`. |
| Auto start | `false` | Launch the app on OS login. |
| Minimize to tray | `true` | Minimize to system tray instead of closing. |
| Close behavior | `ask` | `tray` (hide), `exit` (quit), or `ask` (prompt every time). |

### Models

| Setting | Default | Description |
| --- | --- | --- |
| Default provider | `openai` | The default LLM provider. |
| Default model | `gpt-4o-mini` | The default model. |
| High-quality model | `openai/gpt-4o` | The model for `high-quality` tier. |
| Low-cost model | `openai/gpt-4o-mini` | The model for `low-cost` tier. |
| Enabled models | (list) | The models available in the model picker. |
| Transport | `https` | `https` or `http` (insecure; for local proxies). |
| Cache retention | `7` days | How long to cache model responses. |
| Retry | `{maxAttempts: 3, ...}` | Retry policy for failed LLM calls. |
| Provider blacklist | (list) | Providers to hide in the model picker. |
| Custom models | (list) | User-added OpenAI-compatible endpoints. |

### Chat

| Setting | Default | Description |
| --- | --- | --- |
| Compaction enabled | `true` | Auto-summarize long conversations. |
| Compaction threshold | `60000` tokens | When to trigger compaction. |
| Compaction target | `30000` tokens | What to compress to. |
| Compaction model tier | `low-cost` | Which model tier to use. |
| Steering mode | `append` | How to handle steering messages. |
| Follow-up mode | `queue` | How to handle follow-up messages. |
| Show images | `true` | Render images in the chat. |
| Max tokens | `4096` | The max output tokens per chat call. |
| Conversation logging | `true` | Persist chat history to SQLite. |

### Privacy

| Setting | Default | Description |
| --- | --- | --- |
| Enabled | `true` | Whether the privacy engine is active. |
| Auto anonymize | `true` | Whether to anonymize before any LLM call. |

### Feishu

| Setting | Default | Description |
| --- | --- | --- |
| App ID | (empty) | The Feishu app ID. |
| App secret | (empty, in keystore) | The Feishu app secret. **Stored encrypted in the OS keystore.** |
| User Open ID | (empty) | The user's open_id for direct messages. |
| Bitable sync enabled | `false` | Whether to sync to a Bitable. |
| Bitable sync interval | `300` seconds | How often to sync. |

### Advanced

| Setting | Default | Description |
| --- | --- | --- |
| Shell path | (empty) | Override the shell used by EAA tool calls. |
| Session dir | (empty) | Override the EAA session directory. |
| HTTP idle timeout | `60000` ms | The HTTP idle timeout for LLM calls. |

### Shortcuts

| Setting | Default | Description |
| --- | --- | --- |
| `chat.new` | `Ctrl+N` | New chat. |
| `chat.send` | `Enter` | Send the current message. |
| `chat.abort` | `Escape` | Abort the current stream. |
| `nav.dashboard` | `Ctrl+1` | Navigate to Dashboard. |
| `nav.chat` | `Ctrl+2` | Navigate to Chat. |
| `nav.students` | `Ctrl+3` | Navigate to Students. |
| `nav.agents` | `Ctrl+4` | Navigate to Agents. |

All shortcuts are remappable in the Settings page.

---

## Environment variables

The app reads the following environment variables at startup:

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | (auto) | Set by the build tool. `development` or `production`. |
| `VITE_DEV_SERVER_URL` | (auto) | The renderer dev server URL. |
| `ENABLE_CDP` | `0` | Set to `1` to enable Electron remote debugging on `localhost:9222`. |
| `EAA_RELEASE_REPO` | `232252/education-advisor` | The repo to fetch the EAA binary from. |
| `EAA_RELEASE_TAG` | (empty) | Pin to a specific EAA release tag. |
| `EDUCATION_ADVISOR_TELEMETRY` | `0` | Set to `1` to opt into anonymous telemetry. |
| `EDUCATION_ADVISOR_TELEMETRY_ENDPOINT` | (empty) | Where to send telemetry events. |
| `HTTPS_PROXY` / `HTTP_PROXY` | (empty) | Standard proxy environment variables. |

---

## .env file format

For local development, you can use a `.env` file in the project root.
The file is **git-ignored**. See `.env.example` for the template.

```dotenv
# EAA binary source
EAA_RELEASE_REPO=232252/education-advisor
EAA_RELEASE_TAG=v0.1.0

# Development helpers
ENABLE_CDP=0

# Telemetry (off by default)
EDUCATION_ADVISOR_TELEMETRY=0
```

Variables in `.env` are loaded by Vite at build time and by the
main process at runtime. They take precedence over the hard-coded
defaults but are overridden by the in-app settings.

---

## Per-install overrides

For a school-wide deployment, the IT admin can ship a custom
`config/` directory that overrides the defaults. The flow:

1. Clone the repo.
2. Edit `config/agents.yaml`, `config/reason-codes.json`, etc.
3. Build the installer: `npm run build && npm run package`.
4. Distribute the custom installer to the school.

For multi-machine deployments, see the [DISTRIBUTION.md](./DISTRIBUTION.md)
guide.
