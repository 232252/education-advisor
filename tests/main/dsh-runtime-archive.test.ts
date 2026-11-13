import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureExtractedArchive } from '../../src/main/services/dsh/bundled-archive'
import {
  LIVE_MISSING_PEERS,
  RUNTIME_REQUIRED_PACKAGES,
  dependencyShipSet,
  filesToExclude,
  indexLock,
  runtimeArchivePackages,
  walkPackages,
} from '../../scripts/lib/install-layout.mjs'
import { listZipEntries, writeStoreZip } from '../../scripts/lib/store-zip.mjs'

const root = join(import.meta.dirname, '../..')
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, unknown>
}
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

describe('dsh runtime closure', () => {
  it('15 个线上缺失的 peer 在闭包里，但不在 electron-builder 的 dependencies 遍历里', () => {
    const archive = runtimeArchivePackages(lock)
    const ship = dependencyShipSet(lock)
    for (const name of LIVE_MISSING_PEERS) {
      expect(archive.has(name), name).toBe(true)
      expect(ship.has(name), name).toBe(false)
    }
    const excluded = filesToExclude(lock)
    for (const name of LIVE_MISSING_PEERS) expect(excluded).toContain(name)
    expect(excluded).not.toContain('better-sqlite3')
    expect(excluded).not.toContain('pdfjs-dist')
    expect(excluded).not.toContain('@napi-rs/canvas')
    expect(excluded).not.toContain('cross-spawn')
    expect(excluded).not.toContain('debug')
    expect(excluded).not.toContain('js-yaml')
    expect(excluded).not.toContain('semver')
    expect(archive.has('pnpm')).toBe(false)
    for (const name of archive) {
      expect(name.startsWith('@deepseek-ai/libreoffice-kit'), name).toBe(false)
    }
    for (const name of archive) {
      expect(name.startsWith('@pnpm/exe'), name).toBe(false)
    }
    expect(excluded).toContain('pnpm')
    expect(excluded.some((name) => name.startsWith('@pnpm/exe'))).toBe(true)
    expect(excluded.length).toBeGreaterThan(400)
  })

  it('vendored pi-ai lock link still pulls pi-telemetry into the runtime closure', () => {
    const archive = runtimeArchivePackages(lock)
    const piAi = indexLock(lock).get('@earendil-works/pi-ai') as { dependencies?: Record<string, string> } | undefined
    expect(piAi?.dependencies?.['@earendil-works/pi-telemetry']).toBeTruthy()
    for (const name of RUNTIME_REQUIRED_PACKAGES) {
      expect(archive.has(name), name).toBe(true)
    }
    expect(archive.has('@earendil-works/pi-ai')).toBe(true)
  })

  it('asar 里留下的包，其 dependencies 不能被排除', () => {
    const excluded = new Set(filesToExclude(lock))
    const resident = [...dependencyShipSet(lock)].filter((name) => !excluded.has(name))
    const needed = walkPackages(indexLock(lock), resident, { peers: false })
    for (const name of needed) {
      expect(excluded.has(name), name).toBe(false)
    }
  })
})

describe('store zip and first-launch extract', () => {
  it('STORE zip 能解出来，sha 没变时第二次不重写', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eaa-zip-'))
    dirs.push(dir)
    const zipPath = join(dir, 'bundle.zip')
    writeStoreZip(zipPath, [
      { name: 'node_modules/@deepseek-ai/dsh-scope/package.json', data: Buffer.from('{"name":"x"}\n'), mode: 0o644 },
      { name: 'node_modules/@deepseek-ai/dsh/lib/bin.js', data: Buffer.from('#!/usr/bin/env node\n'), mode: 0o755 },
    ])
    expect(listZipEntries(zipPath)).toEqual([
      'node_modules/@deepseek-ai/dsh-scope/package.json',
      'node_modules/@deepseek-ai/dsh/lib/bin.js',
    ])
    const manifestPath = join(dir, 'manifest.json')
    const sha = (await import('node:crypto')).createHash('sha256').update(readFileSync(zipPath)).digest('hex')
    writeFileSync(
      manifestPath,
      JSON.stringify({ asset: 'bundle.zip', sha256: sha, bytes: statSync(zipPath).size }),
    )
    const dest = join(dir, 'out')
    const marker = join('node_modules', '@deepseek-ai', 'dsh-scope', 'package.json')
    const first = await ensureExtractedArchive({
      manifestPath,
      zipDir: dir,
      destDir: dest,
      marker,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.skipped).toBe(false)
    const markerPath = join(dest, marker)
    const mtime = statSync(markerPath).mtimeMs
    const second = await ensureExtractedArchive({
      manifestPath,
      zipDir: dir,
      destDir: dest,
      marker,
    })
    expect(second.ok && second.skipped).toBe(true)
    expect(statSync(markerPath).mtimeMs).toBe(mtime)
  })
})
