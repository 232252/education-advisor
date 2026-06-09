# FAQ

> **Frequently Asked Questions.** If you have a question that's not
> here, open a
> [GitHub Discussion](https://github.com/232252/education-advisor/discussions)
> and we'll add it.

## General

**Q: What is Education Advisor?**

A: Education Advisor is a **cross-platform desktop application**
(Electron 33 + React 18 + TypeScript 5.7) that is the **desktop
upgrade** of the [education-advisor](https://github.com/232252/education-advisor)
project. The v3.x release was a CLI-only Rust project; this v0.1.0
release is the same multi-agent system, ported to a desktop GUI.
The Rust `eaa-cli` is the data engine that powers it under the hood.

**Q: Is this a Chinese-only product?**

A: The **deployment** is Chinese. The codebase, the agent prompts
(which you can edit), the developer documentation, and the
architecture are language-agnostic. If you want to deploy this
for a non-Chinese school, you'll mostly need to edit the reason
codes, the i18n strings, and (if you want) the agent prompts. The
agent loop doesn't care.

**Q: Why is it called "Education Advisor" and not "Education Advisor
Desktop"?**

A: The project is designed to be the "workstation" for any
class teacher — not just for the specific workflows of student
conduct management. The 18 agents cover a broad range of
classroom tasks (academic analysis, psychology, safety, research,
etc.). "Education Advisor" captures the breadth better than a
single-purpose name.

**Q: Who maintains this?**

A: A small group of volunteer maintainers, listed in
[`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md). The original
project started in early 2025 as a one-person effort; the
maintainer team has grown to 4 people as of June 2026.

**Q: How is this different from ChatGPT / Claude / Qwen?**

A: Three things:

1. **It's local-first.** Your data stays on your machine.
2. **It's agent-based, not chat-based.** The 18 agents have
   defined roles, defined permissions, and a defined schedule.
3. **It's privacy-preserving.** PII is anonymized before any
   LLM call. The audit log records every `anonymize` /
   `deanonymize`.

**Q: Is it free?**

A: The desktop app is MIT-licensed. Free to use, free to modify,
free to redistribute. The LLM calls are the only ongoing cost,
and you can use a free local model (Ollama, LM Studio) to
eliminate that cost.

**Q: Can I use this without internet?**

A: Yes — for everything except the LLM calls. The app, the data
engine, the scheduler, the privacy engine all work offline. If
you point the LLM at Ollama or LM Studio on `localhost`, the
whole stack runs offline.

**Q: Does it support Mac / Linux?**

A: macOS (x64 + arm64) and Linux (x64) are configured in
`electron-builder.yml` but **not** yet part of the default CI
pipeline. See [`DISTRIBUTION.md`](./DISTRIBUTION.md) for the
steps to add a macOS / Linux build.

**Q: How big is the installer?**

A: ~85 MB (NSIS) / ~75 MB (portable) on Windows x64, dominated
by the Chromium runtime and the Rust EAA binary. The Electron
shell itself is ~50 MB; the EAA binary is ~20 MB; the rest is
your code, configs, and 18 agents.

## Architecture

**Q: Why Electron and not Tauri / native?**

A: When we started, Tauri's Windows code-signing and auto-update
story was still rough. We're tracking the Tauri ecosystem — see
[`ROADMAP.md`](../ROADMAP.md#pillar-4-cross-platform-parity) for
the long-term plan.

**Q: Why React and not Vue / Svelte?**

A: The team had React muscle memory, and the Pi Agent core is
published as a React-friendly library. We're not opposed to other
frameworks in principle; the renderer is isolated enough that a
svelte port is feasible if the maintainer team gets the
bandwidth.

**Q: Why a separate Rust CLI and not Node-native?**

A: Reproducible builds, separation of concerns, performance
isolation, and memory isolation. See
[`EAA_BRIDGE.md#why-a-separate-process`](./EAA_BRIDGE.md#why-a-separate-process)
for the full reasoning.

**Q: Can I delete the Rust EAA dependency?**

A: Yes — every IPC call to EAA goes through a single funnel
(`src/main/services/eaa-bridge.ts`). You can swap it for any
other data engine (PostgreSQL, Firestore, your own service) by
replacing that file. The agent prompts and the UI are decoupled.

**Q: How do the agents talk to the LLM?**

A: Through the `@earendil-works/pi-ai` SDK, which abstracts 30+
providers behind a single interface. Each agent's
`model_tier` (`high-quality` or `low-cost`) determines which
provider / model is used.

**Q: How do the agents talk to the data?**

A: Through the EAA bridge, which spawns the Rust CLI as a child
process. The bridge validates every call against the agent's
`capabilities` list (whitelist) and sanitizes every parameter.

**Q: Can the LLM see the raw student data?**

A: Only if you explicitly disable the privacy engine. By default,
every payload is anonymized before the LLM call. You can see
exactly what the LLM saw by reading the privacy engine's audit
log.

## Privacy

**Q: What does the privacy engine anonymize?**

A: Real names, student IDs, phone numbers, ID card numbers, home
addresses, and emails. See
[`PRIVACY_ENGINE.md#what-it-anonymizes`](../PROJECT_INTRO.md#deep-dive-the-privacy-engine)
for the full list with examples.

**Q: What does the privacy engine NOT anonymize?**

A: Conduct scores, timestamps, reason codes, class / grade
structure. The privacy engine is conservative — when in doubt,
it does not anonymize. See
[`PRIVACY_ENGINE.md#limitations`](./PRIVACY_ENGINE.md#limitations)
for the full list.

**Q: Where is the data stored?**

A: On your local machine, in the app's `userData/` directory:

- **Windows**: `%APPDATA%\Education Advisor\`
- **macOS**: `~/Library/Application Support/Education Advisor/`
- **Linux**: `~/.config/Education Advisor/`

Inside that directory:

- `db.sqlite` — the chat history, cron logs, settings
- `eaa-data/events.log` — the event log
- `eaa-data/entities/` — the students, classes
- `eaa-data/privacy/` — the encrypted mapping table + audit log
- `logs/` — the app's log files

**Q: Does the app phone home?**

A: No. The default `telemetry` setting is `false`. If you opt
in, the app sends anonymous usage events to a configurable
endpoint — never to the upstream maintainers. See
[`DISTRIBUTION.md#telemetry`](./DISTRIBUTION.md#telemetry).

**Q: How do I back up my data?**

A: Copy the `userData/` directory to a safe location. The
privacy mapping table is encrypted; the encryption is bound to
the master password. If you forget the master password, the
mapping table is unrecoverable.

**Q: What if I forget the privacy master password?**

A: The mapping table is unrecoverable. The audit log remains
but the pseudonyms cannot be reversed. You can:

1. Disable the privacy engine (the audit log will note the
   disable event).
2. Re-initialize the engine with a new master password.
3. Re-scan the data to rebuild the mapping table.

**Q: What if my school wants to audit the system?**

A: The privacy engine's audit log is the answer. The
[`DISTRIBUTION.md`](./DISTRIBUTION.md) guide has a section on
generating a compliance report.

## Agents

**Q: How do I add a new agent?**

A: Read [`AGENT_AUTHORING.md`](./AGENT_AUTHORING.md). The TL;DR:
drop a `SOUL.md` and an `AGENTS.md` into `agents/your-id/`, add
an entry to `config/agents.yaml`, restart the app. That's it.

**Q: Can the agents talk to each other?**

A: Not directly. Each agent is a separate runtime object with
its own context. They communicate indirectly through the event
log (an agent can write an event, and another agent can read
it on its next run). The roadmap includes a direct
agent-to-agent channel.

**Q: How do I disable an agent?**

A: In the Agents page, click on the agent, toggle "Enabled" off.
Or in `config/agents.yaml`, set `enabled: false`.

**Q: How do I edit an agent's prompt?**

A: In the Agents page, click on the agent, click "Edit SOUL.md"
or "Edit AGENTS.md". Your edits are written to disk. Click
"Reload agents" to apply.

**Q: Can the agents run in parallel?**

A: The default is sequential. The cron service has a single
event loop and processes one agent at a time. To run in
parallel, you can launch multiple instances of the app on
different machines (with a shared EAA server).

**Q: How do the agents know which class to work on?**

A: The default class is configured in `settings.general.defaultClass`.
The agents read this on every run. For multi-class deployments
(v0.4.0+), the class is part of the agent's context.

## LLM

**Q: Which LLM providers are supported?**

A: 30+ providers through the `@earendil-works/pi-ai` SDK,
including:

- OpenAI (gpt-4o, gpt-4.1, o3, o4-mini)
- Anthropic (claude-3.5-sonnet, claude-3.7, claude-4)
- Google Gemini (gemini-2.0-flash, gemini-2.5-pro)
- Mistral (mistral-large, codestral)
- DeepSeek (deepseek-chat, deepseek-reasoner)
- Qwen / DashScope (qwen-max, qwen-plus, qwen-3.5-4b)
- Doubao / Volcengine (doubao-pro, doubao-lite)
- Zhipu (glm-4, glm-4-flash)
- Moonshot Kimi (kimi-k2, moonshot-v1)
- Ollama (any local model)
- LM Studio (any local model)
- OpenAI-compatible catch-all (vLLM, llama.cpp, etc.)

**Q: Can I use a local model?**

A: Yes. The OpenAI-compatible catch-all handles any local server
that exposes an OpenAI-compatible API (Ollama, LM Studio, vLLM,
llama.cpp, etc.). See
[`MODELS.md`](https://www.npmjs.com/package/@earendil-works/pi-ai)
for the full list.

**Q: How much does it cost to run?**

A: With a high-quality model (GPT-4o or Claude 3.5 Sonnet) and a
low-cost model (Qwen 3.5 4B on a local GPU), the average cost
per class per day is **less than ¥1** in API fees.

**Q: Can I use the app without an LLM?**

A: The data engine (EAA CLI) and the desktop shell work
without an LLM. You can add events, view history, export
data — all the data operations work. The LLM is only needed
for the agent features (auto-classification, draft messages,
etc.).

**Q: What happens if the LLM hallucinates a number?**

A: The `validator` agent runs every 6 hours and cross-checks
agents' outputs against the event log. Hallucinated numbers
are flagged in a digest. The teacher sees the digest in the
morning.

## Deployment

**Q: Can I deploy this to 50 teachers?**

A: Yes, but you'll want a centralized EAA CLI server (see the
`multi-tenant` branch of this same `education-advisor` repository).
The desktop app already supports a remote EAA endpoint via a
config flag.

**Q: How do I update the app across 50 machines?**

A: Either:
- Auto-update (default) — each machine checks GitHub
  Releases and prompts the user.
- Group Policy / MDM — push the new installer via your
  enterprise management tool.
- Offline — distribute the new installer on a USB stick or
  file share.

See [`DISTRIBUTION.md`](./DISTRIBUTION.md) for the full guide.

**Q: Can I run this on a server (no GUI)?**

A: The desktop app is GUI-only. For server-side use, deploy the
CLI from this same `education-advisor` repository directly. It
has the same data engine and the same agent system, but driven by cron
+ a CLI instead of a desktop UI.

**Q: How do I migrate from the v3.x CLI to the desktop app?**

A: The data engine is forward-compatible. The v3.x CLI writes
events in the same format as the v0.1.0 CLI. To migrate:

1. Stop the v3.x CLI.
2. Install the desktop app.
3. Run `npm run build:eaa` to fetch the v0.1.0 CLI binary.
4. Point the desktop app at the existing data directory
   (`settings.general.dataDir`).
5. The desktop app will read the existing events, no
   migration needed.

**Q: How do I deploy the desktop app + the Rust CLI together?**

A: They're distributed together. The desktop app's installer
bundles the Rust CLI binary as an `extraResource`. The
desktop app finds the binary at
`process.resourcesPath/eaa-binaries/<platform>/<binary>` at
runtime. No separate install is needed.

## Troubleshooting

**Q: The window opens but stays white.**

A: See [`TROUBLESHOOTING.md#renderer-is-blank`](./TROUBLESHOOTING.md#renderer-is-blank).

**Q: An LLM call fails with a 401 / 403.**

A: Your API key is invalid or has expired. Check Settings →
Models → Test connection.

**Q: An LLM call fails with a 429 (rate limit).**

A: You're sending too many requests too fast. Reduce the cron
frequency or upgrade your LLM plan.

**Q: The app crashes on launch.**

A: Check `%APPDATA%\Education Advisor\logs\main-*.log` (Windows)
or `~/Library/Logs/Education Advisor/main-*.log` (macOS). Look
for the error message and the stack trace.

**Q: The privacy engine says "master password incorrect".**

A: The password is case-sensitive. If you've forgotten it,
there's no recovery — you'll need to re-initialize the
engine with a new password.

**Q: The auto-update doesn't work.**

A: See [`DESKTOP_BUILD.md#auto-update-doesnt-work`](./DESKTOP_BUILD.md#auto-update-doesnt-work).

## Contributing

**Q: How do I contribute?**

A: See [`CONTRIBUTING.md`](../CONTRIBUTING.md). The short
version: fork, branch, code, test, push, PR.

**Q: What's a good first contribution?**

A: Issues tagged
[`good first issue`](https://github.com/232252/education-advisor/issues?q=is%3Aopen+label%3A%22good+first+issue%22)
in the issue tracker. Documentation improvements are also
always welcome.

**Q: How do I add a new LLM provider?**

A: The provider list lives in the `@earendil-works/pi-ai`
package, **not** in this repository. To add a provider:

1. Open an issue here describing the use case.
2. File a PR against
   [`earendil-works/pi-ai`](https://github.com/earendil-works/pi-ai)
   with the new provider file.
3. Once the provider is merged upstream, open a PR here to
   pin the new version in `package.json`.

**Q: How do I add a new reason code?**

A: Edit `config/reason-codes.json`. Add the new entry, bump
the `version` field, restart the app. The EAA CLI hot-reloads
the schema. See
[`CONFIGURATION.md#configreason-codesjson--the-event-taxonomy`](./CONFIGURATION.md#configreason-codesjson--the-event-taxonomy)
for the full schema.

**Q: Can I write an agent in a language other than English / Chinese?**

A: The `SOUL.md` and `AGENTS.md` files are Markdown and can be
in any language. The LLM is multilingual, so the agent's
output will be in whatever language the prompt is in. The UI
strings (in `src/renderer/i18n/`) currently ship in zh-CN and
en-US; we'd love contributions for other languages.

## License and legal

**Q: What license is this under?**

A: MIT. See [`LICENSE`](../LICENSE). You are free to use it
in commercial products, in schools, in research, and to fork
it.

**Q: Can I sell a product based on this?**

A: Yes. The MIT license allows commercial use. We ask that you
give attribution in your product's credits and that you don't
use the project's name (or the maintainer team's name) to
endorse your product without permission.

**Q: Is there a warranty?**

A: No. The MIT license includes the standard "AS IS" disclaimer.
The maintainer team is a small group of volunteers; use at your
own risk. For a paid support contract, see
[`DISTRIBUTION.md#support`](./DISTRIBUTION.md#support).

**Q: Is the data I store in the app GDPR / PIPL compliant?**

A: The app **helps** with compliance (the privacy engine is
designed for it), but the maintainer team is not a legal
authority. For a definitive answer, consult a lawyer
specializing in your jurisdiction's privacy law. The
[`SECURITY.md`](../SECURITY.md) has more on the threat model
and the design choices.

---

*Don't see your question here? Open a
[GitHub Discussion](https://github.com/232252/education-advisor/discussions).*
