// Pack the stock-node DSH closure and the connection-center plugin into
// STORE zips. NSIS writes one file each; the app extracts them under userData.
//
// @deepseek-ai packages copy only the runtime dirs (package.json, lib, dist,
// locale, assets, docs, cordis.patch.yml, …), the same idea as
// csthinker/deepseek-harness-desktop scripts/build-server.mjs. Other packages
// are copied as real files (symlink targets followed) minus tests, source
// maps, and readmes. Peer-only packages such as dsh-scope are included even
// though electron-builder will not.
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { LIVE_MISSING_PEERS, hostRuntimePackages } from './lib/install-layout.mjs'
import { listZipEntries, writeStoreZip } from './lib/store-zip.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEEPSEEK_TOP = new Set([
  'package.json',
  'lib',
  'dist',
  'bin',
  'bin.js',
  'assets',
  'skills',
  'locale',
  'config',
  'cordis.patch.yml',
  'docs',
  'icon.svg',
  'references',
  'presets',
  'runtime',
  'prebuilds.json',
  'prebuilds',
])

function fail(msg) {
  console.error(`[build-dsh-archives] ${msg}`)
  process.exit(1)
}

export function includeArchivePath(packageName, rel) {
  if (!rel) return false
  const parts = rel.split('/')
  if (parts.includes('..')) return false
  if (packageName.startsWith('@deepseek-ai/')) {
    return DEEPSEEK_TOP.has(parts[0])
  }
  if (rel.includes('sharp-wasm32') || rel.includes('win32-arm64')) return false
  if (/(^|\/)(test|tests|__tests__|example|examples|__mocks__)(\/|$)/.test(rel)) return false
  if (rel.endsWith('.map') || rel.endsWith('.d.ts') || rel.endsWith('.d.mts') || rel.endsWith('.d.cts')) {
    return false
  }
  const base = parts[parts.length - 1]
  if (/^(README|CHANGELOG)/i.test(base)) return false
  if (base === '.DS_Store') return false
  return true
}

function walkFiles(dir, rel, packageName, out) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    const abs = join(dir, name)
    const next = rel ? `${rel}/${name}` : name
    if (!includeArchivePath(packageName, next)) continue
    let st
    try {
      st = lstatSync(abs)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) {
      let target
      try {
        target = statSync(abs)
      } catch {
        continue
      }
      if (target.isDirectory()) walkFiles(abs, next, packageName, out)
      else if (target.isFile()) out.push({ abs, rel: next, mode: target.mode & 0o777 })
      continue
    }
    if (st.isDirectory()) walkFiles(abs, next, packageName, out)
    else if (st.isFile()) out.push({ abs, rel: next, mode: st.mode & 0o777 })
  }
}

export function collectPackageEntries(root, packageName) {
  const dir = join(root, 'node_modules', ...packageName.split('/'))
  if (!existsSync(join(dir, 'package.json'))) return []
  const files = []
  walkFiles(dir, '', packageName, files)
  const prefix = `node_modules/${packageName}`
  return files.map((file) => ({
    name: `${prefix}/${file.rel}`,
    abs: file.abs,
    mode: file.mode & 0o111 ? file.mode : 0o644,
  }))
}

function readLock() {
  return JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
}

function sha256File(path) {
  const hash = createHash('sha256')
  hash.update(readFileSync(path))
  return hash.digest('hex')
}

function writeZip(entries, outPath) {
  if (entries.length > 0xffff) fail(`${outPath} has ${entries.length} files (classic zip limit)`)
  const payload = entries.map((entry) => ({
    name: entry.name,
    data: readFileSync(entry.abs ?? entry.dataPath),
    mode: entry.mode,
  }))
  mkdirSync(dirname(outPath), { recursive: true })
  writeStoreZip(outPath, payload)
}

function stageImDeps() {
  const marker = join(ROOT, 'vendor', 'dsh-im', 'node_modules', 'qrcode', 'package.json')
  if (existsSync(marker)) return
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts', 'stage-dsh-im-deps.mjs')], {
    stdio: 'inherit',
  })
  if (result.status !== 0) fail('stage-dsh-im-deps failed')
}

function collectTree(dir, prefix, packageName) {
  const files = []
  walkFiles(dir, '', packageName, files)
  return files.map((file) => ({
    name: prefix ? `${prefix}/${file.rel}` : file.rel,
    abs: file.abs,
    mode: file.mode & 0o111 ? file.mode : 0o644,
  }))
}

function buildRuntimeZip() {
  const lock = readLock()
  const names = [...hostRuntimePackages(lock)].sort()
  const entries = []
  const packed = []
  const missingRequired = []
  for (const name of names) {
    const part = collectPackageEntries(ROOT, name)
    if (part.length === 0) {
      if (LIVE_MISSING_PEERS.includes(name)) missingRequired.push(name)
      continue
    }
    entries.push(...part)
    packed.push(name)
  }
  if (missingRequired.length > 0) {
    fail(`required peer packages are not on disk: ${missingRequired.join(', ')}`)
  }
  const outDir = join(ROOT, 'build', 'dsh-runtime')
  const asset = 'dsh-runtime.zip'
  const outPath = join(outDir, asset)
  writeZip(entries, outPath)
  const namesInZip = new Set(listZipEntries(outPath))
  for (const peer of LIVE_MISSING_PEERS) {
    const marker = `node_modules/${peer}/package.json`
    if (!namesInZip.has(marker)) fail(`runtime zip is missing ${marker}`)
  }
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  const manifest = {
    asset,
    sha256: sha256File(outPath),
    bytes: statSync(outPath).size,
    version,
    files: entries.length,
    packages: packed,
  }
  writeFileSync(join(ROOT, 'config', 'dsh-runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `[build-dsh-archives] dsh-runtime ${packed.length} packages / ${entries.length} files / ${(manifest.bytes / 1024 / 1024).toFixed(1)}MB store`,
  )
}

function buildImZip() {
  stageImDeps()
  const src = join(ROOT, 'vendor', 'dsh-im')
  if (!existsSync(join(src, 'package.json'))) fail(`missing ${src}`)
  const entries = collectTree(src, '', '@xmanrui/dsh-im')
  const outDir = join(ROOT, 'build', 'dsh-im')
  const asset = 'dsh-im.zip'
  const outPath = join(outDir, asset)
  writeZip(entries, outPath)
  const namesInZip = new Set(listZipEntries(outPath))
  if (!namesInZip.has('package.json')) fail('dsh-im zip is missing package.json')
  if (!namesInZip.has('node_modules/qrcode/package.json')) {
    fail('dsh-im zip is missing node_modules/qrcode/package.json')
  }
  if (!namesInZip.has('integrations/eaa-panel/package.json')) {
    fail('dsh-im zip is missing integrations/eaa-panel/package.json')
  }
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  const manifest = {
    asset,
    sha256: sha256File(outPath),
    bytes: statSync(outPath).size,
    version,
    files: entries.length,
  }
  writeFileSync(join(ROOT, 'config', 'dsh-im.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `[build-dsh-archives] dsh-im ${entries.length} files / ${(manifest.bytes / 1024 / 1024).toFixed(1)}MB store`,
  )
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  return fileURLToPath(import.meta.url) === resolve(entry)
}

if (isDirectRun()) {
  buildRuntimeZip()
  buildImZip()
}
