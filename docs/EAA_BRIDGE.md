# EAA Bridge

> **The bridge between the Electron main process and the Rust `eaa-cli`
> binary.** This document covers the protocol, the IPC operations, the
> error handling, and how to debug a misbehaving bridge.

## Table of contents

- [What is the EAA bridge?](#what-is-the-eaa-bridge)
- [Why a separate process?](#why-a-separate-process)
- [The protocol](#the-protocol)
- [The IPC operations](#the-ipc-operations)
- [The tool layer](#the-tool-layer)
- [Error handling](#error-handling)
- [Debugging](#debugging)
- [Building from source](#building-from-source)
- [Manual install](#manual-install)
- [Performance](#performance)
- [Security](#security)

---

## What is the EAA bridge?

The EAA bridge is the TypeScript code in
`src/main/services/eaa-bridge.ts` that talks to the Rust `eaa-cli`
binary. The bridge:

1. **Locates the binary** (per platform, in a known directory).
2. **Spawns the binary** as a child process.
3. **Writes JSON to stdin** and **reads JSON from stdout**.
4. **Validates the response** against a TypeBox schema.
5. **Returns the result** to the caller, or throws a typed error.

The bridge is the **only code in the main process that talks to
student data**. Every other service in the main process goes through
the bridge.

```
┌──────────────────────────┐
│  eaa-bridge.ts (Node)    │
└──────────┬───────────────┘
           │ spawn
           ▼
┌──────────────────────────┐
│  eaa.exe (Rust)          │  ← process per call (default)
│                          │     OR long-lived (for streaming)
└──────────┬───────────────┘
           │ read / write
           ▼
┌──────────────────────────┐
│  events.log (JSON-Lines) │
│  entities/               │
│  privacy/                │
└──────────────────────────┘
```

---

## Why a separate process?

A few reasons:

1. **Reproducible builds.** A pre-built binary is a specific tagged
   artifact, verifiable with SHA-256. An embedded Rust library would
   be re-compiled per machine.
2. **Separation of concerns.** The Rust side is the data engine; the
   TypeScript side is the agent orchestrator. Keeping them separate
   means each can be reviewed, audited, and re-used independently.
3. **Performance isolation.** A long-running Rust operation can't
   block the main process because it's in a separate process.
4. **Memory isolation.** A memory leak in the Rust code doesn't take
   down the main process.
5. **Versioning.** The Rust binary has a version that can be checked
   at startup. Mismatches are detected early.

---

## The protocol

The protocol is **JSON over stdin/stdout**, one request per line,
one response per line.

### Request

```json
{
  "id": "req_a3f7c2",
  "method": "add_event",
  "params": {
    "student": "Alice",
    "code": "BONUS_VARIABLE",
    "delta": 2,
    "reason": "homework on time"
  }
}
```

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | A unique request ID. Used to match responses. |
| `method` | string | The EAA subcommand (snake_case). |
| `params` | object | The parameters. Method-specific. |

### Response (success)

```json
{
  "id": "req_a3f7c2",
  "ok": true,
  "result": {
    "event_id": "evt_b8e9d1",
    "ts": "2026-06-09T08:14:23.117+08:00"
  }
}
```

### Response (error)

```json
{
  "id": "req_a3f7c2",
  "ok": false,
  "error": {
    "code": "INVALID_REASON_CODE",
    "message": "The reason code 'BONUZ' is not in the schema. Did you mean 'BONUS_VARIABLE'?",
    "field": "code"
  }
}
```

The error `code` is a stable enum. The bridge translates it to a
typed `EAAError` with a `.code` property. The renderer displays the
error message verbatim, prefixed with a localized error title.

### Streaming

Some operations (e.g. `dashboard` for very large classes) can be
streaming. The protocol extension is:

```json
{"id":"req_xxx","type":"chunk","data":{...}}
{"id":"req_xxx","type":"chunk","data":{...}}
{"id":"req_xxx","type":"done","result":{...}}
```

The bridge implements this with a long-lived child process per
streaming operation.

---

## The IPC operations

The bridge exposes 21 IPC operations. They map 1-to-1 to the EAA
subcommands:

| IPC channel | EAA subcommand | Type | Description |
| --- | --- | --- | --- |
| `eaa:info` | `info` | read | System info: EAA version, data dir, schema version. |
| `eaa:score` | `score` | read | A student's current conduct score. |
| `eaa:ranking` | `ranking` | read | The class ranking (top N or all). |
| `eaa:replay` | `replay` | read | Replay all events to recompute scores. |
| `eaa:add-event` | `add_event` | write | Append a new event to the log. |
| `eaa:revert-event` | `revert_event` | write | Append a `REVERT` event. |
| `eaa:history` | `history` | read | A student's event history. |
| `eaa:search` | `search` | read | Full-text search over events. |
| `eaa:range` | `range` | read | Events in a date range. |
| `eaa:tag` | `tag` | read | Events with a specific tag. |
| `eaa:stats` | `stats` | read | Aggregate statistics. |
| `eaa:validate` | `validate` | read | Validate the event log for consistency. |
| `eaa:export` | `export` | write | Export to CSV / Excel / JSON. |
| `eaa:list-students` | `list_students` | read | List all students. |
| `eaa:add-student` | `add_student` | write | Add a new student. |
| `eaa:delete-student` | `delete_student` | write | Soft-delete a student. |
| `eaa:set-student-meta` | `set_student_meta` | write | Update a student's metadata. |
| `eaa:import` | `import` | write | Import from a file. |
| `eaa:codes` | `codes` | read | List valid reason codes. |
| `eaa:doctor` | `doctor` | read | Health check. |
| `eaa:summary` | `summary` | read | Generate a summary for a date range. |
| `eaa:dashboard` | `dashboard` | write | Generate an HTML dashboard report. |

The full schema for each operation is in
`src/shared/types/index.ts` (539 lines) and mirrored in the EAA CLI
documentation.

---

## The tool layer

The agents don't call the bridge directly. They call the **tool
layer** in `src/main/services/eaa-tools.ts`. The tool layer:

1. **Validates** the agent's `capabilities` list against the
   requested operation. If the capability is missing, the tool call
   is rejected before the bridge is invoked.
2. **Sanitizes** the parameters. This is the security-critical
   layer:
   - String fields are checked for shell metacharacters
     (`;`, `|`, `&`, `` ` ``, `$()`, `>`, `<`, `\\n`).
   - Path fields are resolved against the working directory and
     checked for `..` traversal.
   - Numeric fields are bounded to their expected range.
   - Student names are matched against the entity store.
3. **Maps** the agent's "natural" operation names to the bridge's
   method names. E.g. the agent says "addEvent" but the bridge
   expects "add_event".
4. **Calls** the bridge.
5. **Returns** the result to the agent.

The tool layer is the **single point of trust** for what the LLM
can do. The agent's `capabilities` list is a **whitelist**, and the
tool layer enforces it.

---

## Error handling

The bridge distinguishes four kinds of errors:

### 1. Transport errors

The binary failed to spawn, the child process died, the JSON
response is malformed, etc. The bridge logs the error and throws
`EAAError('TRANSPORT_ERROR', message)`. The renderer displays a
generic "could not reach the data engine" message.

### 2. Validation errors

The EAA CLI rejected the request (e.g. unknown reason code, invalid
student name). The bridge throws `EAAError(code, message)` with the
EAA error code. The renderer displays the message verbatim with
localized context.

### 3. Capability errors

The agent's `capabilities` list does not include the operation. The
tool layer throws `EAAError('CAPABILITY_DENIED', ...)` **before** the
bridge is even called. The renderer logs this to the audit log
because it usually indicates a prompt-injection attempt.

### 4. Sanitization errors

A parameter contained a shell metacharacter, a path traversal, or
another suspicious pattern. The tool layer throws
`EAAError('INVALID_PARAMETER', ...)` **before** the bridge is called.
The renderer displays a "your input was rejected as potentially
unsafe" message.

All errors are logged with:
- The request ID
- The agent ID
- The method
- The (sanitized) parameters
- The stack trace (if any)

---

## Debugging

### View bridge traffic

The bridge logs every request and response at `debug` level. To
enable:

1. Open Settings → Logs.
2. Set log level to `debug`.
3. Run an agent or trigger an EAA operation.
4. The Logs page will show the JSON request and response.

### Run EAA directly

You can run the EAA CLI directly to debug:

```bash
# Linux / macOS
./resources/eaa-binaries/linux-x64/eaa info

# Windows
.\resources\eaa-binaries\win32-x64\eaa.exe info
```

The CLI is fully usable on its own; the desktop app is a GUI on
top of it.

### Validate the event log

If the event log gets corrupted (e.g. a power outage during a
write), you can run the validator:

```bash
eaa validate --deep
```

This will:
- Replay all events from the beginning
- Compare the recomputed scores with the cached scores
- Report any discrepancies

If the log is broken, the EAA CLI will refuse to start; you can
manually repair the last event with `eaa repair`.

### Reset the data dir

If everything is broken, you can reset the data dir. **This is
destructive** — it deletes all events, all entities, all privacy
state.

1. Quit the app.
2. Move `userData/eaa-data/` to a backup.
3. Restart the app; it will recreate the data dir.

---

## Building from source

If you don't trust the pre-built release binary, you can build
`eaa-cli` from source. The EAA CLI source is in the
[`core/eaa-cli/`](https://github.com/232252/education-advisor/tree/main/core/eaa-cli)
directory of the main `education-advisor` repository:

```bash
# 1. Clone the main repository (this same project)
git clone https://github.com/232252/education-advisor.git ../education-advisor
cd ../education-advisor

# 2. Install Rust (if you don't have it)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 3. Build the CLI
cd core/eaa-cli
cargo build --release

# 4. The binary is at target/release/eaa (Linux/macOS) or
#    target/release/eaa.exe (Windows)
ls target/release/eaa*

# 5. Copy it to the resources directory of this repo
mkdir -p ../../../education-advisor/resources/eaa-binaries/$(rustc -vV | sed -n 's|host: ||p')
cp target/release/eaa$([ "$OS" = "Windows_NT" ] && echo .exe) \
   ../../../education-advisor/resources/eaa-binaries/$(rustc -vV | sed -n 's|host: ||p')/
```

The desktop app will pick up the locally-built binary on the next
startup.

---

## Manual install

If the `npm run build:eaa` script doesn't work for your environment
(proxy, firewall, etc.), you can install the binary manually:

1. Visit <https://github.com/232252/education-advisor/releases>.
2. Find the latest release that has the EAA binaries.
3. Download the binary for your platform.
4. Verify the SHA-256 against the manifest in the release notes.
5. Place it in `resources/eaa-binaries/<platform>/<binary>` where
   `<platform>` is one of:
   - `darwin-arm64` (Apple Silicon)
   - `darwin-x64` (Intel Mac)
   - `linux-arm64` (ARM Linux)
   - `linux-x64` (x86_64 Linux)
   - `win32-arm64` (Windows ARM)
   - `win32-x64` (Windows x86_64)
6. Make it executable: `chmod +x resources/eaa-binaries/<platform>/eaa`
   (Linux / macOS only).
7. Restart the app.

The directory name is the value of `process.platform` + `process.arch`
(see `src/main/services/eaa-bridge.ts`).

---

## Performance

The bridge is fast. On a typical 2023 laptop:

- `eaa info` — ~20 ms
- `eaa score Alice` — ~30 ms
- `eaa ranking` — ~80 ms (for 50 students)
- `eaa history Alice --limit 100` — ~120 ms
- `eaa add_event` — ~50 ms (incl. fsync)
- `eaa dashboard` — ~2–5 s (for 1 year of data, 50 students)

The bottleneck is the **fsync** on the event log. We deliberately
do not batch writes — every event is durably persisted before the
tool call returns. This is the project's most important performance
trade-off.

If you need higher write throughput (you don't — a class teacher
records at most a few events per minute), see the
[ROADMAP](../ROADMAP.md#pillar-6-privacy-compliance-audit) for the
plan to add a write-coalescing buffer.

---

## Security

The bridge implements several layers of security:

1. **No shell.** The child process is spawned with
   `shell: false` and with explicit argv. The OS is not involved in
   parsing the command.
2. **No relative paths in argv.** All paths passed to EAA are
   absolute.
3. **No env passthrough.** The child process only inherits the env
   vars it needs (`EAA_DATA_DIR`, etc.).
4. **Input validation.** The tool layer validates every parameter
   before the bridge is called.
5. **Output validation.** The bridge validates the EAA response
   against a TypeBox schema before returning to the agent.
6. **Timeout.** Each call has a 30-second timeout (configurable).
   The child process is killed on timeout.
7. **Audit log.** Every call is logged with the agent ID, the
   method, and the (sanitized) parameters.

The bridge is the **last line of defense** between the LLM and
the file system. It is designed to fail closed.
