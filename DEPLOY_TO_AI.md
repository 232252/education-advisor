# AI Self-Deployment Guide

> **You can hand this entire file to an AI assistant** (Claude, GPT-4,
> Qwen, Doubao, etc.) and ask it to deploy Education Advisor on your
> machine. The assistant should be able to follow the steps below end
> to end, with no human intervention except for the obvious prompts
> (password, sudo, etc.).

---

## 0. What you're about to do

You will:

1. Verify the prerequisites (Node 22+, a working C++ toolchain, a working
   internet connection).
2. Clone this repository.
3. Install the Node.js dependencies.
4. Download the Rust `eaa-cli` binary for your platform.
5. Run the dev server to make sure everything works.
6. (Optional) Build and package the desktop application.
7. (Optional) Configure Feishu (Lark) integration.
8. (Optional) Configure your LLM provider.

The whole process should take **5–15 minutes** on a typical machine.

---

## 1. Prerequisites

### Operating system

| OS | Status |
| --- | --- |
| Windows 10 (build 19041+) or Windows 11 | ✅ Fully supported, primary target |
| macOS 12 (Monterey) or later, Intel or Apple Silicon | 🟡 Configured, untested in CI |
| Ubuntu 22.04 LTS or later, x86_64 or aarch64 | 🟡 Configured, untested in CI |

### Runtime

- **Node.js 22.x or later** — verify with `node -v`. Install from
  <https://nodejs.org/> or via your package manager.
- **npm 10.x or later** — verify with `npm -v`. Comes with Node 22.
- **A working C++ toolchain** — required to build `better-sqlite3`:
  - **Windows**: Visual Studio 2019/2022 Build Tools with the
    "Desktop development with C++" workload. Get them from
    <https://visualstudio.microsoft.com/visual-cpp-build-tools/>.
  - **macOS**: `xcode-select --install`
  - **Linux**: `apt install build-essential python3` (Debian/Ubuntu),
    `dnf install gcc gcc-c++ make` (Fedora/RHEL), or the equivalent for
    your distribution.

### Disk space

- ~1 GB for `node_modules/`
- ~50 MB for the EAA binary
- ~200 MB for the build artifacts (`dist/` + `release/`)

### Optional

- **Git** (only if you're cloning from the command line)
- **A Feishu (Lark) app** (only if you want to sync to Bitable)
- **An LLM API key** (only if you want to use a hosted model)

---

## 2. Clone

```bash
git clone https://github.com/232252/education-advisor.git
cd education-advisor
```

If you don't have Git, download the source as a ZIP from the GitHub UI
and extract it.

---

## 3. Install dependencies

```bash
npm ci
```

This is equivalent to `npm install` but uses the committed `package-lock.json`
for reproducible installs. It will:

- Download all npm dependencies into `node_modules/`
- Trigger a native build of `better-sqlite3` (this is the only
  non-pure-JS dependency)
- Take 1–5 minutes depending on your machine

If you see errors about `better-sqlite3`, see the
[Troubleshooting](#troubleshooting) section below.

---

## 4. Fetch the Rust backend

The Rust `eaa-cli` binary is a core component of this project. Its source
lives in `core/eaa-cli/` inside this repo, so it is built from source —
there is no download step and no separate release to keep in sync.

```bash
npm run build:eaa
```

This script (`scripts/build-eaa.mjs`) will:

1. Detect your platform (Windows x64/arm64, macOS x64/arm64, Linux x64/arm64).
2. Verify the Rust toolchain (`cargo`) is installed — if not, it errors
   out and points you to <https://rustup.rs>.
3. Run `cargo build --release` in `core/eaa-cli/`.
4. Place the built binary at `resources/eaa-binaries/<platform>/<binary>`.

The build is cached: it skips recompiling when the existing binary is
newer than the `.rs` sources. Force a rebuild with
`EAA_FORCE=1 npm run build:eaa`.

For details on the runtime bridge, see
[`docs/EAA_BRIDGE.md`](./docs/EAA_BRIDGE.md).

---

## 5. Run the dev server

```bash
npm run dev
```

This starts two processes in parallel:

- **Main process builder** — Vite, with `--watch` mode, building
  `dist/main/index.js` and `dist/main/preload.js` on every change.
- **Renderer dev server** — Vite, serving the React app at
  <http://localhost:5173> with HMR.

The two processes are color-coded in the terminal: blue for the main
process, green for the renderer.

In a **second terminal**, run:

```bash
npm run dev:electron
```

This launches the Electron shell, which loads the renderer from
<http://localhost:5173> (dev mode) or from `dist/renderer/index.html`
(production mode).

You should see a window open, the title "Education Advisor", and the
Dashboard page. If you see an error, see [Troubleshooting](#troubleshooting).

---

## 6. (Optional) Build and package

```bash
npm run build
npm run package
```

This produces:

- `dist/main/index.js` + `dist/main/preload.js` — the main process bundle
- `dist/renderer/index.html` + assets — the renderer bundle
- `release/Education Advisor-Setup-0.1.0.exe` — the NSIS installer (~85 MB)
- `release/Education Advisor-0.1.0-Portable.exe` — the portable .exe (~75 MB)
  (run with `npm run package:portable` instead)

For macOS / Linux targets, edit
[`electron-builder.yml`](./electron-builder.yml) and add the
corresponding `mac:` / `linux:` blocks. See
[`docs/DISTRIBUTION.md`](./docs/DISTRIBUTION.md) for the full guide.

---

## 7. (Optional) Configure Feishu

If you want to sync to a Feishu Bitable:

1. Create a Feishu app at <https://open.feishu.cn/>.
2. Get the **App ID** and **App Secret**.
3. In the Education Advisor app, go to **Settings → Feishu**.
4. Paste the App ID and App Secret.
5. Click **Test connection** — you should see a green check.
6. Click **Sync now** to test the Bitable sync.

For the full guide, see
[`docs/DISTRIBUTION.md#feishu-integration`](./docs/DISTRIBUTION.md).

---

## 8. (Optional) Configure your LLM provider

If you want to use a hosted LLM (OpenAI, Anthropic, etc.):

1. In the Education Advisor app, go to **Models**.
2. Click **Add provider**.
3. Pick the provider, paste the API key.
4. Click **Test connection**.
5. Set it as the default for `high-quality` and / or `low-cost` model
   tiers.

If you want to use a local LLM (Ollama, LM Studio, vLLM):

1. Start your local server (it should expose an OpenAI-compatible API
   at a known URL).
2. In Education Advisor, go to **Models → Custom models**.
3. Add a custom model with the local server's URL as `baseUrl`.

---

## Troubleshooting

### `better-sqlite3` fails to build

**Error**: `node-gyp` errors, or "no pre-built binary available for
your platform".

**Fix**:

- Windows: install the Visual Studio Build Tools (see Prerequisites).
- macOS: `xcode-select --install`.
- Linux: install `build-essential` and `python3`.
- After installing the toolchain, run `npm rebuild better-sqlite3`.

### `EAA binary not found` on startup

**Error**: in the Settings → Logs, an error like "EAA binary not found
at resources/eaa-binaries/win32-x64/eaa.exe".

**Fix**:

```bash
npm run build:eaa
```

If that doesn't help, see
[`docs/EAA_BRIDGE.md`](./docs/EAA_BRIDGE.md#manual-install).

### `preload not found` on startup

**Error**: in the main process log, an error like "preload not found
at dist/main/preload.js".

**Fix**:

```bash
npm run build
```

The main process expects the preload script to be built first. If you
ran `dev:electron` without first running `build` or `dev`, the preload
script doesn't exist yet.

### Renderer is blank

**Error**: the window opens but stays white.

**Fix**:

- Open DevTools (`Ctrl+Shift+I` or `Cmd+Opt+I`).
- Check the Console tab for errors.
- If you see "Failed to load module script", make sure you ran
  `npm run build` first.
- If you see "Refused to connect", check that
  `process.env.VITE_DEV_SERVER_URL` is set (or that the renderer dev
  server is running on `http://localhost:5173`).

### LLM calls fail

**Error**: in the Logs, errors from the LLM provider.

**Fix**:

- Verify the API key in **Models**.
- Click **Test connection** to confirm the key works.
- Check that your network can reach the provider's endpoint
  (firewalls, proxies, etc.).
- If you are behind a corporate proxy, set the `HTTPS_PROXY` /
  `HTTP_PROXY` environment variables.

---

## Where to go from here

- The [PROJECT_INTRO.md](./PROJECT_INTRO.md) is the long-form reference.
- The [docs/](./docs/) directory has per-topic deep-dives.
- The [CONTRIBUTING.md](./CONTRIBUTING.md) has the developer workflow
  if you want to modify the code.
- The [SECURITY.md](./SECURITY.md) has the security policy and how to
  report vulnerabilities.

Welcome aboard. If something didn't work, please open an issue at
<https://github.com/232252/education-advisor/issues>.
