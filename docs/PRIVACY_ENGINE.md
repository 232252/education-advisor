# Privacy engine

> **The privacy engine is the project's most distinctive feature.**
> This document is the deep-dive: what it does, how it works, what it
> doesn't do, and how to use it correctly.

## Table of contents

- [What is the privacy engine?](#what-is-the-privacy-engine)
- [Why it matters](#why-it-matters)
- [The architecture](#the-architecture)
- [The mapping table](#the-mapping-table)
- [The crypto](#the-crypto)
- [The IPC operations](#the-ipc-operations)
- [Per-recipient filtering](#per-recipient-filtering)
- [The audit log](#the-audit-log)
- [Threat model](#threat-model)
- [Best practices](#best-practices)
- [Limitations](#limitations)
- [Future work](#future-work)

---

## What is the privacy engine?

The privacy engine is a **per-install, encrypted, auditable** layer
that sits between the LLM and the user data. It does two things:

1. **Anonymize** — replace real identifiers (names, IDs, phone
   numbers, addresses) with pseudonyms (`S_017`, `ID_a3f7`,
   `1XX-XXXX-1234`) before any payload goes to the LLM.
2. **Deanonymize** — restore the real identifiers when the payload
   is destined for a human reader (the teacher, a parent, an
   export).

The anonymization is **conservative** — when in doubt, the engine
does not anonymize. False negatives (a name that slips through) are
recoverable; false positives (a non-name that gets replaced)
corrupt the output.

---

## Why it matters

A class teacher's student list is **sensitive PII** by any
reasonable definition:

- Real names (Chinese and English)
- National ID numbers
- Phone numbers
- Home addresses
- Parent contact info
- Academic performance
- Behavioral records
- Mental health flags

Sending this list to a hosted LLM is, at best, a contractual
question ("is the LLM provider allowed to train on this?") and at
worst a regulatory one ("is this compliant with PIPL / GDPR /
class-action territory?").

The privacy engine makes this question **moot** for the default
flow: the LLM never sees the real data. The teacher gets the
benefit of an LLM-powered workflow without the data-leakage
exposure.

---

## The architecture

```
┌────────────────────────────────────────────────────┐
│                   Renderer                         │
│  (e.g. "Generate a parent message for Alice's mom")│
└───────────────────────┬────────────────────────────┘
                        │ window.api.privacy.anonymize(text)
┌───────────────────────▼────────────────────────────┐
│                  Main process                      │
│  ┌─────────────────┐    ┌──────────────────────┐  │
│  │ anonymize()     │───▶│  privacy engine      │  │
│  │ deanonymize()   │    │  (AES-256-GCM + Argon2)│ │
│  │ filter()        │    └──────────┬───────────┘  │
│  └─────────────────┘               │              │
│                                    ▼              │
│                          ┌──────────────────────┐│
│                          │ privacy/mapping.bin  ││
│                          │ (encrypted at rest)   ││
│                          └──────────────────────┘│
│                                    │              │
│                                    ▼              │
│                          ┌──────────────────────┐│
│                          │ privacy/audit.log    ││
│                          │ (append-only)        ││
│                          └──────────────────────┘│
└───────────────────────┬────────────────────────────┘
                        │ anonymized text
┌───────────────────────▼────────────────────────────┐
│                       LLM                          │
│  (sees pseudonyms, not real names)                 │
└────────────────────────────────────────────────────┘
```

The privacy engine is a **sub-service of the main process**, not
a separate process. It's small enough to live in the same
process without performance issues.

---

## The mapping table

The mapping table is the heart of the privacy engine. It maps
real identifiers to pseudonyms.

### What's in the table

| Entity type | Real | Anonymized |
| --- | --- | --- |
| Person name | 张三 | `S_017` |
| Person name | Alice | `S_018` |
| Person name | 张老师 | `T_004` |
| Student ID | 20240301 | `ID_a3f7` |
| Phone | 138-1234-5678 | `1XX-XXXX-5678` |
| ID card | 110101200501012345 | `110101********2345` |
| Home address | 北京市海淀区中关村南大街5号 | `北京市海淀区` |
| Email | alice@school.cn | `S_018@school.cn` |

### How it's built

The table is built incrementally. When the privacy engine
encounters a new name, it:

1. Checks if the name is already in the table.
2. If not, generates a new pseudonym (e.g. `S_017`).
3. Adds the mapping to the table.
4. Encrypts the table to disk.

The table is **per-install**, not per-class. If the teacher
switches classes, the names from the old class remain in the
table (they're harmless and make future anonymization faster).

### How it's stored

The table is stored as a single binary file
(`userData/eaa-data/privacy/mapping.bin`) encrypted with
**AES-256-GCM** under a key derived from the teacher's master
password via **Argon2id**.

The key never leaves memory. The encrypted file never contains
plaintext.

### The salt

A random 16-byte salt is generated on first run and stored at
`userData/eaa-data/privacy/salt.bin`. The salt is **not** secret;
its purpose is to make precomputed rainbow tables infeasible.

---

## The crypto

The privacy engine uses:

| Algorithm | Purpose | Why |
| --- | --- | --- |
| **AES-256-GCM** | Encryption of the mapping table | AEAD: confidentiality + integrity in one primitive. 256-bit key. |
| **Argon2id** | Master password → key derivation | Memory-hard, GPU-resistant. Tuned to ~250 ms on a modern CPU. |
| **SHA-256** | Salt + key fingerprint | Standard, well-audited. |
| **OS RNG** | Random salt, random IV | Relies on `crypto.getRandomValues` (browser) or `crypto.randomBytes` (Node). |

The crypto is provided by the platform:

- **Renderer**: `window.crypto.subtle` (WebCrypto API)
- **Main process**: Node's `crypto` module
- **OS keystore** (for API keys): Electron's `safeStorage` (DPAPI
  on Windows, Keychain on macOS, libsecret on Linux)

**No custom crypto.** The engine delegates everything to the
platform. See [`SECURITY.md`](../SECURITY.md#cryptography) for the
rationale.

---

## The IPC operations

The privacy engine exposes 11 IPC operations in
`src/shared/ipc-channels.ts`:

| IPC channel | Method | Description |
| --- | --- | --- |
| `privacy:init` | `init(password, autoScan?)` | Initialize the engine with a master password. Optionally scan the existing data and auto-populate the mapping. |
| `privacy:load` | `load(password)` | Load the existing mapping table from disk. Required on each app start. |
| `privacy:enable` | `enable()` | Turn the engine on. |
| `privacy:disable` | `disable(password)` | Turn the engine off. Requires the master password. |
| `privacy:list` | `list(password)` | List all mappings (for review / export). Requires the master password. |
| `privacy:add` | `add(entityType, text)` | Add a single mapping. |
| `privacy:anonymize` | `anonymize(text)` | Anonymize a text. |
| `privacy:deanonymize` | `deanonymize(text)` | Restore the real identifiers. |
| `privacy:filter` | `filter(receiver, text)` | Per-recipient filter. |
| `privacy:dryrun` | `dryrun(text)` | Preview what `anonymize` would do, without changing the table. |
| `privacy:backup` | `backup(destPath)` | Write the (encrypted) mapping table to a destination path. |

### Typical lifecycle

1. **First run**: `init(password, autoScan=true)`. The teacher
   picks a master password, the engine scans the existing data,
   and the mapping table is built.
2. **Each launch**: `load(password)`. The teacher enters the
   master password, the engine decrypts the table.
3. **Each LLM call**: `anonymize(text)` is called automatically
   by the agent service. The LLM sees the anonymized text.
4. **Each LLM response**: `deanonymize(text, recipient)` is
   called by the agent service. The teacher sees the real names
   in the final report.

The teacher can **disable** the engine at any time (via
Settings → Privacy → Disable). When disabled, the LLM sees the
real data. The setting is persisted in `userData/settings.json`.

---

## Per-recipient filtering

The `filter(receiver, text)` operation is the **key insight** of
the privacy engine. It takes a recipient type as the first
argument and applies different anonymization rules accordingly.

### The five recipient types

| Recipient | Anonymization |
| --- | --- |
| `llm:<provider>` (e.g. `llm:openai`, `llm:qwen`) | **Aggressive** — anonymize all PII. |
| `parent:<name>` (e.g. `parent:Alice's mother`) | **Light** — anonymize OTHER students' names; keep the target student's name; anonymize phone numbers and addresses. |
| `export:csv` / `export:xlsx` | **Medium** — anonymize IDs and phone numbers; keep names. |
| `teacher:self` | **None** — passthrough. |
| `agent:<agent-id>` (e.g. `agent:psychology`) | **Strict** — anonymize all PII, plus replace specific reason codes with generic ones. |

### How the teacher uses it

The teacher doesn't directly call `filter()`. Instead, the agent
service calls it on the teacher's behalf, picking the right
recipient type based on:

- Which agent is producing the output.
- What the output is destined for (a Feishu message, a CSV
  export, a report, etc.).

For example, when `home_school` generates a parent message, the
agent service calls `filter('parent:Alice's mother', text)` so
that:

- Alice's name is preserved (the parent needs to know who the
  message is about).
- Other students' names are pseudonymized.
- Phone numbers and addresses are anonymized.
- Reason codes are preserved (the parent needs to know what
  happened).

### Why this matters

A single agent prompt can produce **multiple outputs**, each
destined for a different audience. The privacy engine is the
place where the audience is decided, and the anonymization is
applied **once per audience**, not per call.

This is a much stronger model than the typical "anonymize
everything" approach, which is over-broad and produces useless
output (e.g. parent messages with no student name).

---

## The audit log

Every `anonymize` and `deanonymize` call is logged to
`userData/eaa-data/privacy/audit.log`:

```
[2026-06-09 08:14:23.117] anonymize caller=class-monitor recipient=llm:openai input_len=412 output_len=387 entities_replaced=3
[2026-06-09 08:14:23.204] deanonymize caller=class-monitor recipient=teacher:self input_len=298 output_len=304 entities_replaced=2
[2026-06-09 08:14:23.412] anonymize caller=risk-alert recipient=llm:qwen input_len=1842 output_len=1623 entities_replaced=12
```

The log is **append-only** and is the authoritative answer to
the question "what did the LLM see?".

### What the log records

| Field | Description |
| --- | --- |
| `timestamp` | The exact time the call was made. |
| `caller` | The agent ID (e.g. `class-monitor`) or `manual` if the teacher triggered it. |
| `recipient` | The recipient type (e.g. `llm:openai`, `parent:Alice's mother`). |
| `input_len` | The length of the input text in characters. |
| `output_len` | The length of the output text in characters. |
| `entities_replaced` | The number of PII entities that were replaced. |
| `caller_chain` | (optional) The call stack if the call was made from a nested context. |

### What the log does **not** record

- The actual text content. (This would defeat the purpose.)
- The API key or any other credential.
- The IP address or any other network identifier.

### How to view the log

- The Privacy page in the app has a "View audit log" button that
  opens the log in the Logs viewer.
- The log is also accessible as a plain text file at
  `userData/eaa-data/privacy/audit.log`.

### How to export the log

- The Privacy page has an "Export audit log" button.
- The log is exported as a CSV with the columns above.

---

## Threat model

The privacy engine is designed to defend against:

1. **LLM provider reading the data.** Even if the LLM provider
   is malicious or compromised, the data is anonymized before
   the call.
2. **Network eavesdropping.** All LLM calls are over HTTPS; the
   data is also anonymized.
3. **Local file system access by another process.** The mapping
   table is encrypted at rest; the audit log is the only
   plaintext, and it doesn't contain the data.
4. **Prompt injection.** The anonymization is applied at the
   tool layer, before the LLM sees the text. The LLM cannot
   "trick" the privacy engine into deanonymizing (the engine
   doesn't have a "no anonymize" mode that the LLM can request).
5. **Compromised agent prompt.** Even if an agent's `SOUL.md`
   is modified to leak data, the tool layer enforces the
   anonymization.

The privacy engine does **not** defend against:

1. **Compromise of the teacher's machine.** Once an attacker
   has full access, no application-level control helps.
2. **Compromise of the master password.** The mapping table is
   only as strong as the password.
3. **Side-channel attacks on the LLM.** Some research has shown
   that LLMs can be probed to reveal their input. The privacy
   engine is not designed to defend against this; the
   `dryrun` operation is a partial mitigation.
4. **Inference from anonymized data.** A clever attacker might
   be able to infer real names from the anonymized text (e.g.
   "the only student with conduct score 78"). The privacy
   engine is not designed to defend against this; the
   `filter(recipient, text)` operation is a partial mitigation.

---

## Best practices

### For the teacher

1. **Pick a strong master password.** At least 12 characters,
   mixing letters, numbers, and symbols. Don't reuse passwords
   from other services.
2. **Back up the mapping table.** Use the "Backup" button in
   the Privacy page. Store the backup in a secure location
   (encrypted USB stick, password manager, etc.).
3. **Review the audit log regularly.** The Privacy page has a
   "View audit log" button. Look for unexpected entries.
4. **Don't disable the engine unless you have to.** The default
   is anonymized; the LLM doesn't need the real names.

### For the agent author

1. **Never include real student names in `SOUL.md` or
   `AGENTS.md`.** Use `S_017` placeholders.
2. **Never hard-code a recipient type.** Let the agent service
   pick the recipient based on the output's destination.
3. **Always use the `filter(recipient, text)` API for
   per-recipient anonymization.** Don't call `anonymize` and
   `deanonymize` manually.
4. **Document any data flow that doesn't go through the
   privacy engine.** If your agent reads data and writes it
   somewhere other than the LLM, the privacy engine may not
   catch it.

### For the maintainer

1. **Never add a code path that bypasses the privacy engine.**
   Every text payload that goes to the LLM **must** go through
   `anonymize` first.
2. **Add tests for every new anonymization pattern.** The
   `tests/main/privacy.test.ts` file has a structure you can
   copy.
3. **Update the audit log format in a backward-compatible way.**
   Existing log readers should still work.
4. **Document any new entity type.** Add it to
   `docs/CONFIGURATION.md#privacy` and the `filter()` recipient
   table.

---

## Limitations

The privacy engine has some known limitations:

1. **Chinese name disambiguation.** Chinese names are often
   short (2–3 characters) and ambiguous. The engine uses a
   combination of regex and a small dictionary; a long name
   that contains a common character might be misidentified.
2. **English name disambiguation.** The engine uses a
   capitalization-based heuristic. A name in lowercase ("alice")
   might be missed.
3. **Code-switching.** A name that's partly in Chinese and
   partly in English (e.g. "Alice 王") might be partially
   anonymized.
4. **Address parsing.** The engine uses regex to match Chinese
   address formats. A non-standard format might be missed.
5. **Phone number formats.** The engine handles Chinese mobile
   and landline formats. International formats are not
   supported.

For all of these, the **conservative default is to not
anonymize**, which is the safer failure mode.

---

## Future work

The roadmap for the privacy engine includes:

- **Better Chinese name disambiguation** — using a small LLM
  on-device to detect names in context.
- **Better address parsing** — using a structured address
  database.
- **Differential privacy for aggregates** — adding noise to
  cross-class analytics so individual contributions are not
  recoverable.
- **Compliance report generator** — a quarterly report
  summarizing the anonymize / deanonymize activity, suitable
  for school administrators.
- **End-to-end encryption between desktop and EAA CLI** —
  wrapping the IPC channel in an AEAD channel.

See [`ROADMAP.md`](../ROADMAP.md#pillar-6-privacy-compliance-audit)
for the full plan.

---

## Next steps

- [`EAA_BRIDGE.md`](./EAA_BRIDGE.md) — the data engine
  architecture.
- [`SECURITY.md`](../SECURITY.md) — the full security policy.
- [`CONFIGURATION.md#privacy`](./CONFIGURATION.md#privacy) — the
  privacy settings.
