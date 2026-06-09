# Roadmap

> **A 12–24 month plan for Education Advisor.**
> This is a living document. The maintainers revisit it quarterly and
> update it as priorities shift. The most recent update was **June 2026**.

## How to read this

- **Quarters** refer to calendar quarters, not release cycles. We aim for
  monthly minor releases and quarterly major milestones.
- **Pillars** are the strategic themes. The roadmap is organized by pillar,
  not by date, so you can see why each piece matters.
- **Items** are the concrete deliverables. Each has a one-line summary, a
  brief description, and a status (`🎯 planned` / `🛠 in progress` / `✅ shipped`).

---

## Pillar 1: Multi-class support

The most-requested feature by far. Today, Education Advisor models one
**class** (a teacher's homeroom). The data model, the agent prompts, and
the UI all assume a single class. To support a grade-level head teacher
or a school admin, we need multi-class.

### 🎯 Multi-class data model

- `eaa-cli` learns about a top-level `class_id` namespace
- The event log gains a `class_id` column
- The privacy engine learns to anonymize per-class
- The renderer adds a class switcher in the header

**Why it matters**: opens the door to grade-level and school-level
adoption. The hardest part is the data migration (existing event logs
have to be backfilled with a default `class_id`).

### 🎯 Cross-class analytics

- A new `cross-class` page in the dashboard
- Comparative conduct-score distribution
- Top movers / decliners across all classes
- "X students in this class are above the grade average on this metric"

**Why it matters**: the data is there, we just need the aggregation
view.

### 🎯 Per-class agent overrides

- A teacher can have a different prompt for `class-monitor` for Class A
  vs Class B
- Schedule overrides per class (Class A's "weekly report" is Friday
  afternoon, Class B's is Saturday morning)

**Why it matters**: not all classes are alike. The system needs to adapt.

---

## Pillar 2: Mobile + multi-device

Teachers don't sit at their desk all day. They proctor morning reading,
they eat lunch in the staff room, they walk the dorm at 10 PM. The
desktop app is great for the office. The phone is for everything else.

### 🎯 Mobile companion (read-only, v0)

- A React Native shell that talks to the same IPC contract
- Read-only views: dashboard, today's events, current risk alerts
- Push notifications for `risk-alert` and `governor` digests
- "Approve on phone" for actions queued by the desktop (e.g. add a
  conduct point the desktop marked as "needs teacher approval")

**Why it matters**: a teacher is rarely at their desk. The mobile
companion turns the app from a "tool you remember to use" into a
"tool that's already in your pocket".

### 🎯 Tablet view (responsive renderer)

- The existing renderer already has the building blocks (Tailwind,
  CSS variables). The 9 pages need a tablet-first layout pass.
- Bottom nav on small screens, side nav on large.
- Touch-friendly controls for the Charts (ECharts has a touch mode).

**Why it matters**: cheap to do, big UX win.

---

## Pillar 3: Plugin marketplace

The 18 agents shipped today are a starting point. Real schools have
unique workflows: a chemistry teacher's "lab safety check" is
different from a physics teacher's; a班主任 in Beijing has different
parent-communication patterns from one in Shanghai. We can't ship
all of these. The community can.

### 🎯 Plugin manifest format

- A `plugin.yaml` schema (modeled on `agents.yaml`) that declares:
  id, version, agents, skills, reason-codes, settings.
- A `plugin install <id>` CLI command.
- A `~/.education-advisor/plugins/` directory for user-installed plugins.

### 🎯 Verified plugin registry

- Plugins are signed with a maintainer-controlled key.
- The marketplace UI shows: name, author, version, signed-by, last-update.
- Plugins can be "official" (signed by the maintainer team) or
  "community" (signed by a trusted third party).

### 🎯 Plugin sandboxing

- Plugins run with the same least-privilege model as the built-in agents.
- A plugin can declare which capabilities it needs; the user is prompted
  to approve them at install time.
- Plugin code is in a separate `vm.Context` (main process) or
  `Worker` (renderer) — no direct access to the main IPC.

**Why it matters**: turns a closed product into an ecosystem. This is
the biggest leverage point in the long-term plan.

---

## Pillar 4: Cross-platform parity

Today: Windows x64 is the only fully-tested target. macOS and Linux are
configured but untested in CI. ARM64 (Windows on ARM, Apple Silicon,
Linux ARM) is also configured but unbuilt.

### 🎯 macOS release tier

- Signed `.dmg` and `.zip` (universal: x64 + arm64)
- `dmg-license` for the EULA
- Notarization for Gatekeeper
- Auto-update via Sparkle-equivalent (we use `electron-updater`)

### 🎯 Linux release tier

- `.deb` and `.rpm` packages
- `AppImage` for portable use
- `pacman` AUR package (community-maintained)

### 🎯 Windows ARM64

- Build, test, and sign the ARM64 installer
- Maintain parity with the x64 build (no platform-specific code paths)

**Why it matters**: the project is used in 4 schools today, all on
Windows. The next 4 schools will be on macOS. After that, the Linux
deployments will come. The "Windows-only" label is becoming a
liability.

### 🎯 Tauri parity build (v2.0 of the desktop client)

- Re-implement the renderer in Tauri 2.0
- Reduce the installer size from 85 MB to ~15 MB
- Keep the Rust CLI as the data engine (no changes there)

**Why it matters**: the install size and the cold-start time are the
two biggest user-experience complaints. Tauri fixes both.

---

## Pillar 5: Voice + on-device intelligence

The future of in-class data capture is **ambient** — push-to-talk or
even always-on transcription, with on-device intent detection. The
teacher speaks, the system records a conduct point.

### 🎯 Voice channel (push-to-talk)

- A push-to-talk key in the renderer
- Audio captured via WebRTC, transcribed via Whisper.cpp (on-device)
- The transcript is passed to the LLM for intent classification
- The teacher confirms with a click

**Why it matters**: the bottleneck for adoption isn't the LLM, it's
the data entry. Voice is the natural input mode for a teacher
walking the classroom.

### 🎯 Always-on capture (v2, opt-in, transparent)

- Always-on microphone with a clear visual indicator
- Strict on-device processing (no audio leaves the machine)
- The teacher can pause/resume at any time
- Daily recap: "Today you recorded 14 conduct events. Confirm?"

**Why it matters**: this is the long-term vision. It also raises
significant privacy concerns, which is why it's v2 and why it's
strictly opt-in.

### 🎯 On-device LLM

- Bundle a small (4–7B) quantized model for offline use
- The model is "good enough" for `class-monitor` (the most common agent)
- The teacher can override with a hosted model at any time

**Why it matters**: zero-network operation. The app is then usable on
a plane, on a train, in a basement classroom with no Wi-Fi.

---

## Pillar 6: Privacy, compliance, audit

The privacy engine is already a strong primitive. The next layer is
**compliance reporting** — helping the school (or the teacher) prove
that the system is doing what it says.

### 🎯 Compliance report generator

- A quarterly report that summarizes: how many anonymize calls, how
  many deanonymize calls, what recipients, what was in the audit log.
- Exportable as PDF, with a SHA-256 manifest for tamper-evidence.

### 🎯 End-to-end encryption between desktop and EAA CLI

- The IPC channel between the main process and the EAA child process
  is currently a local pipe. We can wrap it in an AEAD channel so
  that a compromised child process can't read sibling data.

### 🎯 Differential privacy for aggregate reports

- The cross-class analytics can leak individual students' data if
  the class is small. Add differential privacy noise to the aggregates
  so individual contributions are not recoverable.

**Why it matters**: the privacy story is the project's biggest
differentiator. We have to keep pushing on it.

---

## Pillar 7: Educational outcomes

The deepest, hardest, most important question:

> **Does this tool actually improve the teacher's day, and through
> them, the students' outcomes?**

We don't have a great answer yet. The next 12 months are about
collecting evidence.

### 🎯 Opt-in usage telemetry

- Aggregate, anonymized metrics on agent usage, success rates, and
  user overrides (when the teacher changes what the agent proposed).
- The teacher can disable telemetry at any time.
- The data is published in aggregate on a public dashboard.

### 🎯 Case studies

- Documented case studies of 2–3 schools using the system in production.
- Surveys at the start of the school year and at the end.
- Qualitative interviews with the teachers.

### 🎯 Open data (de-identified)

- Publish a de-identified event log from a partner school (under
  IRB-equivalent oversight) so that researchers can study the
  patterns of conduct management in Chinese high schools.

**Why it matters**: without evidence, this is just another tool.
With evidence, it can be a reference for the whole field.

---

## Quarterly milestones

### Q3 2026 (Jul–Sep) — Multi-class foundation

- Multi-class data model (Pillar 1)
- Mobile companion v0 (Pillar 2)
- Tablet view pass (Pillar 2)
- macOS release tier (Pillar 4)

### Q4 2026 (Oct–Dec) — Cross-platform & plugins

- Linux release tier (Pillar 4)
- Windows ARM64 (Pillar 4)
- Plugin manifest format (Pillar 3)
- Voice channel v0 (Pillar 5)

### Q1 2027 (Jan–Mar) — Plugin ecosystem

- Verified plugin registry (Pillar 3)
- Plugin sandboxing (Pillar 3)
- Compliance report generator (Pillar 6)
- Opt-in telemetry (Pillar 7)

### Q2 2027 (Apr–Jun) — Voice & on-device

- Always-on capture v2 (Pillar 5)
- On-device LLM (Pillar 5)
- Tauri parity build v0 (Pillar 4)
- End-to-end encryption for EAA channel (Pillar 6)

### Q3 2027 (Jul–Sep) — Outcomes

- Differential privacy for aggregates (Pillar 6)
- Case studies (Pillar 7)
- Open data release (Pillar 7)

### Q4 2027 (Oct–Dec) — v1.0

- Tauri parity build v1 (Pillar 4)
- Plugin marketplace GA (Pillar 3)
- **v1.0.0 release** — first "we recommend this for production use" tag

---

## What we are **not** doing

Saying no is as important as saying yes. We are not, in the next
24 months:

- Building a **chatbot-only** product. The agent loop is the product.
- Building a **multi-tenant SaaS**. The project is local-first.
- Building a **mobile-first** product. The desktop is the cockpit.
- Building a **LMS integration** (Moodle, Canvas). The export to Feishu
  Bitable is the integration; we don't compete with the LMS.
- Building a **parent-side** product. The roadmap includes a read-only
  parent view, but not a parent-side write surface.
- Building a **video / image** analysis pipeline. The voice channel is
  the edge of the data-capture surface; we don't go further.

---

## How to influence the roadmap

- **Open an issue** with the `roadmap` label and your use case.
- **Vote on existing issues** with 👍 / 👎 reactions. The maintainers
  read the reaction counts.
- **Sponsor a feature** — if you have a specific need and you'd like
  to fund the work, email the maintainers (see CODE_OF_CONDUCT.md).
- **Contribute** — the fastest way to ship a feature is to write the PR.

The roadmap is a living document. If you see something missing,
something that should be earlier, or something that should be cut —
let us know.
