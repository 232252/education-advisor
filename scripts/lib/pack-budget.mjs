// Byte ceilings and pack-invocation rules for the desktop installer.
//
// The numbers are decimal bytes (1 MB = 1_000_000), the same scale used
// when the measured Setup files were discussed. A clean teacher pack is
// near 287 MB. The hard fail is 310 MB, still under the older ~323 MB
// loose-file layout and well under the ~370 MB toolchain layout.
//
// Bump SETUP_MAX_BYTES or RUNTIME_ZIP_MAX_BYTES only when a real feature
// grows the pack. In the same change: update docs/INSTALLER_PACKING.md,
// update the equality assertions in tests/main/pack-budget.test.ts, and
// paste the new component inventory. Do not raise the ceiling to accept
// a tree that still contains pnpm, a STORE zip that was deflated first,
// or an unpacked directory left by an older pack.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { firstZipMethod, listZipEntries } from './store-zip.mjs'

export const SETUP_MAX_BYTES = 310_000_000
export const RUNTIME_ZIP_MAX_BYTES = 200_000_000

const DOWNLOAD_MARKERS = [
  'etimedout',
  'econnreset',
  'econnrefused',
  'enotfound',
  'eai_again',
  'socket hang up',
  'cannot download',
  'error downloading',
  'download failed',
  'network timeout',
  'connect timed out',
]

export function toolchainZipHits(entries) {
  return [...entries].filter(
    (name) =>
      name === 'node_modules/pnpm' ||
      name.startsWith('node_modules/pnpm/') ||
      name.startsWith('node_modules/@pnpm/exe'),
  )
}

export function evaluateRuntimeArchive({ bytes, entries, method }) {
  const failures = []
  const hits = entries ? toolchainZipHits(entries) : []
  if (method !== 0) {
    failures.push(`dsh-runtime.zip compression method is ${method}; STORE (0) is required`)
  }
  if (typeof bytes !== 'number' || bytes < 1) {
    failures.push('dsh-runtime.zip size is missing')
  } else if (bytes > RUNTIME_ZIP_MAX_BYTES) {
    failures.push(`dsh-runtime.zip is ${bytes} bytes, over the ${RUNTIME_ZIP_MAX_BYTES} byte budget`)
  }
  if (!entries) failures.push('dsh-runtime.zip entry list is missing')
  else if (hits.length > 0) {
    failures.push(`dsh-runtime.zip contains pnpm / @pnpm/exe: ${hits.slice(0, 8).join(', ')}`)
  }
  return { ok: failures.length === 0, failures, hits }
}

export function evaluateStoreMethod(label, method) {
  if (method !== 0) {
    return {
      ok: false,
      failures: [`${label} compression method is ${method}; STORE (0) is required`],
    }
  }
  return { ok: true, failures: [] }
}

export function evaluateSetupBytes(bytes) {
  if (typeof bytes !== 'number' || bytes < 1) {
    return { ok: false, failures: ['Setup.exe size is missing'] }
  }
  if (bytes > SETUP_MAX_BYTES) {
    return {
      ok: false,
      failures: [`Setup.exe is ${bytes} bytes, over the ${SETUP_MAX_BYTES} byte budget`],
    }
  }
  return { ok: true, failures: [] }
}

export function logInventory(stage, rows) {
  for (const row of rows) {
    const limit = row.limit == null ? '' : ` limit=${row.limit}`
    const extra = row.extra ? ` ${row.extra}` : ''
    console.log(`[pack-inventory] stage=${stage} ${row.label} bytes=${row.bytes}${limit}${extra}`)
  }
}

export function readDirectoriesOutput(ymlText) {
  const lines = ymlText.split(/\r?\n/)
  let inDirectories = false
  for (const line of lines) {
    if (/^directories:/.test(line)) {
      inDirectories = true
      continue
    }
    if (inDirectories && /^[^\s#]/.test(line)) break
    const match = line.match(/^\s+output:\s*(\S+)\s*$/)
    if (inDirectories && match) return match[1]
  }
  return null
}

export function isStaleUnpackedName(name) {
  return /^(win|linux)(-[A-Za-z0-9_]+)?-unpacked$/.test(name) || /^mac(-[A-Za-z0-9_]+)?$/.test(name)
}

export function staleUnpackedDirs(outputDir, fs = { existsSync, readdirSync, statSync }) {
  if (!fs.existsSync(outputDir)) return []
  const found = []
  for (const name of fs.readdirSync(outputDir)) {
    if (!isStaleUnpackedName(name)) continue
    const target = join(outputDir, name)
    let st
    try {
      st = fs.statSync(target)
    } catch {
      continue
    }
    if (st.isDirectory()) found.push(target)
  }
  return found
}

/** Delete unpacked app dirs before electron-builder. Never deletes Setup.exe. */
export function removeStaleUnpacked(outputDir) {
  const removed = []
  const errors = []
  for (const target of staleUnpackedDirs(outputDir)) {
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        rmSync(target, { recursive: true, force: true })
        lastError = null
        break
      } catch (err) {
        lastError = err
      }
    }
    if (lastError) errors.push(`${target}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
    else removed.push(target)
  }
  return { removed, errors }
}

export function unsafePackArgs(args) {
  const bad = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const next = args[i + 1]
    if (arg === '--prepackaged' || arg === '--pd' || arg.startsWith('--prepackaged=') || arg.startsWith('--pd=')) {
      bad.push(arg)
    }
    if ((arg === '-c' || arg === '--config') && typeof next === 'string' && /compression\s*[:=]\s*store|-mx=0/.test(next)) {
      bad.push(`${arg} ${next}`)
      i += 1
      continue
    }
    if (/compression\s*[:=]\s*store|-mx=0/.test(arg)) bad.push(arg)
  }
  return bad
}

export function compressionLevelBlocked(value) {
  return value === '0'
}

/** Drop any caller publish policy and pin never. Upload happens after the gate. */
export function withPublishNever(args) {
  const kept = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--publish') {
      i += 1
      continue
    }
    if (arg.startsWith('--publish=')) continue
    kept.push(arg)
  }
  kept.push('--publish', 'never')
  return kept
}

export function packWantsWindows(args) {
  if (args.some((arg) => arg === '--win' || arg === '--windows' || arg === '-w' || arg === 'nsis' || arg === 'portable')) {
    return true
  }
  const mentionsOther = args.some((arg) =>
    ['--mac', '--macos', '-m', '-o', '--linux', '-l'].includes(arg),
  )
  if (mentionsOther) return false
  return process.platform === 'win32'
}

export function isPackFailureFromThisPack(log) {
  return log.includes('[pack-budget] FAIL') || log.includes('[after-pack-trim]')
}

export function isElectronDownloadFailure(log) {
  const text = log.toLowerCase()
  return DOWNLOAD_MARKERS.some((marker) => text.includes(marker))
}

export function shouldRetryPack(log) {
  if (isPackFailureFromThisPack(log)) return false
  return isElectronDownloadFailure(log)
}

function pushRow(rows, label, bytes, extra, limit) {
  rows.push({ label, bytes, extra, ...(limit == null ? {} : { limit }) })
}

export function inspectResources(resourcesDir, { requireComplete = false } = {}) {
  const rows = []
  const failures = []
  const runtime = join(resourcesDir, 'dsh-runtime', 'dsh-runtime.zip')
  if (!existsSync(runtime)) {
    failures.push(`missing ${runtime}`)
  } else {
    const bytes = statSync(runtime).size
    const method = firstZipMethod(runtime)
    let entries = null
    try {
      entries = listZipEntries(runtime)
    } catch (err) {
      failures.push(`dsh-runtime.zip cannot be listed: ${err instanceof Error ? err.message : String(err)}`)
    }
    pushRow(rows, 'dsh-runtime.zip', bytes, `method=${method} path=${runtime}`, RUNTIME_ZIP_MAX_BYTES)
    failures.push(...evaluateRuntimeArchive({ bytes, entries, method }).failures)
  }

  const im = join(resourcesDir, 'dsh-im', 'dsh-im.zip')
  if (!existsSync(im)) {
    failures.push(`missing ${im}`)
  } else {
    const bytes = statSync(im).size
    const method = firstZipMethod(im)
    pushRow(rows, 'dsh-im.zip', bytes, `method=${method} path=${im}`)
    failures.push(...evaluateStoreMethod('dsh-im.zip', method).failures)
  }

  const asar = join(resourcesDir, 'app.asar')
  if (!existsSync(asar)) {
    failures.push(`missing ${asar}`)
  } else {
    pushRow(rows, 'app.asar', statSync(asar).size, `path=${asar}`)
  }

  const kitDir = join(resourcesDir, 'office-kit')
  const kits = existsSync(kitDir) ? readdirSync(kitDir).filter((name) => name.endsWith('.zip')) : []
  if (requireComplete && kits.length !== 1) {
    failures.push(`office-kit zip count is ${kits.length}; expected 1 under ${kitDir}`)
  }
  for (const name of kits) {
    const path = join(kitDir, name)
    pushRow(rows, 'office-kit', statSync(path).size, `method=${firstZipMethod(path)} path=${path}`)
  }
  return { rows, failures }
}

export function findPackagedResourceDirs(outputDir) {
  if (!existsSync(outputDir)) return []
  const found = []
  for (const name of readdirSync(outputDir)) {
    const platformDir = join(outputDir, name)
    let st
    try {
      st = statSync(platformDir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const direct = join(platformDir, 'resources')
    if (existsSync(join(direct, 'app.asar')) || existsSync(join(direct, 'dsh-runtime', 'dsh-runtime.zip'))) {
      found.push(direct)
    }
    let children = []
    try {
      children = readdirSync(platformDir)
    } catch {
      continue
    }
    for (const child of children) {
      if (!child.endsWith('.app')) continue
      const resources = join(platformDir, child, 'Contents', 'Resources')
      if (existsSync(resources)) found.push(resources)
    }
  }
  return found
}

function isWindowsResources(resourcesDir) {
  const parent = basename(resolve(resourcesDir, '..'))
  return parent === 'win-unpacked' || /^win(-[A-Za-z0-9_]+)?-unpacked$/.test(parent)
}

export function evaluateOutput({ outputDir, artifactPaths = [], requireSetup = false }) {
  const rows = []
  const failures = []
  const seenSetup = new Set()
  const setupCandidates = []
  for (const artifact of artifactPaths) {
    if (artifact.toLowerCase().endsWith('.exe')) setupCandidates.push(artifact)
  }
  const canonical = join(outputDir, 'Education-Advisor-Setup.exe')
  if (existsSync(canonical)) setupCandidates.push(canonical)
  if (requireSetup && setupCandidates.length === 0) {
    failures.push(`missing ${canonical}`)
  }
  for (const artifact of setupCandidates) {
    const key = resolve(artifact)
    if (seenSetup.has(key)) continue
    seenSetup.add(key)
    if (!existsSync(artifact)) {
      failures.push(`missing ${artifact}`)
      continue
    }
    const bytes = statSync(artifact).size
    pushRow(rows, 'Setup.exe', bytes, `path=${artifact}`, SETUP_MAX_BYTES)
    failures.push(...evaluateSetupBytes(bytes).failures)
  }

  const resourceDirs = findPackagedResourceDirs(outputDir)
  const winDirs = resourceDirs.filter(isWindowsResources)
  if (requireSetup && winDirs.length === 0) {
    failures.push(`missing ${join(outputDir, 'win-unpacked', 'resources')}`)
  }
  for (const resourcesDir of resourceDirs) {
    const report = inspectResources(resourcesDir, { requireComplete: isWindowsResources(resourcesDir) })
    rows.push(...report.rows)
    failures.push(...report.failures)
  }
  return { ok: failures.length === 0, failures, rows }
}
