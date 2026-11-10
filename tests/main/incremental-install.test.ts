import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyIncrementalInstall, stamp } from '../../scripts/lib/incremental-install.mjs'
import {
  INCREMENTAL_EXTRACT_MARKER,
  INCREMENTAL_EXTRACT_SNIPPET,
  spliceIncrementalExtract,
} from '../../scripts/lib/patch-nsis-incremental.mjs'

const ROOT = join(import.meta.dirname, '../..')

function tree(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const full = join(root, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, text)
  }
}

describe('incremental install', () => {
  it('does not rewrite an unchanged file and does rewrite a changed one', () => {
    const root = mkdtempSync(join(tmpdir(), 'eaa-inc-'))
    const source = join(root, 'src')
    const dest = join(root, 'dst')
    tree(source, {
      'same.txt': 'same-bytes',
      'changed.txt': 'new',
      'added.txt': 'added',
      'nested/keep.txt': 'nested',
    })
    tree(dest, {
      'same.txt': 'same-bytes',
      'changed.txt': 'old',
      'gone.txt': 'remove-me',
      'nested/empty/placeholder.txt': 'x',
    })
    rmSync(join(dest, 'nested/empty/placeholder.txt'))
    const kept = stamp(join(dest, 'same.txt'), '2020-01-01T00:00:00Z')
    const before = readFileSync(join(dest, 'same.txt'))

    const result = applyIncrementalInstall(source, dest, ['Uninstall Education Advisor.exe'])

    expect(result).toMatchObject({ copied: 3, skipped: 1, removed: 1, bytesSkipped: Buffer.byteLength('same-bytes') })
    expect(statSync(join(dest, 'same.txt')).mtimeMs).toBe(kept)
    expect(readFileSync(join(dest, 'same.txt'))).toEqual(before)
    expect(readFileSync(join(dest, 'changed.txt'), 'utf8')).toBe('new')
    expect(readFileSync(join(dest, 'added.txt'), 'utf8')).toBe('added')
    expect(readFileSync(join(dest, 'nested/keep.txt'), 'utf8')).toBe('nested')
    expect(() => statSync(join(dest, 'gone.txt'))).toThrow()
    expect(() => statSync(join(dest, 'nested/empty'))).toThrow()
    rmSync(root, { recursive: true, force: true })
  })

  it('treats same-size different bytes as a change and keeps listed names', () => {
    const root = mkdtempSync(join(tmpdir(), 'eaa-inc-'))
    const source = join(root, 'src')
    const dest = join(root, 'dst')
    tree(source, { 'app.asar': 'bbbb' })
    tree(dest, {
      'app.asar': 'aaaa',
      'Uninstall Education Advisor.exe': 'real-uninstaller',
      'uninstallerIcon.ico': 'icon',
    })
    const result = applyIncrementalInstall(source, dest, [
      'Uninstall Education Advisor.exe',
      'uninstallerIcon.ico',
    ])
    expect(result.copied).toBe(1)
    expect(result.removed).toBe(0)
    expect(readFileSync(join(dest, 'app.asar'), 'utf8')).toBe('bbbb')
    expect(readFileSync(join(dest, 'Uninstall Education Advisor.exe'), 'utf8')).toBe('real-uninstaller')
    rmSync(root, { recursive: true, force: true })
  })

  it('matches paths case-insensitively and does not follow symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'eaa-inc-'))
    const source = join(root, 'src')
    const dest = join(root, 'dst')
    const outside = join(root, 'outside')
    tree(source, { 'Readme.txt': 'same' })
    tree(dest, { 'readme.txt': 'same' })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(outside, 'secret.txt'), 'secret')
    symlinkSync(outside, join(dest, 'linked'), 'dir')
    symlinkSync(join(outside, 'secret.txt'), join(source, 'secret.txt'))
    const kept = stamp(join(dest, 'readme.txt'), '2020-01-01T00:00:00Z')

    applyIncrementalInstall(source, dest)

    expect(statSync(join(dest, 'readme.txt')).mtimeMs).toBe(kept)
    expect(() => statSync(join(dest, 'Readme.txt'))).toThrow()
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret')
    expect(statSync(join(dest, 'linked')).isDirectory()).toBe(true)
    expect(() => statSync(join(dest, 'secret.txt'))).toThrow()
    rmSync(root, { recursive: true, force: true })
  })
})

describe('NSIS incremental hook', () => {
  it('inserts the compare step without removing the full-copy fallback', () => {
    const stock = [
      '!macro extractUsing7za FILE',
      '  SetOutPath $R0',
      '  StrCpy $R1 0',
      '  CopyFiles /SILENT "$PLUGINSDIR\\7z-out\\*" $OUTDIR',
      '  DoneExtract7za:',
      '!macroend',
      '',
    ].join('\n')
    const once = spliceIncrementalExtract(stock)
    expect(once).toContain(INCREMENTAL_EXTRACT_MARKER)
    expect(once).toContain('!ifmacrodef eaaTryIncrementalCopy')
    expect(once).toContain('StrCmp $R2 "1" DoneExtract7za')
    expect(once).toContain('CopyFiles /SILENT')
    expect(once.indexOf('SetOutPath $R0')).toBeLessThan(once.indexOf('StrCpy $R2 "0"'))
    expect(once.indexOf('StrCpy $R2 "0"')).toBeLessThan(once.indexOf('StrCpy $R1 0'))
    expect(spliceIncrementalExtract(once)).toBe(once)
    expect(INCREMENTAL_EXTRACT_SNIPPET).toContain(INCREMENTAL_EXTRACT_MARKER)
  })

  it('wires the installer include, the compare script, and a tiny keep-exe', () => {
    const nsh = readFileSync(join(ROOT, 'resources/installer.nsh'), 'utf8')
    const ps1 = readFileSync(join(ROOT, 'resources/eaa-copy-changed.ps1'), 'utf8')
    const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8')
    const afterPack = readFileSync(join(ROOT, 'scripts/after-pack-trim.mjs'), 'utf8')
    const exe = readFileSync(join(ROOT, 'resources/eaa-keep.exe'))
    expect(yml).toContain('include: installer.nsh')
    expect(nsh).toContain('!define EAA_NSIS_DIR "${__FILEDIR__}"')
    expect(nsh).not.toContain('${__FILEDIR__}/eaa-keep.exe')
    expect(nsh).toContain('eaaTryIncrementalCopy')
    expect(nsh).toContain('customRemoveFiles')
    expect(nsh).toContain('old-uninstaller.exe')
    expect(nsh).toContain('RMDir /r $INSTDIR')
    expect(afterPack).toContain('patchNsisIncrementalExtract')
    expect(ps1).toContain('SHA256')
    expect(ps1).toContain('ReparsePoint')
    expect(ps1).toContain('exit 2')
    for (let rule = 1; rule <= 7; rule += 1) {
      expect(ps1).toContain(`${rule}. `)
    }
    expect(exe.subarray(0, 2).toString()).toBe('MZ')
    expect(exe.length).toBeLessThan(8192)
  })
})
