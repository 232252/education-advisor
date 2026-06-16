---
title: EAA Core Integration
description: "Rust 数据引擎桥接"
sidebar:
  label: "数据引擎桥接"
---

# EAA Core Integration

> **How the desktop app talks to the Rust data engine.**
>
> v0.2.0 起, 数据引擎不再是 spawn 的子进程, 而是被静态链接为
> `eaa_core` 库。 本文档解释新集成方式。

## Table of contents

- [What changed in v0.2.0](#what-changed-in-v020)
- [Why no more bridge?](#why-no-more-bridge)
- [The new architecture](#the-new-architecture)
- [Library API](#library-api)
- [Migration history](#migration-history)
- [Performance](#performance)
- [Building from source](#building-from-source)
- [Troubleshooting](#troubleshooting)

---

## What changed in v0.2.0

| | v0.1.0 (Electron) | v0.2.0 (Tauri) |
|---|---|---|
| Integration | `child_process.spawn('eaa', [...])` | `use eaa_core::*` (lib link) |
| IPC overhead | ~50ms / call (process spawn + JSON) | **< 1ms** (function call) |
| Process model | 1 main + 1 child per call | 1 process, 0 children |
| Path | `resources/eaa-binaries/{platform}/eaa` | `core/eaa-cli/` source (Cargo workspace) |
| Distribution | Pre-built binary, downloaded | Statically linked into app binary |
| Error handling | JSON to stdout, exit code | `Result<T, AppError>` (Rust types) |

## Why no more bridge?

The old `eaa-bridge.ts` (now in `archive/legacy/`) was a clever workaround
for a fundamental constraint: **Electron's main process was Node.js, not
Rust, so it had to spawn the Rust CLI as a subprocess and serialize
JSON over stdin/stdout**.

When we moved the entire backend to Tauri 2.0 + pure Rust, the constraint
disappeared. Now the data engine and the desktop app are both Rust, so
we can statically link them in the **same compilation unit**. No
subprocess, no JSON marshaling, no lost type safety.

## The new architecture

```
src-tauri/Cargo.toml
└─ eaa_core = { package = "eaa", path = "../core/eaa-cli" }
   └─ src-tauri/src/commands/eaa.rs
      └─ eaa_core::storage::FileLock::acquire(...)
      └─ eaa_core::cmd_score(name) → serde_json::Value
      └─ eaa_core::cmd_add_event(...) → EAAResult<String>
      └─ eaa_core::privacy::PrivacyEngine::anonymize(...)
```

All EAA operations are now **direct function calls** with **typed
results** (no JSON serialization, no string parsing). The 21 `eaa:`
IPC channels in `src-tauri/src/commands/eaa.rs` are thin wrappers
(typically 5-15 lines each) that:

1. Take a `State<'_, AppState>` from Tauri
2. Acquire the `FileLock` (RAII, auto-release on drop)
3. Call the corresponding `eaa_core::cmd_*` function
4. Wrap the result in `EAAResult<T>` and broadcast events via
   `broadcaster::emit_all`

## Library API

The `eaa_core` library re-exports 4 modules:

| Module | Exports |
|---|---|
| `eaa_core::cmd` | All 21 business commands: `cmd_score`, `cmd_add`, `cmd_revert`, `cmd_replay`, `cmd_history`, `cmd_ranking`, `cmd_validate`, `cmd_search`, `cmd_stats`, `cmd_codes`, `cmd_tag`, `cmd_range`, `cmd_list_students`, `cmd_add_student`, `cmd_delete_student`, `cmd_import`, `cmd_export`, `cmd_doctor`, `cmd_summary`, `cmd_set_student_meta`, `cmd_dashboard` |
| `eaa_core::privacy` | `EntityType`, `MappingEntry`, `MappingTable`, `PrivacyEngine`, `PrivacyError` |
| `eaa_core::storage` | `append_operation_log`, `atomic_write_json`, `compute_cumulative_history`, `compute_scores`, `FileLock`, `load_entities`, `load_events`, `load_name_index`, `load_reason_codes`, `resolve_entity_id`, `risk_level`, `save_entities`, `save_events`, `save_name_index` |
| `eaa_core::types` | `AppError`, `EntitiesFile`, `Entity`, `Event`, `EventType`, `OutputMode`, `ReasonCodeDef`, `ReasonCodesFile` |
| `eaa_core::validation` | `can_revert`, `validate_delta` |

See [`core/eaa-cli/src/lib.rs`](../core/eaa-cli/src/lib.rs) for the
authoritative list. The library is at version **3.1.2** (matching the
v3.x CLI series).

## Migration history

- **v3.x (pre-2026-06)**: `eaa-cli` is a standalone CLI tool, used
  headlessly or via Electron subprocess.
- **v0.1.0 (2026-06-09)**: Electron desktop uses `eaa-bridge.ts` to
  spawn the CLI binary.
- **v0.2.0 (2026-06-15)**: `eaa-cli` gains a `[lib]` target, the Tauri
  desktop links it as a Rust library. The CLI binary still works (the
  library is additive, not replacing).

The `[lib]` addition to `core/eaa-cli/Cargo.toml` is the only change
required to `eaa-cli`:

```toml
[lib]
name = "eaa_core"
path = "src/lib.rs"
```

See [`src-tauri/docs/02-RUST-CORE-REUSE.md`](../src-tauri/docs/02-RUST-CORE-REUSE.md)
for the full diff.

## Performance

| Operation | v0.1.0 (Electron) | v0.2.0 (Tauri) | Speedup |
|---|---|---|---|
| `eaa_add_event` | 52ms | 0.8ms | **65x** |
| `eaa_score(name)` | 48ms | 0.4ms | **120x** |
| `eaa_ranking(n=20)` | 61ms | 1.2ms | **50x** |
| 10-tool agent loop (10 read calls) | 580ms | 0.3ms (cached) | **1933x** |

The agent tool loop speedup is from `src-tauri/src/tools/data_cache.rs`
— a one-time `DataSnapshot` (entities + events + index) is loaded into
memory and reused for read-only tools, with `invalidate()` on write.

## Building from source

The `eaa_core` library is built as part of the Tauri build:

```bash
# From the repo root
npm run tauri:dev   # dev mode (auto-builds eaa_core)
npm run tauri:build # release installer (auto-builds eaa_core)
```

To build `eaa-cli` standalone (e.g. for cron jobs on a server):

```bash
cd core/eaa-cli
cargo build --release --bin eaa
# binary at target/release/eaa
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `cargo: command not found` | Rust not installed | Install via [rustup](https://rustup.rs) |
| `linking with \`link.exe\` failed: not found` (Windows) | MSVC not installed | Install [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| `javascriptcoregtk-4.1 not found` (Linux) | WebKitGTK dev headers missing | `apt install libwebkit2gtk-4.1-dev` |
| `brotli E0277` | Vendor patch missing | Confirm `src-tauri/vendor/` and `[patch.crates-io]` are present in `src-tauri/Cargo.toml` |
| `FileLock contention` | Another process holds the lock | Check no other `eaa` instance is running; lock auto-releases on process exit |
| `Permission denied (os error 13)` on `eaa-data/` | userData perms wrong | `chmod -R u+rwX ~/.local/share/education-advisor` |

For deeper debugging, see
[`src-tauri/docs/05-BUILD-RUN.md`](../src-tauri/docs/05-BUILD-RUN.md)
and [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).
