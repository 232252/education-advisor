# Desktop build

> **How to build the desktop application from source.** This document
> covers the local dev build, the production build, the platform
> packaging, the auto-update flow, and the troubleshooting for the
> most common build issues.

## Table of contents

- [The two Vite configs](#the-two-vite-configs)
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

## The two Vite configs

The project has two Vite configs because Electron runs two
distinct processes:

| Config | Purpose | Output |
| --- | --- | --- |
| `vite.config.main.ts` | The main process (Node 22) | `dist/main/index.js` + `dist/main/preload.js` |
| `vite.config.renderer.ts` | The renderer (Chromium) | `dist/renderer/index.html` + assets |

The main-process config:

- Uses `ssr: true` and `lib.entry` to produce a CommonJS library.
- Has `format: 'cjs'` because the main process is a Node process.
- Externalizes native deps (electron, better-sqlite3, node-cron,
  chokidar, cross-spawn).
- Aliases `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core`
  to the local monorepo paths (see [DEVELOPMENT.md](./DEVELOPMENT.md)).

The renderer config:

- Uses the standard `react()` plugin.
- Has `base: './'` because Electron loads from `file://`.
- Targets `chrome130` (Electron 33's Chromium version).
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
`dist/main/index.js`.

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
# Build the main + renderer bundles
npm run build

# Output:
#   dist/main/index.js       (CommonJS)
#   dist/main/preload.js     (CommonJS)
#   dist/renderer/index.html
#   dist/renderer/assets/    (hashed JS / CSS / image filenames)
```

The build is minified for the renderer (saves ~30% on the
initial bundle) but **not** minified for the main process (to
preserve stack traces).

Source maps are produced for both. They are **not** included in
the packaged installer (saves ~5 MB) but are uploaded to Sentry
or your error tracker of choice.

---

## Windows packaging (NSIS + portable)

```bash
# Build a Windows x64 NSIS installer
npm run package

# Output:
#   release/Education Advisor-Setup-0.1.0.exe   (~85 MB, NSIS installer)
#   release/Education Advisor-0.1.0-Portable.exe  # see below

# Build a Windows x64 portable .exe
npm run package:portable

# Build a Windows x64 NSIS installer (explicit)
npm run package:installer
```

The `electron-builder.yml` config defines both targets. The
artifact filename is templated as
`${productName}-${version}-Setup.${ext}` for the NSIS installer.

### What the NSIS installer does

1. **Asks for the install location** (default: `C:\Program Files\Education Advisor`).
2. **Creates a desktop shortcut** and a start menu shortcut.
3. **Copies the app.asar** (containing `dist/main/` and
   `dist/renderer/`) to the install location.
4. **Copies `resources/eaa-binaries/`** to the install location
   (as `extraResources`).
5. **Copies `config/` and `agents/`** to the install location
   (as `extraResources`).
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

> **Note**: macOS packaging is configured in
> `electron-builder.yml` but is **not** part of the default CI
> pipeline (we have no macOS maintainer with signing keys). See
> the [DISTRIBUTION.md](./DISTRIBUTION.md) guide for the steps to
> add a macOS build.

To build locally on a Mac:

```bash
npm run package -- --mac
```

This produces:

- `release/Education Advisor-0.1.0-arm64.dmg` (Apple Silicon)
- `release/Education Advisor-0.1.0.dmg` (Intel, x64)
- `release/Education Advisor-0.1.0-mac.zip` (zip alternative for
  auto-update)

For the build to succeed you need:

- Xcode Command Line Tools: `xcode-select --install`
- An Apple Developer ID for code signing (see
  [Code signing](#code-signing))

---

## Linux packaging (deb + AppImage)

> **Note**: Linux packaging is configured in `electron-builder.yml`
> but is **not** part of the default CI pipeline (we have no
> maintainer for the Linux distribution repos). See the
> [DISTRIBUTION.md](./DISTRIBUTION.md) guide for the steps to
> enable a Linux build.

To build locally on a Linux box:

```bash
# Build a .deb (Debian / Ubuntu)
npm run package -- --linux deb

# Build an AppImage (portable)
npm run package -- --linux AppImage

# Build both
npm run package -- --linux deb AppImage
```

This produces:

- `release/Education Advisor-0.1.0.deb`
- `release/Education Advisor-0.1.0.AppImage`

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

### Update channels

The app supports three update channels (configured in Settings):

- **`stable`** (default) — only stable releases (e.g. `v0.1.5`).
- **`beta`** — release candidates and beta tags (e.g.
  `v0.2.0-beta.1`).
- **`rc`** — every release candidate.

To pin to a specific version (e.g. for a school-wide deployment),
set the channel to `stable` and use a tag-based filter in your
deployment.

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
npm run build
npm run package

# Compare the SHA-256 of release/*.exe
sha256sum release/*.exe
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
dist/main/preload.js".

**Fix**: run `npm run build` first. The preload script is built
by the main-process Vite config, not the renderer config.

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
