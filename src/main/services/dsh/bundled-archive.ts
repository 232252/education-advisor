// Extract a STORE zip shipped under resources/ into userData.
//
// Electron 45.0.0 is not a fingerprint dsh 0.2.2-rc.1 accepts, so the child
// stays on the staged node.exe and cannot read app.asar. The install copies
// one zip; the first launch (or the startup warmup) expands it to a real
// directory. A matching sha256 stamp skips that rewrite on later launches
// and on upgrades that did not change the archive.
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface BundledArchiveManifest {
  asset: string
  sha256: string
  bytes: number
  version?: string
}

export interface EnsureArchiveOptions {
  manifestPath: string
  zipDir: string
  destDir: string
  /** Path relative to destDir that must exist once the archive is usable. */
  marker: string
}

export type EnsureArchiveResult =
  | { ok: true; root: string; skipped: boolean }
  | { ok: false; error: string }

const inflight = new Map<string, Promise<EnsureArchiveResult>>()

function stampPath(destDir: string): string {
  return `${destDir}.sha256`
}

function readManifest(path: string): BundledArchiveManifest | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as BundledArchiveManifest
    if (raw?.asset && raw.sha256 && raw.bytes > 0) return raw
    return null
  } catch {
    return null
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function dshRuntimeBin(root: string): string | undefined {
  const manifestPath = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    bin?: string | Record<string, string>
  }
  const bin = typeof manifest.bin === 'object' ? manifest.bin?.dsh : manifest.bin
  if (typeof bin !== 'string' || !bin) return undefined
  const entry = join(root, 'node_modules', '@deepseek-ai', 'dsh', bin)
  return existsSync(entry) ? entry : undefined
}

export function dshSdkEntry(root: string): string | undefined {
  const entry = join(root, 'node_modules', '@deepseek-ai', 'dsh-sdk-client', 'lib', 'index.js')
  return existsSync(entry) ? entry : undefined
}

let runtimeGate: Promise<void> = Promise.resolve()
let imGate: Promise<string | undefined> = Promise.resolve(undefined)

export function setDshRuntimeGate(pending: Promise<void>): void {
  runtimeGate = pending.then(
    () => undefined,
    () => undefined,
  )
}

export function waitForDshRuntime(): Promise<void> {
  return runtimeGate
}

export function setDshImGate(pending: Promise<string | undefined>): void {
  imGate = pending
}

export function waitForDshImRoot(): Promise<string | undefined> {
  return imGate
}

export function ensureExtractedArchive(opts: EnsureArchiveOptions): Promise<EnsureArchiveResult> {
  const existing = inflight.get(opts.destDir)
  if (existing) return existing
  const pending = extractArchive(opts).finally(() => {
    inflight.delete(opts.destDir)
  })
  inflight.set(opts.destDir, pending)
  return pending
}

async function extractArchive(opts: EnsureArchiveOptions): Promise<EnsureArchiveResult> {
  const manifest = readManifest(opts.manifestPath)
  if (!manifest) return { ok: false, error: `缺少组件清单 ${opts.manifestPath}` }
  const zipPath = join(opts.zipDir, manifest.asset)
  if (!existsSync(zipPath)) return { ok: false, error: `缺少组件压缩包 ${zipPath}` }
  const marker = join(opts.destDir, opts.marker)
  try {
    if (
      readFileSync(stampPath(opts.destDir), 'utf8').trim() === manifest.sha256 &&
      existsSync(marker)
    ) {
      return { ok: true, root: opts.destDir, skipped: true }
    }
  } catch {
    /* stamp missing: extract */
  }
  const actual = sha256File(zipPath)
  if (actual !== manifest.sha256) {
    return { ok: false, error: '组件压缩包校验失败，请重新安装应用' }
  }
  const staging = join(tmpdir(), `eaa-archive-${process.pid}-${Date.now()}`)
  try {
    mkdirSync(staging, { recursive: true })
    const { default: extractZip } = await import('extract-zip')
    await extractZip(zipPath, { dir: staging })
    const stagedMarker = join(staging, opts.marker)
    if (!existsSync(stagedMarker)) {
      return { ok: false, error: `组件包结构异常（缺 ${opts.marker}）` }
    }
    rmSync(opts.destDir, { recursive: true, force: true })
    mkdirSync(dirname(opts.destDir), { recursive: true })
    try {
      renameSync(staging, opts.destDir)
    } catch (err) {
      const code = err instanceof Error && 'code' in err ? String(err.code) : ''
      if (code !== 'EXDEV') throw err
      cpSync(staging, opts.destDir, { recursive: true, dereference: true })
    }
    writeFileSync(stampPath(opts.destDir), `${manifest.sha256}\n`, 'utf8')
    return { ok: true, root: opts.destDir, skipped: false }
  } catch (err) {
    return {
      ok: false,
      error: `组件解压失败：${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
