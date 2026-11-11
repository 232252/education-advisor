// Windows 覆盖安装：新 Setup 不能执行旧卸载器的逐文件 atomicRMDir，
// 也不能在没有 Education Advisor.exe 时弹出「无法关闭」。
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '../..')
const nshPath = join(root, 'scripts/nsis/installer.nsh')
const nsh = readFileSync(nshPath, 'utf8')
const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
  version: string
  packages: { '': { version: string } }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function macroBody(name: string) {
  const start = nsh.indexOf(`!macro ${name}`)
  expect(start, name).toBeGreaterThanOrEqual(0)
  const end = nsh.indexOf('!macroend', start)
  expect(end).toBeGreaterThan(start)
  return nsh.slice(start, end)
}

describe('3.3.7-beta.1 packaging', () => {
  it('版本带 beta 后缀，release.yml 会把它标成 prerelease', () => {
    expect(pkg.version).toBe('3.3.7-beta.1')
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
    expect(/-(?:rc|beta|alpha)/.test(pkg.version)).toBe(true)
    const release = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
    expect(release).toContain('*-rc*|*-beta*|*-alpha*')
  })

  it('electron-builder 用 nsis.include 接自定义脚本，不改压缩档位', () => {
    expect(builder).toContain('include: scripts/nsis/installer.nsh')
    expect(builder).not.toMatch(/compression:\s*store/)
    expect(builder).not.toContain('-mx=0')
    expect(builder).not.toContain('mx=0')
  })
})

function codeOnly(src: string) {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith(';'))
    .join('\n')
}

describe('NSIS upgrade script', () => {
  it('覆盖安装整目录改名并清掉 UninstallString，不调用旧卸载器', () => {
    const code = codeOnly(nsh)
    expect(code).not.toContain('atomicRMDir')
    expect(code).not.toContain('old-uninstaller')
    expect(code).not.toContain('uninstallOldVersion')
    expect(code).not.toContain('Path.StartsWith')
    expect(code).not.toContain('$_.Path')
    expect(code).not.toContain('FindWindow')

    for (const name of [
      'customHeader',
      'customInit',
      'customCheckAppRunning',
      'customInstall',
      'customRemoveFiles',
    ]) {
      expect(nsh).toContain(`!macro ${name}`)
    }

    const prepare = macroBody('eaaDefinePrepare')
    const moveAt = prepare.indexOf('Call ${_MOVE}')
    const clearAt = prepare.indexOf('DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"')
    expect(moveAt).toBeGreaterThan(0)
    expect(clearAt).toBeGreaterThan(moveAt)

    const move = macroBody('eaaDefineMove')
    const cwdAt = move.indexOf('SetOutPath "$TEMP"')
    const renameAt = move.indexOf('Rename "$R9" "$R7"')
    expect(cwdAt).toBeGreaterThan(0)
    expect(renameAt).toBeGreaterThan(cwdAt)
    expect(move).toContain('__eaa_old_')
    expect(move).not.toContain('appCannotBeClosed')

    const init = macroBody('customInit')
    expect(init).toContain('${UAC_IsInnerInstance}')
    expect(init).toContain('Call eaaPrepareFastUpgrade')
  })

  it('无法关闭只出现在探测到 Education Advisor.exe 之后', () => {
    const close = macroBody('eaaDefineClose')
    const probeAt = close.indexOf('Call ${_PROBE}')
    const runningAt = close.indexOf('StrCmp $R8 "1"')
    const dialogAt = close.indexOf('$(appCannotBeClosed)')
    expect(probeAt).toBeGreaterThan(0)
    expect(runningAt).toBeGreaterThan(probeAt)
    expect(dialogAt).toBeGreaterThan(runningAt)
    expect(close).toContain('taskkill.exe')
    expect(close).toContain('/IM "${APP_EXECUTABLE_FILENAME}"')

    const probe = macroBody('eaaDefineProbe')
    expect(probe).toContain('tasklist.exe')
    expect(probe).toContain('IMAGENAME eq ${APP_EXECUTABLE_FILENAME}')
    expect(probe).toContain('"${APP_EXECUTABLE_FILENAME}"')
    expect(probe.indexOf('Pop $R0')).toBeLessThan(probe.indexOf('Pop $R1'))

    const other = macroBody('eaaDefineMove')
    expect(other).toContain('Education Advisor is not running')
    expect(other).not.toContain('appCannotBeClosed')
    expect(other).not.toContain('无法关闭')
  })

  it('旧树在解包之后后台删除，更新路径不再 RMDir /r', () => {
    const spawn = macroBody('eaaDefineSpawn')
    expect(spawn).toContain('Exec \'')
    expect(spawn).not.toContain('ExecWait')
    expect(spawn).not.toContain('nsExec::Exec')
    expect(spawn).toContain('*__eaa_old_*')
    expect(spawn).toContain('Remove-Item -LiteralPath')

    const remove = macroBody('customRemoveFiles')
    const updated = remove.indexOf('${isUpdated}')
    const rmdir = remove.indexOf('RMDir /r "$INSTDIR"')
    expect(updated).toBeGreaterThan(0)
    expect(rmdir).toBeGreaterThan(updated)
    expect(remove).toContain('Call un.eaaMoveDirInR9')
    expect(remove).toContain('Call un.eaaSpawnAsideDeletes')
    expect(remove).not.toContain('atomicRMDir')
  })
})

function makensisBin() {
  try {
    execFileSync('makensis', ['-VERSION'], { stdio: 'ignore' })
    return 'makensis'
  } catch {
    return null
  }
}

const makensis = makensisBin()

function compile(kind: 'installer' | 'uninstaller') {
  const dir = mkdtempSync(join(tmpdir(), 'eaa-nsis-'))
  dirs.push(dir)
  const lang = [
    '/usr/share/nsis/Contrib/Language files/English.nlf',
    '/usr/local/share/nsis/Contrib/Language files/English.nlf',
  ].find((path) => {
    try {
      readFileSync(path)
      return true
    } catch {
      return false
    }
  })
  if (!lang) throw new Error('NSIS English.nlf not found')
  const out = join(dir, `${kind}.exe`)
  const lines = ['!include LogicLib.nsh']
  if (kind === 'uninstaller') lines.push('!define BUILD_UNINSTALLER')
  lines.push(
    `!include "${nshPath}"`,
    '!define APP_EXECUTABLE_FILENAME "Education Advisor.exe"',
    '!define UNINSTALL_FILENAME "Uninstall Education Advisor.exe"',
    '!define INSTALL_REGISTRY_KEY "Software/EA"',
    '!define UNINSTALL_REGISTRY_KEY "Software/Uninstall/EA"',
    '!define PRODUCT_NAME "Education Advisor"',
    `OutFile "${out}"`,
    'Name "eaa-nsis-check"',
    'RequestExecutionLevel user',
    'Unicode true',
    `LoadLanguageFile "${lang}"`,
    'LangString appCannotBeClosed ${LANG_ENGLISH} "cannot close"',
  )
  if (kind === 'uninstaller') {
    lines.push(
      '!macro _isUpdated _a _b _t _f',
      '  !insertmacro _== `0` `1` `${_t}` `${_f}`',
      '!macroend',
      '!define isUpdated `"" isUpdated ""`',
    )
  } else {
    lines.push(
      '!macro _UAC_IsInnerInstance _a _b _t _f',
      '  !insertmacro _== `0` `1` `${_t}` `${_f}`',
      '!macroend',
      '!define UAC_IsInnerInstance `"" UAC_IsInnerInstance ""`',
    )
  }
  lines.push('!insertmacro customHeader')
  if (kind === 'installer') {
    lines.push(
      'Section',
      '  !insertmacro customInit',
      '  !insertmacro customCheckAppRunning',
      '  !insertmacro customInstall',
      'SectionEnd',
    )
  } else {
    lines.push(
      'Section',
      `  WriteUninstaller "${join(dir, 'uninst.exe')}"`,
      'SectionEnd',
      'Function un.checkAppRunning',
      '  !insertmacro customCheckAppRunning',
      'FunctionEnd',
      'Section "un.Uninstall"',
      '  Call un.checkAppRunning',
      '  !insertmacro customRemoveFiles',
      'SectionEnd',
    )
  }
  const script = join(dir, 'check.nsi')
  writeFileSync(script, `${lines.join('\n')}\n`)
  try {
    execFileSync(makensis ?? 'makensis', ['-WX', '-NOCD', script], { stdio: 'pipe' })
  } catch (error) {
    const failed = error as { stdout?: Buffer; stderr?: Buffer }
    throw new Error(`${failed.stdout?.toString() ?? ''}\n${failed.stderr?.toString() ?? ''}`)
  }
}

describe('NSIS compile', () => {
  it.skipIf(!makensis)('安装器与卸载器脚本都能通过 makensis', () => {
    compile('installer')
    compile('uninstaller')
  })
})
