import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RUNTIME_ZIP_MAX_BYTES,
  SETUP_MAX_BYTES,
  compressionLevelBlocked,
  evaluateOutput,
  evaluateRuntimeArchive,
  evaluateSetupBytes,
  isStaleUnpackedName,
  packWantsWindows,
  readDirectoriesOutput,
  removeStaleUnpacked,
  shouldRetryPack,
  toolchainZipHits,
  unsafePackArgs,
  withPublishNever,
} from '../../scripts/lib/pack-budget.mjs'
import { firstZipMethod, writeStoreZip } from '../../scripts/lib/store-zip.mjs'

const root = join(import.meta.dirname, '../..')
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ea-pack-'))
  dirs.push(dir)
  return dir
}

describe('installer byte budget', () => {
  it('keeps the slim Setup and rejects the toolchain-sized Setup', () => {
    expect(SETUP_MAX_BYTES).toBe(310_000_000)
    expect(RUNTIME_ZIP_MAX_BYTES).toBe(200_000_000)
    expect(evaluateSetupBytes(287_227_957).ok).toBe(true)
    expect(evaluateSetupBytes(287_550_146).ok).toBe(true)
    expect(evaluateSetupBytes(369_660_622).ok).toBe(false)
    expect(evaluateSetupBytes(369_388_880).ok).toBe(false)
    expect(SETUP_MAX_BYTES).toBeGreaterThan(287_550_146)
    expect(SETUP_MAX_BYTES).toBeLessThan(369_388_880)
    expect(evaluateRuntimeArchive({ bytes: 166_000_000, entries: ['node_modules/left-pad/package.json'], method: 0 }).ok).toBe(true)
    expect(evaluateRuntimeArchive({ bytes: 200_000_001, entries: ['node_modules/left-pad/package.json'], method: 0 }).ok).toBe(false)
  })

  it('rejects pnpm inside the runtime zip and a non-STORE method', () => {
    const hits = toolchainZipHits([
      'node_modules/left-pad/package.json',
      'node_modules/pnpm/package.json',
      'node_modules/@pnpm/exe.win32-x64/pnpm.exe',
    ])
    expect(hits).toEqual(['node_modules/pnpm/package.json', 'node_modules/@pnpm/exe.win32-x64/pnpm.exe'])
    const verdict = evaluateRuntimeArchive({
      bytes: 1000,
      entries: hits,
      method: 0,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failures.join('\n')).toContain('pnpm')
    expect(evaluateRuntimeArchive({ bytes: 1000, entries: ['a'], method: 8 }).ok).toBe(false)
    expect(evaluateRuntimeArchive({ bytes: 1000, entries: null, method: 0 }).ok).toBe(false)
  })
})

describe('pack invocation rules', () => {
  it('refuses a prepackaged directory and an uncompressed 7z, and allows electronDist', () => {
    expect(unsafePackArgs(['--win', 'nsis', '--prepackaged', 'release-v11/win-unpacked'])).toEqual(['--prepackaged'])
    expect(unsafePackArgs(['--pd=release-v11/win-unpacked'])).toEqual(['--pd=release-v11/win-unpacked'])
    expect(unsafePackArgs(['-c.compression=store'])).toEqual(['-c.compression=store'])
    expect(unsafePackArgs(['--config', 'compression: store'])).toEqual(['--config compression: store'])
    expect(unsafePackArgs(['-c.electronDist=node_modules/electron/dist'])).toEqual([])
    expect(compressionLevelBlocked('0')).toBe(true)
    expect(compressionLevelBlocked('9')).toBe(false)
    expect(compressionLevelBlocked(undefined)).toBe(false)
  })

  it('forces publish never and only retries Electron download failures', () => {
    expect(withPublishNever(['--win', '--x64', '--publish', 'always', '--config.extraMetadata.version=1'])).toEqual([
      '--win',
      '--x64',
      '--config.extraMetadata.version=1',
      '--publish',
      'never',
    ])
    expect(shouldRetryPack('connect ETIMEDOUT 20.205.243.166:443')).toBe(true)
    expect(shouldRetryPack('[after-pack-trim] runtime zip 不应含 pnpm / @pnpm/exe')).toBe(false)
    expect(shouldRetryPack('connect ETIMEDOUT\n[pack-budget] FAIL Setup.exe is 369660622 bytes')).toBe(false)
    expect(shouldRetryPack('icon.ico missing')).toBe(false)
  })

  it('treats nsis as Windows and mac as not Windows', () => {
    expect(packWantsWindows(['--win', 'nsis'])).toBe(true)
    expect(packWantsWindows(['--mac', '--arm64'])).toBe(false)
    expect(packWantsWindows(['--linux', '--x64'])).toBe(false)
  })

  it('reads directories.output and only deletes unpacked trees', () => {
    const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
    expect(readDirectoriesOutput(yml)).toBe('release-v11')
    expect(isStaleUnpackedName('win-unpacked')).toBe(true)
    expect(isStaleUnpackedName('win-arm64-unpacked')).toBe(true)
    expect(isStaleUnpackedName('linux-unpacked')).toBe(true)
    expect(isStaleUnpackedName('mac')).toBe(true)
    expect(isStaleUnpackedName('mac-arm64')).toBe(true)
    expect(isStaleUnpackedName('Education-Advisor-Setup.exe')).toBe(false)
    expect(isStaleUnpackedName('latest.yml')).toBe(false)

    const dir = tempDir()
    mkdirSync(join(dir, 'win-unpacked', 'resources'), { recursive: true })
    writeFileSync(join(dir, 'win-unpacked', 'resources', 'keep.txt'), 'stale')
    writeFileSync(join(dir, 'Education-Advisor-Setup.exe'), 'previous')
    writeFileSync(join(dir, 'latest.yml'), 'meta')
    const cleaned = removeStaleUnpacked(dir)
    expect(cleaned.errors).toEqual([])
    expect(cleaned.removed).toEqual([join(dir, 'win-unpacked')])
    expect(readFileSync(join(dir, 'Education-Advisor-Setup.exe'), 'utf8')).toBe('previous')
  })
})

describe('packed tree gate', () => {
  function layout(dir: string, setupBytes: number) {
    const resources = join(dir, 'win-unpacked', 'resources')
    mkdirSync(join(resources, 'dsh-runtime'), { recursive: true })
    mkdirSync(join(resources, 'dsh-im'), { recursive: true })
    mkdirSync(join(resources, 'office-kit'), { recursive: true })
    writeStoreZip(join(resources, 'dsh-runtime', 'dsh-runtime.zip'), [
      { name: 'node_modules/@deepseek-ai/dsh-scope/package.json', data: Buffer.from('{}'), mode: 0o644 },
    ])
    writeStoreZip(join(resources, 'dsh-im', 'dsh-im.zip'), [
      { name: 'node_modules/qrcode/package.json', data: Buffer.from('{}'), mode: 0o644 },
    ])
    writeFileSync(join(resources, 'office-kit', 'office-kit.zip'), 'kit')
    writeFileSync(join(resources, 'app.asar'), 'asar')
    const setup = join(dir, 'Education-Advisor-Setup.exe')
    const fd = openSync(setup, 'w')
    try {
      ftruncateSync(fd, setupBytes)
    } finally {
      closeSync(fd)
    }
    return resources
  }

  it('accepts a small STORE layout and records the inventory pieces', () => {
    const dir = tempDir()
    layout(dir, 287_227_957)
    const runtime = join(dir, 'win-unpacked', 'resources', 'dsh-runtime', 'dsh-runtime.zip')
    expect(firstZipMethod(runtime)).toBe(0)
    const report = evaluateOutput({ outputDir: dir, requireSetup: true })
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    const labels = report.rows.map((row: { label: string }) => row.label)
    expect(labels).toContain('Setup.exe')
    expect(labels).toContain('dsh-runtime.zip')
    expect(labels).toContain('dsh-im.zip')
    expect(labels).toContain('office-kit')
    expect(labels).toContain('app.asar')
  })

  it('fails a Setup over the budget even when the zips are slim', () => {
    const dir = tempDir()
    layout(dir, 310_000_001)
    const report = evaluateOutput({ outputDir: dir, requireSetup: true })
    expect(report.ok).toBe(false)
    expect(report.failures.join('\n')).toContain('310000001')
  })

  it('fails when the runtime zip contains pnpm', () => {
    const dir = tempDir()
    const resources = layout(dir, 1000)
    writeStoreZip(join(resources, 'dsh-runtime', 'dsh-runtime.zip'), [
      { name: 'node_modules/pnpm/package.json', data: Buffer.from('{}'), mode: 0o644 },
    ])
    const report = evaluateOutput({ outputDir: dir, requireSetup: true })
    expect(report.ok).toBe(false)
    expect(report.failures.join('\n')).toContain('pnpm')
  })

  it('fails a Windows pack that has no Setup.exe', () => {
    const dir = tempDir()
    const report = evaluateOutput({ outputDir: dir, requireSetup: true })
    expect(report.ok).toBe(false)
    expect(report.failures.join('\n')).toContain('Education-Advisor-Setup.exe')
  })
})

describe('pack script wiring', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  const release = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
  const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8')

  it('package:installer runs prepackage and the wrapper', () => {
    expect(pkg.scripts['package:installer'].startsWith('npm run prepackage &&')).toBe(true)
    expect(pkg.scripts['package:installer']).toContain('run-electron-builder.mjs')
    expect(pkg.scripts.package).toContain('run-electron-builder.mjs')
    expect(pkg.scripts['package:installer']).not.toContain('--prepackaged')
  })

  it('release.yml packs without uploading and then checks the budget', () => {
    expect(release).toContain('run-electron-builder.mjs')
    expect(release).toContain('--publish never')
    expect(release).toContain('check-pack-budget.mjs')
    expect(release).toContain('--require-setup')
    expect(release).not.toContain('--prepackaged')
    expect(release).not.toContain('npx electron-builder')
    expect(builder).toContain('after-all-artifact-build.mjs')
    expect(builder).toContain('afterPack: scripts/after-pack-trim.mjs')
  })
})
