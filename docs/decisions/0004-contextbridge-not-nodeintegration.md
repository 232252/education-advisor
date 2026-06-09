# 0004 — contextBridge, not nodeIntegration

**Status**: Accepted
**Date**: 2026-06-09
**Authors**: The maintainer team

## Context

Electron has two security models for the renderer:

- **The old model** (pre-2020): `nodeIntegration: true`,
  `contextIsolation: false`. The renderer has full Node.js
  access. The UI code can do `require('fs')`, `require('child_process')`,
  etc.
- **The new model** (post-2020): `nodeIntegration: false`,
  `contextIsolation: true`. The renderer is a sandboxed
  Chromium tab with no Node access. The main process exposes a
  typed `window.api` via `contextBridge`.

The old model is simpler to develop against but **insecure by
default**. Any XSS in the renderer (e.g. via a malicious LLM
response that contains a `<script>` tag) gives the attacker full
access to the user's machine.

## Decision

We use the **new model**:

```typescript
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,  // we need the preload bridge
  },
})
```

The renderer can only call the methods exposed on `window.api` by
the `contextBridge` in `src/main/preload/index.ts`. There are
**90+** IPC channels, each with a typed signature and a JSDoc
comment explaining what it does.

The renderer is also defended in depth:

- `webContents.on('will-navigate')` blocks in-app navigation.
- `setWindowOpenHandler` routes all `window.open` calls to the
  system browser.
- `app.commandLine.appendSwitch('remote-allow-origins', ...)` when
  CDP is enabled, prevents remote access from non-localhost
  origins.

## Rationale

- **Security**: the renderer is the surface area most likely to
  be attacked (via XSS, prompt injection, malicious LLM
  responses). The new model contains the blast radius.
- **Defense in depth**: even if the renderer is compromised, the
  attacker can only call the methods on `window.api`, each of
  which is a specific IPC channel with input validation.
- **Standard practice**: the new model is the default in modern
  Electron, and all the official documentation assumes it.

## Consequences

- **Good**: strong security baseline.
- **Good**: clear separation between the renderer code and the
  main process code.
- **Bad**: more boilerplate. Every new IPC channel requires
  changes in three places: the shared constants, the main
  process handler, and the preload bridge.
- **Bad**: the renderer can't `require('fs')` directly, which
  is a common gotcha for developers coming from a web
  background.

## Alternatives considered

- **Old model (`nodeIntegration: true`)**: rejected for security.
- **`sandbox: true`**: considered, but the preload script needs
  to be able to use `ipcRenderer`, which requires
  `sandbox: false`. We're keeping the preload bridge.

## References

- [`ARCHITECTURE.md#renderer-hardening`](../ARCHITECTURE.md) — the
  full security posture
- [`SECURITY.md`](../SECURITY.md) — the security policy
