#!/usr/bin/env node
// The only supported way to invoke electron-builder for a release pack.
//
// Before every attempt, including the one retry after an Electron download
// timeout, this deletes <directories.output>/*-unpacked and mac* so NSIS
// cannot 7z a tree left by an older pack. It never passes --prepackaged.
// It forces --publish never. The release workflow uploads the installer
// only after scripts/check-pack-budget.mjs has passed.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compressionLevelBlocked,
  evaluateOutput,
  logInventory,
  packWantsWindows,
  readDirectoriesOutput,
  removeStaleUnpacked,
  shouldRetryPack,
  unsafePackArgs,
  withPublishNever,
} from './lib/pack-budget.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function fail(message) {
  console.error(`[pack] ${message}`)
  process.exit(1)
}

function resolveBuilderCli() {
  const candidates = [
    'electron-builder/cli.js',
    'electron-builder/out/cli.js',
  ]
  for (const id of candidates) {
    try {
      return require.resolve(id)
    } catch {
      // try the next layout
    }
  }
  return null
}

function runBuilder(cli, args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    let tail = ''
    const capture = (chunk, stream) => {
      const text = chunk.toString()
      stream.write(text)
      tail = (tail + text).slice(-64_000)
    }
    child.stdout.on('data', (chunk) => capture(chunk, process.stdout))
    child.stderr.on('data', (chunk) => capture(chunk, process.stderr))
    child.on('close', (code) => resolveRun({ code: code ?? 1, tail }))
  })
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

const userArgs = process.argv.slice(2)
const unsafe = unsafePackArgs(userArgs)
if (unsafe.length > 0) {
  fail(
    `refusing ${unsafe.join(', ')}. Delete the unpacked directory and re-run the current afterPack. Do not pack an unknown tree, and do not turn the 7z payload into an uncompressed archive.`,
  )
}
if (compressionLevelBlocked(process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL)) {
  fail('refusing ELECTRON_BUILDER_COMPRESSION_LEVEL=0. The NSIS payload stays at the default 7z level.')
}

const ymlPath = join(ROOT, 'electron-builder.yml')
const yml = readFileSync(ymlPath, 'utf8')
if (yml.includes('compression: store') || yml.includes('-mx=0')) {
  fail('electron-builder.yml disables installer compression. Restore the default 7z level.')
}
const outputName = readDirectoriesOutput(yml)
if (!outputName) fail('electron-builder.yml has no directories.output')
const outputDir = join(ROOT, outputName)
const wantsWindows = packWantsWindows(userArgs)

for (const relative of ['build/dsh-runtime/dsh-runtime.zip', 'build/dsh-im/dsh-im.zip']) {
  if (!existsSync(join(ROOT, relative))) {
    fail(`missing ${relative}. Run npm run prepackage before electron-builder.`)
  }
}
if (wantsWindows) {
  const kitDir = join(ROOT, 'build', 'office-kit')
  const kits = existsSync(kitDir) ? readdirSync(kitDir).filter((name) => name.endsWith('.zip')) : []
  if (kits.length !== 1) {
    fail(`build/office-kit must contain exactly one zip before a Windows pack (found ${kits.length}). Run npm run prepackage.`)
  }
}

const builderArgs = [...userArgs]
if (process.env.EA_ELECTRON_DIST) {
  builderArgs.push(`-c.electronDist=${process.env.EA_ELECTRON_DIST}`)
}
const finalArgs = withPublishNever(builderArgs)
console.log('[pack] publish during electron-builder is disabled; upload happens after the size gate')

const cli = resolveBuilderCli()
if (!cli) fail('electron-builder is not installed. Run npm ci.')

const retryEnabled = process.env.EA_PACK_RETRY !== '0'
const retryWait = Number(process.env.EA_PACK_RETRY_WAIT_MS ?? 60_000)

async function attempt(label) {
  const cleaned = removeStaleUnpacked(outputDir)
  for (const dir of cleaned.removed) console.log(`[pack] removed stale unpacked tree ${dir}`)
  if (cleaned.errors.length > 0) {
    fail(
      `could not delete the unpacked tree, so this attempt would risk 7z-ing it: ${cleaned.errors.join('; ')}. Close Education Advisor and run again. Do not pass a prepackaged directory.`,
    )
  }
  console.log(`[pack] electron-builder ${label}`)
  return runBuilder(cli, finalArgs)
}

let result = await attempt('attempt 1')
if (result.code !== 0 && retryEnabled && shouldRetryPack(result.tail)) {
  const waitMs = Number.isFinite(retryWait) && retryWait > 0 ? retryWait : 0
  console.error(
    `[pack] Electron download failed. Deleting the unpacked tree and retrying once in ${waitMs / 1000}s. afterPack will run again. Not packing an existing directory.`,
  )
  if (waitMs > 0) await sleep(waitMs)
  result = await attempt('attempt 2')
}

if (result.code !== 0) process.exit(result.code)

const report = evaluateOutput({
  outputDir,
  requireSetup: wantsWindows,
})
logInventory('pack', report.rows)
if (!report.ok) {
  for (const failure of report.failures) console.error(`[pack-budget] FAIL ${failure}`)
  process.exit(1)
}
console.log('[pack-budget] ok')
