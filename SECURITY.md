# Security Policy

> **TL;DR**: If you find a security issue, **do not** open a public GitHub
> issue. Email the maintainers (see the bottom of this file) with a
> description and a reproducer. We respond within 48 hours.

This document covers:

- [Supported versions](#supported-versions)
- [Reporting a vulnerability](#reporting-a-vulnerability)
- [Disclosure timeline](#disclosure-timeline)
- [The threat model](#the-threat-model)
- [Security features in this release](#security-features-in-this-release)
- [Security advisories](#security-advisories)
- [Acknowledgements](#acknowledgements)

---

## Supported versions

| Version | Status | Security patches |
| --- | --- | --- |
| `0.1.x` (current) | ✅ Active development | Yes |
| `0.0.x` | ❌ Pre-release, not for production use | No |
| Companion `education-advisor` v3.x (Rust CLI) | ✅ Maintained in the sister repo | Yes |

We follow [semantic versioning](https://semver.org/) strictly. Security fixes
are released as **patch** versions (e.g. `0.1.4 → 0.1.5`) and are backported
to the most recent minor.

---

## Reporting a vulnerability

### How to report

Email **<security@education-advisor.example>** (PGP key below) with:

- A clear **subject** (e.g. `[SECURITY] Path traversal in eaa-bridge import`).
- A **description** of the vulnerability, including the impact.
- **Steps to reproduce** — minimal, copy-paste-able.
- The **affected version** (commit SHA, release tag, or commit range).
- Your **name / handle** if you'd like to be credited.

### What to expect

- **Within 48 hours** — an acknowledgement from a maintainer.
- **Within 7 days** — a triage decision: accepted, duplicate, declined,
  or needs more info.
- **Within 30 days** — a patch released, or a clear timeline for the patch.

If we can't reproduce the issue, we'll ask for clarification. We're friendly
and we'd rather get a noisy report than a missed vulnerability.

### PGP key

> _PGP key will be added before the first public release. The placeholder
> address above routes to the maintainer team via a shared mailbox._

### What **not** to do

- **Do not** open a public GitHub issue.
- **Do not** post the details on Twitter, Weibo, or any public forum.
- **Do not** exploit the vulnerability beyond what is necessary to
  demonstrate it.

We follow [coordinated disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
and we will credit you in the advisory (unless you'd prefer to remain
anonymous).

---

## Disclosure timeline

| Day | Action |
| --- | --- |
| 0 | Report received. Ack within 48 h. |
| 1–7 | Triage, reproduce, scope. |
| 7–14 | Patch development, internal review. |
| 14–30 | Patch release, advisory publication. |
| 30–45 | Public disclosure (if the patch has shipped). |

If we cannot ship a patch within 30 days (e.g. the fix is non-trivial),
we'll publish a **pre-advisory** with a timeline, and we'll keep you in
the loop.

---

## The threat model

This is a desktop app for class teachers. The threat model is:

### In scope

1. **Student data exfiltration** — an attacker reads the event log or the
   privacy mapping and extracts PII.
2. **Prompt injection** — a malicious student (or a malicious spreadsheet
   imported into the app) tricks an agent into leaking data or doing
   unauthorized writes.
3. **Supply-chain attack** — a compromised npm package or a tampered EAA
   binary executes arbitrary code on the teacher's machine.
4. **Local privilege escalation** — an attacker on the same machine
   reads the app's data directory while the app is running.
5. **Data integrity** — an attacker modifies the event log to alter
   historical conduct records.
6. **Phishing via LLM** — the LLM is fooled into recommending that the
   teacher click a malicious link or run a malicious command.

### Out of scope

1. **Compromise of the teacher's machine** — once an attacker has full
   access to the host, no application-level control can save you. We
   expect the host to be reasonably up-to-date.
2. **Compromise of the LLM provider** — if the LLM provider is malicious
   or compromised, we mitigate by minimizing what data the LLM sees,
   but we cannot prevent the provider from training on the data.
3. **Network-level attacks** (MITM, DNS poisoning) — we use TLS for all
   network calls, but the trust root is the host's certificate store.

### Mitigations already in place

| Threat | Mitigation |
| --- | --- |
| Student data exfiltration | PII is AES-256-GCM-encrypted at rest, anonymized before any LLM call, audit log of every deanonymize. |
| Prompt injection | Agents are constrained to a fixed tool set; tool parameters are sanitized; tool outputs are parsed and validated before being used. |
| Supply-chain attack | `npm ci` produces deterministic installs; the EAA binary is a tagged release with SHA-256 manifest; `package-lock.json` is committed. |
| Local privilege escalation | API keys are encrypted in the keystore (Electron's `safeStorage`); the privacy master password is Argon2-derived; sensitive files are written with `0600` (where supported). |
| Data integrity | The event log is append-only with optional hash chaining; revert events are themselves events; the EAA CLI file-locks the log during writes. |
| Phishing via LLM | The renderer uses `setWindowOpenHandler` to open external URLs in the system browser, not in-app; the LLM is never allowed to spawn a process or fetch a URL. |

---

## Security features in this release

### Renderer hardening

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: false` (we use `preload` for the bridge, which is a known trade-off)
- `webContents.on('will-navigate')` blocks in-app navigation
- `setWindowOpenHandler` routes all `window.open` calls to the system browser
- `app.commandLine.appendSwitch('remote-allow-origins', 'http://localhost:9222')` when CDP is enabled
  (CDP itself is gated by `ENABLE_CDP=1`)

### Main process hardening

- All IPC handlers validate their inputs (TypeBox schemas for the complex ones)
- All EAA tool parameters are sanitized in `eaa-tools.ts` (blocks shell metacharacters, path traversal, …)
- All file writes go through a `path.resolve(workingDir, userPath)` and a `..`-rejection check
- All SQLite statements are parameterized
- All logging is rate-limited and redacted (API keys, PII)
- The `eaa-bridge` subprocess is killed on timeout and on app exit

### Network hardening

- All LLM calls go over HTTPS (no HTTP fallback)
- TLS certificate verification is on by default
- Proxy support via `models.customModels[].baseUrl` and `models.transport`
- No outbound network calls except: LLM, auto-update, Feishu (opt-in)

### Data at rest

- `userData/` is created with platform-default permissions
- The privacy mapping table is AES-256-GCM-encrypted with a per-install random key
  wrapped by an Argon2-derived key from the master password
- API keys are encrypted with Electron's `safeStorage` (OS-level keychain on
  macOS, Credential Vault on Windows, libsecret on Linux)
- The SQLite database file is not encrypted at the file level (rely on disk
  encryption for at-rest protection; the privacy engine encrypts the
  sensitive *fields*)

### Data in motion

- The LLM payload is anonymized by default
- LLM calls use HTTPS
- The privacy engine has a `filter(recipient, text)` API for per-recipient
  redaction (e.g. anonymize OTHER students but allow the target student's
  name in a parent message)

### Operational

- `ENABLE_CDP=1` is the only way to enable remote debugging
- Auto-update is opt-in (`general.autoUpdate` in settings, default `false`)
- Update channel is the GitHub Releases API; channel can be pinned to a
  specific tag for reproducible deployments
- App logs are rotated and capped; the Logs page lets the user **export**
  logs (for support) or **clear** them (for privacy)

---

## Security advisories

Published advisories are at
[GitHub Security Advisories](https://github.com/232252/education-advisor/security/advisories).
None at the time of `v0.1.0`.

---

## Cryptography

This project uses:

- **AES-256-GCM** for at-rest encryption of the privacy mapping table
- **Argon2id** for the master password derivation
- **Electron `safeStorage`** for API key encryption at rest
- **TLS 1.2+** for all network calls
- **SHA-256** for binary integrity verification of the EAA CLI

The default crypto providers are:

- macOS: CommonCrypto (system)
- Windows: BCrypt (system)
- Linux: OpenSSL (system)

No custom crypto is implemented in this repository. **Do not** add custom
crypto. If you need a primitive that the system libraries don't provide,
open an issue and we'll discuss.

---

## Audit history

This is the first open-source release; no third-party audit has been
performed yet. We plan to commission one before v1.0.0.

In the meantime, the codebase is reviewed by:

- The maintainer team on every PR
- GitHub's Dependabot for dependency CVEs
- GitHub's CodeQL for static analysis (see `.github/workflows/codeql.yml`)

---

## Acknowledgements

Thanks to:

- Every teacher who has trusted us with their data, and who has
  reported a bug or asked a hard question
- The maintainers of the libraries we depend on, for keeping their
  dependencies up to date and their CVEs visible
- The researchers who publish their findings openly, so we can fix
  things before they become problems

If you report a vulnerability, we'll credit you in the advisory
(unless you'd prefer to stay anonymous). Thank you.
