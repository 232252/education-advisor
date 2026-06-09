#!/usr/bin/env node
// =============================================================
// scripts/analyze-links.mjs
//
// Static link analysis: walks the source tree and reports which
// IPC channels are defined, which are registered, and which are
// bridged (preload invoke) / subscribed (preload on).
//
// Exits non-zero on missing handlers (i.e. defined channels
// without a corresponding ipcMain.handle).
//
// Usage:
//   node scripts/analyze-links.mjs [--json] [--strict]
// =============================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname || __dirname, '..')
const SRC = join(ROOT, 'src')
const DEFINED_FILE = join(SRC, 'shared', 'ipc-channels.ts')

const args = process.argv.slice(2)
const JSON = args.includes('--json')
const STRICT = args.includes('--strict')

// ---- Load the canonical channel definitions ----
function loadDefined() {
  if (!existsSync(DEFINED_FILE)) {
    console.error(`No ipc-channels.ts at ${DEFINED_FILE}`)
    process.exit(1)
  }

  const src = readFileSync(DEFINED_FILE, 'utf8')
  // Match: export const IPC_X = 'foo:bar'
  const defined = new Map()
  const re = /export const (IPC_[A-Z0-9_]+)\s*=\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(src)) !== null) {
    defined.set(m[1], m[2])
  }
  return defined
}

// ---- Walk the source tree ----
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) {
      out.push(...walk(p))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

// ---- Find all IPC channel references in the source ----
function findReferences(files) {
  const refs = {
    handlers: new Map(),    // channel name -> [files that handle it]
    invoke: new Map(),      // channel name -> [files that invoke it]
    on: new Map(),          // channel name -> [files that listen on it]
    send: new Map(),        // channel name -> [files that send to it]
  }

  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    const rel = file.replace(ROOT + '\\', '').replace(ROOT + '/', '')

    // Match ipcMain.handle('channel:foo', ...)
    for (const m of content.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)) {
      addToMap(refs.handlers, m[1], rel)
    }
    // Match ipcMain.on('channel:foo', ...)
    for (const m of content.matchAll(/ipcMain\.on\(\s*['"]([^'"]+)['"]/g)) {
      addToMap(refs.on, m[1], rel)
    }
    // Match ipcRenderer.invoke('channel:foo', ...)
    for (const m of content.matchAll(/ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g)) {
      addToMap(refs.invoke, m[1], rel)
    }
    // Match ipcRenderer.on('channel:foo', ...)
    for (const m of content.matchAll(/ipcRenderer\.on\(\s*['"]([^'"]+)['"]/g)) {
      addToMap(refs.on, m[1], rel)
    }
    // Match ipcRenderer.send('channel:foo', ...)
    for (const m of content.matchAll(/ipcRenderer\.send\(\s*['"]([^'"]+)['"]/g)) {
      addToMap(refs.send, m[1], rel)
    }
  }

  return refs
}

function addToMap(map, key, val) {
  if (!map.has(key)) map.set(key, [])
  map.get(key).push(val)
}

// ---- Main ----
const defined = loadDefined()
const files = walk(SRC)
const refs = findReferences(files)

const report = []
const missing = []

for (const [constName, channel] of defined) {
  const handlers = refs.handlers.get(channel) || []
  const invoke = refs.invoke.get(channel) || []
  const on = refs.on.get(channel) || []
  const send = refs.send.get(channel) || []

  // A channel is "wired" if it has either a handler (request/response)
  // or an .on (push event) registered.
  // Channels used only with .send / .invoke (from the renderer side)
  // and no handler are "unwired" — a bug.
  const isEventChannel = /:(status-update|stream|update|event|notification)$/i.test(channel)
  const isWired = handlers.length > 0 || on.length > 0 || isEventChannel

  report.push({
    const: constName,
    channel,
    handlers,
    invoke,
    on,
    send,
    wired: isWired,
  })

  if (!isWired) {
    missing.push({ const: constName, channel })
  }
}

if (JSON) {
  console.log(JSON.stringify({ report, missing }, null, 2))
} else {
  // Pretty-print
  console.log(`IPC channel link analysis`)
  console.log(`=========================`)
  console.log(`Defined:   ${defined.size} channels`)
  console.log(`Wired:     ${report.length - missing.length} channels`)
  console.log(`Unwired:   ${missing.length} channels`)
  console.log()

  if (missing.length > 0) {
    console.log(`UNWIRED CHANNELS:`)
    for (const m of missing) {
      console.log(`  ${m.channel.padEnd(40)} (${m.const})`)
    }
    console.log()
  }

  // Print a summary table
  console.log(`CHANNEL`.padEnd(42) + `HANDLER`.padEnd(8) + `INVOKE`.padEnd(8) + `ON`.padEnd(8) + `SEND`.padEnd(8))
  console.log('-'.repeat(74))
  for (const r of report) {
    console.log(
      r.channel.padEnd(42) +
      String(r.handlers.length).padEnd(8) +
      String(r.invoke.length).padEnd(8) +
      String(r.on.length).padEnd(8) +
      String(r.send.length).padEnd(8),
    )
  }
}

if (STRICT && missing.length > 0) {
  process.exit(1)
}
