# Troubleshooting

> **The big list of common issues and their fixes.** If you have
> an issue that's not here, open a
> [GitHub Discussion](https://github.com/232252/education-advisor/discussions)
> and we'll add it.

## Table of contents

- [Installation issues](#installation-issues)
- [Build issues](#build-issues)
- [Runtime issues](#runtime-issues)
- [LLM issues](#llm-issues)
- [EAA / data engine issues](#eaa--data-engine-issues)
- [Privacy engine issues](#privacy-engine-issues)
- [Cron / scheduler issues](#cron--scheduler-issues)
- [UI / renderer issues](#ui--renderer-issues)
- [Auto-update issues](#auto-update-issues)
- [Code signing issues](#code-signing-issues)
- [Performance issues](#performance-issues)
- [Where to get more help](#where-to-get-more-help)

---

## Installation issues

### `npm ci` fails with "better-sqlite3" build error

**Error**:

```
gyp ERR! find Python
gyp ERR! find VS
gyp ERR! stack Error: Can't find Python executable "python"
```

**Cause**: `better-sqlite3` needs a C++ toolchain and Python to
build its native binding. The Visual Studio Build Tools or
Xcode Command Line Tools must be installed.

**Fix**:

- **Windows**: install
  [Visual Studio 2019/2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
  with the "Desktop development with C++" workload and the
  "Python 3" individual component.
- **macOS**: `xcode-select --install`. Python 3 should already
  be available; if not, `brew install python3`.
- **Linux**: `sudo apt install build-essential python3`.

After installing, run `npm rebuild better-sqlite3`.

### `npm ci` fails with "EACCES" or permission errors

**Error**:

```
npm ERR! code EACCES
npm ERR! syscall scandir
npm ERR! errno -13
```

**Cause**: npm can't read or write to `node_modules/`. This is
usually because the directory is owned by a different user
(e.g. you ran `sudo npm install` once).

**Fix**:

```bash
# Take ownership of the directory
sudo chown -R $USER:$USER node_modules/

# Or, more aggressive: nuke and reinstall
mavis-trash node_modules package-lock.json
npm ci
```

### `npm ci` fails with "lockfile out of sync"

**Error**:

```
npm ERR! npm ci can only install packages when your package.json
       and package-lock.json are in sync.
```

**Cause**: someone (or you) modified `package.json` without
regenerating `package-lock.json`.

**Fix**:

```bash
# Either revert package.json or regenerate the lockfile
npm install  # regenerates the lockfile
```

### `npm ci` is very slow

The first install is slow because it compiles `better-sqlite3`
from source. Subsequent installs are fast. To speed up
subsequent installs:

- Use `npm ci` (not `npm install`) to skip lockfile
  regeneration.
- Consider a local npm cache mirror if you're in a corporate
  environment.

### `npm run build:eaa` fails

`build:eaa` compiles the Rust source in `core/eaa-cli/` — it does not
download anything. The two most common failures are below.

**Error**:

```
[error] 未检测到 Rust 工具链（cargo 不可用）。
```

**Cause**: the Rust toolchain is not installed or not on your `PATH`.

**Fix**:

1. Install Rust via <https://rustup.rs/>.
2. Restart your terminal so `cargo` is on `PATH`, then verify with
   `cargo --version`.
3. Re-run `npm run build:eaa`.

**Error**:

```
error[E0xxx]: ...
error: could not compile `eaa` (bin "eaa") due to previous error
[error] cargo build 失败（exit 101）
```

**Cause**: a Rust compile error in `core/eaa-cli/`.

**Fix**:

1. Read the compiler output above the `[error]` line — it names the
   file and line.
2. Fix the Rust source, then re-run `npm run build:eaa`.

### `npm run build:eaa` succeeds but the binary doesn't work

**Error**: when the app starts, "EAA binary not found at
`resources/eaa-binaries/<platform>/eaa[.exe]`".

**Cause**: the binary is in the wrong directory, or it's not
executable.

**Fix**:

```bash
# Check the directory
ls -la resources/eaa-binaries/

# On Linux / macOS, make sure it's executable
chmod +x resources/eaa-binaries/linux-x64/eaa
chmod +x resources/eaa-binaries/darwin-*/eaa
```

The directory name must match `process.platform + process.arch`:

- `darwin-arm64` — Apple Silicon
- `darwin-x64` — Intel Mac
- `linux-arm64` — ARM Linux
- `linux-x64` — x86_64 Linux
- `win32-arm64` — Windows ARM
- `win32-x64` — Windows x86_64

---

## Build issues

### `npm run build` fails with TypeScript errors

**Error**: `tsc` reports type errors.

**Fix**: see the error message and fix the offending file. If
the error is in a third-party type definition, file an issue
with the upstream.

If the error is in a path alias (`@main/*`, `@renderer/*`,
`@shared/*`), make sure both `tsconfig.json` and the relevant
`vite.config.*.ts` define the alias.

### `npm run build` fails with "preload not found"

**Error**:

```
Error: preload not found at dist/main/preload.js
```

**Cause**: the main process Vite config didn't produce the
preload script. This usually happens when the vite build is
cancelled mid-build.

**Fix**:

```bash
# Clean and rebuild
npm run clean
npm run build
```

### `npm run build` is slow

The first build is slow (1–3 minutes) because of the
`better-sqlite3` native compilation. Subsequent builds are
fast (5–15 seconds). If subsequent builds are slow, check:

1. **Node version**: are you on Node 22? Older versions are
   slower.
2. **Vite cache**: the cache is in `node_modules/.vite/`. If
   it's stale, `rm -rf node_modules/.vite`.
3. **File watcher**: if `node_modules/` is being watched, it
   can slow down the build. Make sure your editor isn't
   watching `node_modules/`.

### `npm run package` fails with "cannot find icon.ico"

**Error**:

```
Error: cannot find icon at resources/icon.ico
```

**Cause**: the default `resources/icon.ico` is a placeholder.

**Fix**: replace it with a real 256x256 .ico file. See
[`DESKTOP_BUILD.md#windows-packaging-nsis--portable`](./DESKTOP_BUILD.md#windows-packaging-nsis--portable)
for the format requirements.

### `npm run package` fails with "Cannot find module 'electron'"

**Error**: when running `electron-builder`, it complains about
missing electron.

**Cause**: `npm ci` didn't install the dev dependencies.

**Fix**: `npm ci` (not `npm ci --production`).

### `npm run package` produces a 0-byte installer

**Cause**: usually a corrupted Vite build. Clean and rebuild.

**Fix**:

```bash
npm run clean
npm run build
npm run package
```

---

## Runtime issues

### The app crashes on launch with no error

**Cause**: usually a missing preload script or a corrupt
`userData/` directory.

**Fix**:

1. Check the log file:
   - **Windows**: `%APPDATA%\Education Advisor\logs\main-*.log`
   - **macOS**: `~/Library/Logs/Education Advisor/main-*.log`
   - **Linux**: `~/.config/Education Advisor/logs/main-*.log`
2. If the log says "preload not found", run `npm run build`.
3. If the log says "Cannot read settings.json", delete
   `userData/settings.json` and restart (you'll lose your
   in-app settings, but the shipped defaults will be re-applied).
4. If the log says "Cannot open db.sqlite", delete
   `userData/db.sqlite` and restart (you'll lose your chat
   history, but the events are still in the EAA data
   directory).

### The window opens but stays white

**Cause**: the renderer couldn't load. Usually a Vite build
issue or a missing asset.

**Fix**:

1. Open DevTools (`Ctrl+Shift+I` or `Cmd+Opt+I`).
2. Check the **Console** tab for errors.
3. If you see "Failed to load module script", run
   `npm run build` to rebuild the renderer.
4. If you see "Refused to connect", check that
   `process.env.VITE_DEV_SERVER_URL` is set (or that the
   renderer dev server is running on `http://localhost:5173`).
5. If you see "Cannot find module 'react'", run
   `npm ci` to make sure the deps are installed.

### The window opens but is unresponsive

**Cause**: usually a deadlock in the main process.

**Fix**:

1. Force-quit the app.
2. Restart.
3. If the issue persists, check the main process log for
   errors.
4. Open an issue with the log attached (anonymize any PII
   first).

### The window is flickering / repainting constantly

**Cause**: usually a Zustand selector that's returning a new
object on every render.

**Fix**: open DevTools → React DevTools → Profiler, find the
component that's re-rendering, and check its selectors. The
fix is usually to use `shallow` or to memoize the selector.

### The app uses too much RAM

**Cause**: usually the ECharts instances in the Dashboard page
or the chat history that hasn't been compacted.

**Fix**:

1. In Settings → Chat, enable "Conversation logging" off (for
   the current session).
2. In Settings → Models, increase the compaction threshold
   so old messages are summarized more aggressively.
3. In the Dashboard page, reduce the chart window (e.g. from
   30 days to 7 days).

### The app uses too much disk space

**Cause**: usually the log files in `userData/logs/` or the
EAA event log.

**Fix**:

1. In Settings → Logs, click "Clear all logs".
2. In the EAA data directory, the event log is
   `events.log`. If it's grown beyond 100 MB, consider
   exporting and archiving old events:
   `eaa export --format json --output-file archive-2025.json`
   `eaa prune --before 2025-01-01`

---

## LLM issues

### All LLM calls fail with 401 / 403

**Cause**: invalid API key.

**Fix**:

1. Go to Settings → Models.
2. Click on the failing provider.
3. Click "Test connection" with a fresh API key.
4. If the test passes, click "Save".

### All LLM calls fail with 429

**Cause**: rate limit exceeded.

**Fix**:

1. Reduce the cron frequency in `config/agents.yaml`.
2. Reduce the number of concurrent agent runs.
3. Upgrade your LLM plan.

### LLM calls succeed but the output is wrong / weird

**Cause**: usually a small model that doesn't follow the prompt
well, or a misconfigured `SOUL.md`.

**Fix**:

1. Try a larger model (e.g. switch from `gpt-4o-mini` to
   `gpt-4o` for the failing agent).
2. Edit the agent's `SOUL.md` to be more specific.
3. Check the agent's `AGENTS.md` for the working rules.
4. If the issue persists, open an issue with a sample
   prompt + response.

### LLM calls are very slow

**Cause**: usually a high-quality model on a slow network, or a
context window that's too large.

**Fix**:

1. Switch to a smaller model (e.g. `gpt-4o-mini` or `qwen-4b`).
2. Enable context compaction (Settings → Chat).
3. Reduce the agent's context by editing its `SOUL.md` to be
   more concise.

### LLM calls cost too much

**Cause**: usually the high-quality model being used for tasks
that don't need it, or a context window that's too large.

**Fix**:

1. Audit the model tier assignments in `config/agents.yaml`.
   `high-quality` should only be used for tasks where the
   quality matters (the morning/evening push, the weekly
   report).
2. Enable context compaction.
3. Switch to a cheaper model (e.g. `deepseek-chat` instead of
   `gpt-4o`).

---

## EAA / data engine issues

### "EAA binary not found"

**Error**: in the main process log, "EAA binary not found at
`resources/eaa-binaries/<platform>/<binary>`".

**Fix**: see the [`build:eaa` section above](#npm-run-buildeaa-fails).

### EAA calls return "INVALID_REASON_CODE"

**Cause**: the LLM used a reason code that isn't in
`config/reason-codes.json`. This is usually a small-model
hallucination.

**Fix**:

1. The teacher can manually correct the event in the Students
   page.
2. The maintainer can add the missing code to
   `config/reason-codes.json` if it's a legitimate code that
   the schema is missing.
3. The agent author can edit the agent's `SOUL.md` to be
   more specific about the valid codes.

### EAA calls return "STUDENT_NOT_FOUND"

**Cause**: the LLM used a name that isn't in the student
roster. This is usually a typo or a hallucination.

**Fix**:

1. The teacher can manually correct the event in the Students
   page.
2. The maintainer can import the missing student via the
   Students page.

### EAA calls are slow

**Cause**: usually the `eaa validate` operation on a very large
event log, or a slow disk.

**Fix**:

1. The EAA CLI is fast for the operations the agents typically
   use (`score`, `history`, `add_event`). If a specific
   operation is slow, it's likely the data volume.
2. Archive old events: `eaa export --before 2025-01-01` and
   `eaa prune --before 2025-01-01`.
3. If the disk is slow (HDD, network share), move the
   `userData/` directory to an SSD.

### The event log gets corrupted

**Cause**: usually a power outage during a write, or a process
kill in the middle of an `fsync`.

**Fix**:

```bash
# 1. Validate the log
eaa validate --deep

# 2. If validation finds issues, repair
eaa repair

# 3. If repair can't recover, restore from the most recent
#    backup
eaa restore --from backup-2026-06-01
```

The EAA CLI writes a snapshot to `userData/eaa-data/snapshots/`
every 100 events. You can roll back to any snapshot.

---

## Privacy engine issues

### "Master password incorrect"

**Cause**: case-sensitive password mismatch, or the password
file is corrupted.

**Fix**: type the password carefully, paying attention to
case. If you've forgotten it, you cannot recover the mapping
table — you'll need to re-initialize the engine with a new
password.

### "Privacy engine not initialized"

**Cause**: the engine was never initialized. The teacher needs
to pick a master password.

**Fix**: visit the Privacy page, click "Initialize", enter a
strong master password (12+ chars, mixed case, numbers,
symbols).

### PII is leaking to the LLM

**Cause**: the privacy engine is disabled, or the anonymization
missed something.

**Fix**:

1. Verify the privacy engine is enabled (Settings → Privacy →
   "Enabled").
2. Check the audit log for the LLM calls. Look for
   `entities_replaced: 0` on a call that should have
   anonymized names.
3. If the issue is a name pattern that the engine doesn't
   recognize, open an issue with a sample.

### "Audit log is too large"

**Cause**: the audit log is append-only and never rotated.

**Fix**: this is a known limitation. For now, the recommended
approach is to archive the audit log periodically:

```bash
# Move the current log to an archive
mv userData/eaa-data/privacy/audit.log userData/eaa-data/privacy/audit-2026-06.log
# The next anonymize / deanonymize call will create a new audit.log
```

A future version will add automatic log rotation.

---

## Cron / scheduler issues

### A cron job isn't firing

**Cause**: many possibilities. See
[`CRON.md#a-cron-job-isnt-firing`](./CRON.md#a-cron-job-isnt-firing)
for the full troubleshooting.

### A cron job is firing but the agent errors out

**Cause**: see
[`CRON.md#a-cron-job-fires-but-the-agent-errors-out`](./CRON.md#a-cron-job-fires-but-the-agent-errors-out).

### A cron job is disabled automatically

**Cause**: 3+ consecutive failures.

**Fix**:

1. Check the cron logs for the failure reason.
2. Fix the underlying issue (LLM error, missing capability,
   etc.).
3. Re-enable the job in the Scheduler page.

### A cron job is firing at the wrong time

**Cause**: timezone mismatch.

**Fix**: set the `TZ` env var to your timezone. See
[`CRON.md#time-zones`](./CRON.md#time-zones).

---

## UI / renderer issues

### The fonts look wrong

**Cause**: the bundled fonts (Inter, JetBrains Mono) might not
be loading.

**Fix**:

1. Check DevTools → Network for failed font requests.
2. If the font CDN is blocked, the fonts will fall back to
   system defaults. To bundle the fonts locally, copy them
   to `src/renderer/assets/fonts/` and update the
   `@font-face` declarations in `globals.css`.

### A specific page is blank or broken

**Cause**: usually a React error during render.

**Fix**:

1. Open DevTools → Console.
2. Look for React error messages (red boxes).
3. Open an issue with the error message.

### The i18n switch doesn't work

**Cause**: the language might not be in the i18n files.

**Fix**: check `src/renderer/i18n/index.ts` — the supported
languages are listed there. If your language isn't supported,
open a PR to add it.

### The theme doesn't change

**Cause**: the theme toggle uses CSS variables; if the CSS
variables aren't loading, the theme can't change.

**Fix**:

1. Check DevTools → Elements for the `data-theme` attribute on
   the `<html>` element.
2. If the attribute is set but the colors don't change, the
   CSS variables might be missing. Check
   `src/renderer/styles/globals.css` for the theme
   variables.

---

## Auto-update issues

### The app doesn't prompt for updates

**Cause**: the `autoUpdate` setting is off, or the
`latest.yml` is missing from the GitHub release.

**Fix**:

1. Check Settings → General → "Auto update" is on.
2. Check the Logs page for the auto-update flow.
3. Check that the `latest.yml` (Windows) / `latest-mac.yml`
   (macOS) / `latest-linux.yml` (Linux) is in the same
   release as the installer.
4. If using a custom channel, verify the channel is
   correctly configured.

### The update downloads but doesn't install

**Cause**: usually a file permission issue on the target
directory.

**Fix**:

1. Run the app as an administrator (Windows) or with
   `sudo` (macOS / Linux) for the first update.
2. If the issue persists, manually download the new
   installer from the GitHub Releases page and install over
   the old version.

### The update installs but the app crashes

**Cause**: a new version with a regression, or a corrupt
download.

**Fix**:

1. Restart the app — sometimes the crash is a one-time
   issue from the update process.
2. If the crash persists, roll back to the previous version:
   - Visit the GitHub Releases page.
   - Download the previous version's installer.
   - Install over the current version.
3. Open an issue with the crash log.

---

## Code signing issues

### Windows: SmartScreen blocks the installer

**Cause**: the installer is unsigned.

**Fix**: see
[`DESKTOP_BUILD.md#code-signing`](./DESKTOP_BUILD.md#code-signing).
For an interim fix, the teacher can click "More info" → "Run
anyway".

### macOS: Gatekeeper blocks the app

**Cause**: the app is unsigned or un-notarized.

**Fix**: see
[`DESKTOP_BUILD.md#code-signing`](./DESKTOP_BUILD.md#code-signing).
For an interim fix, the user can right-click the app →
"Open" → "Open" in the dialog.

### Code signing certificate errors

**Error**:

```
Error: Cannot find certificate
```

**Cause**: the certificate isn't in the expected location, or
the password is wrong.

**Fix**:

- Verify the certificate file is at `CSC_LINK`.
- Verify the password is at `CSC_KEY_PASSWORD`.
- Verify the certificate is valid (not expired, not revoked).
- On Windows, the certificate should be in the Current User /
  Personal store, or you can specify the path with `CSC_LINK`.

---

## Performance issues

### The app is slow on startup

**Cause**: usually the SQLite initialization or the EAA
binary spawn.

**Fix**:

1. **Move `userData/` to an SSD.** SQLite is much faster on
   SSDs.
2. **Reduce the log level.** Debug logging is expensive.
3. **Disable unused agents.** Each agent is loaded at boot.

### The app uses too much CPU when idle

**Cause**: usually the cron service polling too often, or a
hot-loop in a service.

**Fix**:

1. Check the cron schedule — make sure no jobs are running
   more often than necessary.
2. Open DevTools → Performance, record a 30-second idle
   profile, and look for hot loops.

### The app's memory grows over time

**Cause**: usually a memory leak in a service. We have a
known issue with the chat history store that we'll fix in
v0.2.0.

**Fix**:

1. Restart the app periodically (e.g. once a day).
2. In the meantime, the issue is tracked as
   [issue #42](https://github.com/232252/education-advisor/issues/42).

---

## Where to get more help

If this page doesn't cover your issue:

1. **Search the existing issues** on GitHub.
2. **Open a new issue** using the
   [bug report template](https://github.com/232252/education-advisor/issues/new?template=bug_report.yml).
3. **Ask in Discussions** for usage questions.
4. **Email the maintainer team** for security issues (see
   [`SECURITY.md`](../SECURITY.md)).

Please **do not** include real student data, real teacher
names, or any other PII in your bug reports. Use the
`examples/students/` data set instead.
