# Desktop build

> **How to build the desktop application from source.** This document
> covers the local dev build, the production build, the platform
> packaging, the auto-update flow, and the troubleshooting for the
> most common build issues.

## Table of contents

- [The three Vite configs](#the-three-vite-configs)
- [Local dev build](#local-dev-build)
- [Production build](#production-build)
- [Windows packaging (NSIS + portable)](#windows-packaging-nsis--portable)
- [macOS packaging (DMG)](#macos-packaging-dmg)
- [Linux packaging (deb + AppImage)](#linux-packaging-deb--appimage)
- [The auto-update flow](#the-auto-update-flow)
- [Code signing](#code-signing)
- [Reproducible builds](#reproducible-builds)
- [Troubleshooting](#troubleshooting)

---

## The three Vite configs

The project has three Vite configs because Electron runs distinct
processes with different output requirements (`npm run dev` starts all
three):

| Config | Purpose | Output |
| --- | --- | --- |
| `vite.config.main.ts` | The main process | `dist/main/index.cjs` |
| `vite.config.preload.ts` | The preload bridge (single-file inline) | `dist/main/preload.cjs` |
| `vite.config.renderer.ts` | The renderer (Chromium) | `dist/renderer/index.html` + assets |

The main-process config:

- Uses `ssr: true` and `lib.entry` to produce a CommonJS library.
- Has `format: 'cjs'` because the main process is a Node process.
- Externalizes native / runtime deps (electron, better-sqlite3,
  node-cron, cross-spawn, ws, selfsigned, pdfjs-dist,
  `@napi-rs/canvas`).
- Inlines `@earendil-works/*` (the vendored pi-ai) into the bundle via
  the `ssr.noExternal` regex `/^@earendil-works\//` in
  `vite.config.main.ts` — their exports are ESM-only, so leaving them
  external would break `require()` at runtime. (There is no
  pi-agent-core alias anymore; that package no longer exists.)
- Does **not** bundle `@deepseek-ai/dsh-sdk-client`: that package is
  ESM-only and pre-stable, so `runtime.ts` loads it at runtime through
  a hidden dynamic import. It stays in `node_modules` — which is why
  `electron-builder.yml` unpacks `**/node_modules/**` from the asar.

The preload config:

- Builds a **single-file inline** CJS bundle whose only external is
  `electron` — a sandboxed preload is only allowed to `require`
  `electron`, so it cannot have shared chunks.

The renderer config:

- Uses the standard `react()` plugin.
- Has `base: './'` because Electron loads from `file://`.
- Targets `chrome150` (conservative baseline; Electron 45 ships Chromium 156).
- Has HMR enabled by default.

---

## Local dev build

```bash
# Terminal 1: dev servers
npm run dev

# Terminal 2: Electron shell
npm run dev:electron
```

The dev servers watch the source and rebuild on change. The
Electron shell loads the renderer from `http://localhost:5173`
(with HMR) and the main process from the freshly-built
`dist/main/index.cjs`.

If you only want to rebuild without launching Electron:

```bash
# Main process only, with --watch
npm run dev:main

# Renderer only, with HMR
npm run dev:renderer
```

The dev shell opens DevTools in detached mode by default. To
disable, set `process.env.NODE_ENV` to `production` before
launching.

---

## Production build

```bash
# Build the main + preload + renderer bundles
npm run build

# Output:
#   dist/main/index.cjs      (CommonJS)
#   dist/main/preload.cjs    (CommonJS, single-file inline)
#   dist/renderer/index.html
#   dist/renderer/assets/    (hashed JS / CSS / image filenames)
```

`npm run build` auto-runs the npm `prebuild` hook first
(`scripts/prebuild-check.mjs`), which aborts the build when core
resources (the EAA binary, `agents/`, `config/`) are missing.

The build is minified for the renderer (saves ~30% on the
initial bundle) but **not** minified for the main process (to
preserve stack traces).

Source maps are produced for both. They are **not** included in
the packaged installer (saves ~5 MB) but are uploaded to Sentry
or your error tracker of choice.

### The dsh assembly gate (`npm run verify:dsh`)

`scripts/verify-dsh-package.mjs` guards the assembly of the dsh
backend, because the regular tests stub the SDK client and would never
catch it: `@deepseek-ai/dsh-sdk-client` must be in `dependencies`
(not `devDependencies`), the installed SDK must bring the
`@deepseek-ai/dsh` runtime, the dsh executable must exist on real
disk. `asarUnpack` is only native binaries; the pure-Node subprocess
reads `app.asar` through `resources/asar-preload`.

It is a CI gate (`.github/workflows/ci.yml`, the
"dsh assembly check" step) and it runs locally too:

```bash
npm run verify:dsh
# after packaging, also check the unpacked output:
npm run verify:dsh -- --dist release-v11/win-unpacked
```

---

## Windows packaging (NSIS + portable)

```bash
# Build a Windows x64 NSIS installer
npm run package

# Output:
#   release-v11/Education-Advisor-Setup.exe       (~85 MB, NSIS installer, version-free name)
#   release-v11/Education-Advisor-Portable.exe    # see below

# Build a Windows x64 portable .exe
npm run package:portable

# Build a Windows x64 NSIS installer (explicit)
npm run package:installer
```

`npm run package` passes `--config electron-builder.config.mjs`. That
config does **not** change the 7z compression level. electron-builder's
default for the NSIS payload is `-mx=9`, the same ultra LZMA that produced
the ~323 MB v3.3.6 Setup.exe. Uncompressed (`store` / `-mx=0`) packing was
tried and rejected: it makes install a raw copy and grows Setup.exe to
about 0.8–1.1 GB. Decode of a ~300 MB LZMA archive is seconds. The
multi-minute install was the 27,647 separate files.

The config unpacks only native binaries (`*.node`, `*.dll`, `*.exe`,
`*.dylib`, `*.so`). JavaScript stays in `app.asar`. The connection-center
plugin is `resources/dsh-im.asar` plus `resources/dsh-im-deps.asar`; the
first time the connection center opens, the source archive is expanded
under the user data directory so pnpm can link a real directory. The
Office kit is `resources/office-kit/*.zip` (one file, 735 entries inside)
and is extracted locally when the app warms it up, not as hundreds of
files during setup. A bare `electron-builder` without this config still
unpacks all of `node_modules`.

The artifact name is fixed (`Education-Advisor-Setup.${ext}`) so the
download-page URL stays stable across versions.

### What `prepackage` stages (auto-runs before `npm run package`)

npm runs the `prepackage` hook automatically before `package`. It runs
three scripts in order:

1. `scripts/prebuild-check.mjs` — resource readiness gate (same as the
   `prebuild` hook).
2. `scripts/stage-dsh-node.mjs` — copies a stock `node.exe` from your
   machine into the gitignored `vendor/dsh-node/`. dsh 0.2.1 rejects
   Electron's runtime fingerprint (this app is Electron 45.0.0), so the
   packaged app launches the dsh subprocess with a real Node binary
   instead of Electron's own exe. Skipped when a copy is already
   staged.
3. `scripts/stage-dsh-im-deps.mjs` — installs `vendor/dsh-im/`
   production dependencies with the repo's own pnpm (`qrcode` and the
   channel SDKs are not in the plugin zip), keeping first launch
   offline and out of a read-only resources directory. Skipped when
   already installed.

Staging requires a completed `npm install` (for `node_modules/pnpm`)
and a Node on PATH. Both scripts are no-ops once their output exists;
delete `vendor/dsh-node/` or `vendor/dsh-im/node_modules/` to force a
re-run (e.g. after upgrading dsh or dsh-im).

### What the NSIS installer does

1. **Installs per-user** (`%LOCALAPPDATA%\Programs`; `nsis.perMachine: false` in `electron-builder.yml`).
2. **Creates a desktop shortcut** and a start menu shortcut.
3. **Copies one `app.asar`** (the app plus its JavaScript dependencies)
   to the install location. Only native binaries are unpacked beside it.
   The dsh subprocess is stock Node; it is started with the asar preload
   so it can read that archive instead of a tree of loose files.
4. **Copies `resources/eaa-binaries/`** to the install location
   (as `extraResources`).
5. **Copies `config/`, `agents/`, `skills/`, `vendor/dsh-im/` (the
   official connection-center plugin), the education plugins
   `vendor/eaa-tools|eaa-roster|eaa-grades|eaa-grading/`,
   `vendor/dsh-node/` (the staged `node.exe`), and `scripts/asar-preload/`**
   to the install location (all as `extraResources`). The plugin's
   `node_modules` is one `node_modules.asar` written by `afterPack`, not
   a second loose tree.
6. **Registers the app in the Add/Remove Programs** list.
7. **Optional**: launches the app on completion (configurable).

### What the portable .exe does

- **Single self-extracting file.** No installation required.
- **Extracts to `%TEMP%` at launch** and runs from there.
- **Settings are stored in `%APPDATA%\Education Advisor`** (same as
  the installed version).
- **Useful for**: USB sticks, quick demos, IT troubleshooting.

### Windows ARM64

ARM64 builds require running the build on an ARM64 Windows host
or a cross-compile setup that is **not** part of the default
pipeline. We are tracking this in the
[ROADMAP](../ROADMAP.md#pillar-4-cross-platform-parity).

---

## macOS packaging (DMG)

> macOS packaging is configured in `electron-builder.yml` **and
> runs on the default CI pipeline** (`macos-latest` runners in
> `.github/workflows/release.yml`). Signing keys are the remaining
> piece — see [DISTRIBUTION.md](./DISTRIBUTION.md).

To build locally on a Mac:

```bash
npx electron-builder --mac   # NOTE: `npm run package` is pinned to --win --x64
```

This produces:

- `release-v11/Education-Advisor-arm64.dmg` (Apple Silicon)
- `release-v11/Education-Advisor.dmg` (Intel, x64)
- `release-v11/Education-Advisor-mac.zip` (zip alternative for
  auto-update)

For the build to succeed you need:

- Xcode Command Line Tools: `xcode-select --install`
- An Apple Developer ID for code signing (see
  [Code signing](#code-signing))

---

## Linux packaging (deb + AppImage)

> Linux packaging is configured in `electron-builder.yml` **and
> runs on the default CI pipeline** (`ubuntu-22.04` runner in
> `.github/workflows/release.yml`). See
> [DISTRIBUTION.md](./DISTRIBUTION.md) for distribution notes.

To build locally on a Linux box:

```bash
# Build a .deb (Debian / Ubuntu)
npx electron-builder --linux deb

# Build an AppImage (portable)
npx electron-builder --linux AppImage

# Build both
npx electron-builder --linux deb AppImage
```

This produces:

- `release-v11/Education-Advisor.deb`
- `release-v11/Education-Advisor.AppImage`

For the build to succeed you need:

- `dpkg` (for deb)
- `appimagetool` (for AppImage)
- `fakeroot` (for the install step)

---

## The auto-update flow

The app uses [`electron-updater`](https://www.electron.build/auto-update)
to deliver updates. The flow:

```
┌──────────────────────┐
│  User's app          │
│  (on launch, every   │
│   5s after start)    │
└──────────┬───────────┘
           │ GET https://api.github.com/repos/.../releases/latest
           ▼
┌──────────────────────┐
│  GitHub Releases     │
└──────────┬───────────┘
           │ { tag_name: 'v0.1.5', assets: [...] }
           ▼
┌──────────────────────┐
│  latest.yml          │ ← generated at release time
│  (in the same dir    │
│   as the installer)  │
└──────────┬───────────┘
           │ { version: '0.1.5', files: [...] }
           ▼
┌──────────────────────┐
│  User's app          │
│  Compares version.   │
│  If newer, prompts.  │
└──────────┬───────────┘
           │ User clicks "Update"
           ▼
┌──────────────────────┐
│  Downloads the       │
│  new installer to    │
│  %TEMP%              │
└──────────┬───────────┘
           │ When user quits the app
           ▼
┌──────────────────────┐
│  Runs the installer  │
│  in update mode      │
└──────────────────────┘
```

### What you need to set up

1. **The release workflow** (already in place as
   `.github/workflows/release.yml`).
2. **The `latest.yml` files** in the release assets. These are
   generated by `electron-builder --publish always` and uploaded
   alongside the installer.

### Update configuration

There are **no update channels**. The relevant settings are two
booleans/strings in Settings → General:

- **`general.autoUpdate`** (default `true`) — check GitHub Releases
  on startup (5 s after boot); when an update is found the app
  offers download + restart-install.
- **`general.updateUrl`** (default empty) — point at a different
  GitHub repo to serve updates from a fork, for school-wide
  deployments that pin their own release train.

There is no stable/beta/rc channel switcher in the app.

---

## Code signing

### Windows

Code signing on Windows requires:

1. A code-signing certificate (`.pfx` file) issued by a trusted CA
   (DigiCert, Sectigo, GlobalSign, etc.).
2. The certificate's password.
3. The certificate's SHA-1 thumbprint (for signtool).

Set the following environment variables in your CI:

```bash
CSC_LINK=/path/to/certificate.pfx
CSC_KEY_PASSWORD=the-password
```

`electron-builder` will sign the installer and the portable .exe
automatically.

If you don't have a code signing certificate, the app will be
built unsigned and Windows SmartScreen will show a warning on
first launch. This is **expected** for unsigned builds.

### macOS

Code signing on macOS requires:

1. An Apple Developer ID.
2. A Developer ID Application certificate (in Keychain).
3. An app-specific password (for notarization).
4. The team ID.

Set the following environment variables in your CI:

```bash
APPLE_ID=your-apple-id@example.com
APPLE_APP_SPECIFIC_PASSWORD=abcd-efgh-ijkl-mnop
APPLE_TEAM_ID=ABCDE12345
CSC_LINK=/path/to/certificate.p12
CSC_KEY_PASSWORD=the-password
```

`electron-builder` will sign the DMG and submit it for
notarization automatically.

### Linux

Linux distributions typically don't require code signing. The
`.deb` and `.AppImage` are distributed as-is.

If you want GPG signing for the `.deb` (to enable
`apt repository` hosting), set:

```bash
DEB_SIGN_KEY=/path/to/private.key
```

---

## Reproducible builds

The build is **almost** reproducible. The same source + the same
Node version + the same Rust toolchain + the same OS produces a
byte-identical installer (modulo timestamps embedded in the
file).

To verify:

```bash
# On two different Windows machines:
git clone https://github.com/232252/education-advisor.git
cd education-advisor
git checkout v0.1.0
npm ci
npm run build:eaa    # compiles core/eaa-cli from source — requires Rust (https://rustup.rs)
npm run verify:dsh   # dsh assembly gate (also a CI step)
npm run build        # auto-runs the prebuild resource check
npm run package      # auto-runs prepackage: stages vendor/dsh-node + vendor/dsh-im deps
                     # (needs a Node on PATH and a completed npm install)

# Compare the SHA-256 of the installers
sha256sum release-v11/*.exe
```

The two should match, **except for**:

- File timestamps embedded in the zip / installer header
  (these don't affect the app's behavior).
- The signing certificate (if you sign on one machine and not
  the other).

To get a truly byte-identical installer, set the
`SOURCE_DATE_EPOCH` env var to a fixed timestamp:

```bash
export SOURCE_DATE_EPOCH=1717800000  # 2024-06-08 00:00:00 UTC
npm run package
```

---

## Troubleshooting

### `better-sqlite3` fails to build on Windows

**Error**: `node-gyp` fails with `gyp ERR! find Python` or similar.

**Fix**: install the Visual Studio Build Tools with the C++
workload (see [QUICK_START.md](./QUICK_START.md#1-prerequisites)).

### `preload not found` on launch

**Error**: in the main process log, "preload not found at
dist/main/preload.cjs".

**Fix**: run `npm run build` first. The preload script is built by its
own Vite config (`vite.config.preload.ts`, output `preload.cjs`), not
the renderer config.

### Windows SmartScreen blocks the installer

**Error**: "Windows protected your PC" dialog when launching the
installer.

**Fix**: this is expected for unsigned builds. Click "More info"
→ "Run anyway". To get rid of this for end users, sign the
installer (see [Code signing](#code-signing)).

### macOS Gatekeeper blocks the app

**Error**: "Education Advisor cannot be opened because the
developer cannot be verified".

**Fix**: this is expected for unsigned / un-notarized builds.
Right-click the app → "Open" → "Open" in the dialog. To get
rid of this, sign and notarize (see [Code signing](#code-signing)).

### `npm run build` is slow on Windows

**Error**: the first build takes 5+ minutes.

**Fix**: this is mostly the `better-sqlite3` native compilation.
Subsequent builds are fast. To speed up subsequent builds,
consider using `npm ci` to ensure the `node_modules/` cache is
consistent.

### `npm run package` fails with "cannot find icon.ico"

**Error**: "default Electron icon is used" or similar.

**Fix**: ensure `resources/icon.ico` is a valid 256x256 .ico
file. The default `resources/icon.ico` shipped with this repo
is a placeholder; replace it with your own.

### Auto-update doesn't work

**Error**: the app doesn't prompt for updates even though a
newer version is released.

**Fix**:

1. Check that the `latest.yml` (or `latest-mac.yml` /
   `latest-linux.yml`) is in the same GitHub Release as the
   installer.
2. Check that the `publish` config in `electron-builder.yml`
   points to the correct GitHub repo.
3. Check that the user's `general.autoUpdate` setting is `true`.
4. Check the Logs page in Settings for the auto-update flow.

---

## Next steps

- [DISTRIBUTION.md](./DISTRIBUTION.md) — how to ship the app to
  end users.
- [DEVELOPMENT.md](./DEVELOPMENT.md) — how to set up your dev
  environment for hacking on the app.
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — the big list of
  common issues and their fixes.
