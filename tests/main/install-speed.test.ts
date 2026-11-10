import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertUnpackContract, patternCoversPackage, asarUnpackPatterns } from '../../scripts/lib/asar-unpack-patterns.mjs'
import { eaaSourceFingerprint } from '../../scripts/lib/eaa-source-fingerprint.mjs'
import { preferMirror } from '../../scripts/lib/install-mirror.mjs'

const ROOT = join(import.meta.dirname, '../..')

describe('Windows install speedups', () => {
  it('uses a mirror only when it is clearly faster', () => {
    expect(preferMirror(100, 50)).toBe(false)
    expect(preferMirror(2000, 200)).toBe(true)
    expect(preferMirror(2000, 1500)).toBe(false)
    expect(preferMirror(Number.POSITIVE_INFINITY, 300)).toBe(true)
    expect(preferMirror(2000, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('unpacks the dsh runtime and leaves Electron-only packages in the asar', () => {
    expect(assertUnpackContract()).toEqual([])
    const patterns = asarUnpackPatterns()
    expect(patterns).not.toContain('**/node_modules/**')
    expect(patternCoversPackage(patterns, '@deepseek-ai/libreoffice-kit-win32-x64')).toBe(true)
    expect(patternCoversPackage(patterns, 'pdfjs-dist')).toBe(false)
    expect(patternCoversPackage(patterns, 'lxgw-wenkai-webfont')).toBe(false)
  })

  it('matches the committed EAA binaries to the current Rust sources', () => {
    const { fingerprint, fileCount } = eaaSourceFingerprint()
    expect(fileCount).toBeGreaterThan(10)
    for (const dir of ['win32-x64', 'linux-x64']) {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, 'resources/eaa-binaries', dir, 'manifest.json'), 'utf8'),
      ) as { source_fingerprint?: string }
      expect(manifest.source_fingerprint).toBe(fingerprint)
    }
  })
})
