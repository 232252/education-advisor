// 发布打包的两条平台分叉：
// 1. mac 的资源在 .app/Contents/Resources，不在 appOutDir/resources。
// 2. smartUnpack 会整包解出本机装上的 @pnpm/exe 与 @napi-rs/canvas
//    （linux 同时有 glibc 和 musl；mac 两个架构谁在磁盘上谁入账）。
// 清单只记 Windows 时，linux 的 afterPack 会把那四件报成预料外解包。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  chromiumLicenseCandidates,
  diffUnpackedPackages,
  packagedLocalesDir,
  packagedResourcesDir,
} from '../../scripts/after-pack-trim.mjs'
import {
  KEEPERS,
  asarUnpackEntries,
  selectKeepers,
} from '../../scripts/compute-unpack-closure.mjs'

const LINUX_NATIVES = [
  '@napi-rs/canvas-linux-x64-gnu',
  '@napi-rs/canvas-linux-x64-musl',
  '@pnpm/exe.linux-x64',
  '@pnpm/exe.linux-x64-musl',
] as const

const MAC_NATIVES = [
  '@napi-rs/canvas-darwin-x64',
  '@napi-rs/canvas-darwin-arm64',
  '@pnpm/exe.darwin-x64',
  '@pnpm/exe.darwin-arm64',
] as const

const UNIVERSAL = ['pnpm', 'pdfjs-dist', 'better-sqlite3'] as const

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

function present(names: readonly string[]) {
  const have = new Set(names)
  return {
    exists: (name: string) => have.has(name),
    inShipSet: (name: string) => have.has(name),
  }
}

function macPackager(productFilename = 'Education Advisor') {
  return {
    platform: { name: 'mac' },
    appInfo: { productFilename },
  }
}

describe('packaged resources dir', () => {
  it('mac 落在 .app/Contents/Resources，不用 appOutDir/resources', () => {
    const appOutDir = '/tmp/dist/mac'
    const resources = packagedResourcesDir(appOutDir, macPackager())
    expect(resources).toBe('/tmp/dist/mac/Education Advisor.app/Contents/Resources')
    expect(resources).not.toBe(join(appOutDir, 'resources'))
    expect(join(resources, 'app.asar.unpacked', 'node_modules')).toContain(
      'Education Advisor.app/Contents/Resources/app.asar.unpacked',
    )
  })

  it('优先使用 packager.getResourcesDir', () => {
    const appOutDir = '/tmp/dist/mac-arm64'
    const resources = packagedResourcesDir(appOutDir, {
      platform: { name: 'mac' },
      appInfo: { productFilename: 'ignored' },
      getResourcesDir: (dir: string) => join(dir, 'Custom.app', 'Contents', 'Resources'),
    })
    expect(resources).toBe('/tmp/dist/mac-arm64/Custom.app/Contents/Resources')
  })

  it('windows 与 linux 仍是 appOutDir/resources', () => {
    for (const name of ['windows', 'linux']) {
      expect(packagedResourcesDir('/out', { platform: { name } })).toBe('/out/resources')
    }
  })

  it('mac 没有 productFilename 时直接失败，避免再写到包外', () => {
    expect(() => packagedResourcesDir('/out', { platform: { name: 'mac' } })).toThrow(/productFilename/)
  })

  it('locale 白名单只查 win/linux 的 appOutDir/locales，mac 不套 *.pak', () => {
    expect(packagedLocalesDir('/out', 'windows')).toBe('/out/locales')
    expect(packagedLocalesDir('/out', 'linux')).toBe('/out/locales')
    expect(packagedLocalesDir('/out', 'mac')).toBeNull()
  })

  it('Chromium 许可先找可执行文件旁边，再找 Resources', () => {
    expect(chromiumLicenseCandidates('/out', '/out/App.app/Contents/Resources')).toEqual([
      '/out/LICENSES.chromium.html',
      '/out/App.app/Contents/Resources/LICENSES.chromium.html',
    ])
  })

  it('假 mac 包里闭包落在 Contents/Resources，旧的 appOutDir/resources 看不到', () => {
    const appOutDir = mkdtempSync(join(tmpdir(), 'ea-mac-pack-'))
    dirs.push(appOutDir)
    const resources = packagedResourcesDir(appOutDir, macPackager())
    const realUnpacked = join(resources, 'app.asar.unpacked', 'node_modules')
    mkdirSync(join(realUnpacked, '@deepseek-ai', 'dsh'), { recursive: true })
    writeFileSync(join(realUnpacked, '@deepseek-ai', 'dsh', 'package.json'), '{}')
    const wrongUnpacked = join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules')

    const atBundle = diffUnpackedPackages(realUnpacked, ['@deepseek-ai/dsh'])
    expect(atBundle.missing).toEqual([])
    expect(atBundle.unexpected).toEqual([])

    const outsideBundle = diffUnpackedPackages(wrongUnpacked, ['@deepseek-ai/dsh'])
    expect(outsideBundle.missing).toEqual(['@deepseek-ai/dsh'])
  })
})

describe('cross-platform unpack keepers', () => {
  it('清单覆盖本次失败的四件 linux 原生包和 mac 两个架构', () => {
    const names = KEEPERS.map((k) => k.name)
    for (const name of [...LINUX_NATIVES, ...MAC_NATIVES, ...UNIVERSAL]) {
      expect(names).toContain(name)
    }
  })

  it('linux x64 把 glibc 与 musl 一起入账，不要求别的操作系统', () => {
    const result = selectKeepers(KEEPERS, {
      platform: 'linux',
      arch: 'x64',
      ...present([...UNIVERSAL, ...LINUX_NATIVES]),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const name of LINUX_NATIVES) expect(result.selected).toContain(name)
    for (const name of MAC_NATIVES) expect(result.selected).not.toContain(name)
    expect(result.selected).not.toContain('@pnpm/exe.win32-x64')
  })

  it('musl 没装上时跳过，glibc 主包没装上则失败', () => {
    const withoutMusl = selectKeepers(KEEPERS, {
      platform: 'linux',
      arch: 'x64',
      ...present([...UNIVERSAL, '@pnpm/exe.linux-x64', '@napi-rs/canvas-linux-x64-gnu']),
    })
    expect(withoutMusl.ok).toBe(true)
    if (!withoutMusl.ok) return
    expect(withoutMusl.selected).not.toContain('@pnpm/exe.linux-x64-musl')
    expect(withoutMusl.selected).not.toContain('@napi-rs/canvas-linux-x64-musl')

    const withoutGnu = selectKeepers(KEEPERS, {
      platform: 'linux',
      arch: 'x64',
      ...present([...UNIVERSAL, '@pnpm/exe.linux-x64', '@napi-rs/canvas-linux-x64-musl']),
    })
    expect(withoutGnu.ok).toBe(false)
    if (withoutGnu.ok) return
    expect(withoutGnu.missing).toBe('@napi-rs/canvas-linux-x64-gnu')
    expect(withoutGnu.reason).toBe('missing')
  })

  it('mac 宿主架构是硬性要求，另一架构装上了也入账', () => {
    const onlyArm = selectKeepers(KEEPERS, {
      platform: 'darwin',
      arch: 'arm64',
      ...present([...UNIVERSAL, '@pnpm/exe.darwin-arm64', '@napi-rs/canvas-darwin-arm64']),
    })
    expect(onlyArm.ok).toBe(true)
    if (!onlyArm.ok) return
    expect(onlyArm.selected).toContain('@pnpm/exe.darwin-arm64')
    expect(onlyArm.selected).toContain('@napi-rs/canvas-darwin-arm64')
    expect(onlyArm.selected).not.toContain('@pnpm/exe.darwin-x64')

    const both = selectKeepers(KEEPERS, {
      platform: 'darwin',
      arch: 'arm64',
      ...present([...UNIVERSAL, ...MAC_NATIVES]),
    })
    expect(both.ok).toBe(true)
    if (!both.ok) return
    for (const name of MAC_NATIVES) expect(both.selected).toContain(name)

    const missingHost = selectKeepers(KEEPERS, {
      platform: 'darwin',
      arch: 'arm64',
      ...present([...UNIVERSAL, '@napi-rs/canvas-darwin-arm64', '@pnpm/exe.darwin-x64']),
    })
    expect(missingHost.ok).toBe(false)
    if (missingHost.ok) return
    expect(missingHost.missing).toBe('@pnpm/exe.darwin-arm64')
  })

  it('win x64 仍要求自己的两件原生包', () => {
    const result = selectKeepers(KEEPERS, {
      platform: 'win32',
      arch: 'x64',
      ...present([...UNIVERSAL, '@pnpm/exe.win32-x64', '@napi-rs/canvas-win32-x64-msvc']),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.selected).toContain('@pnpm/exe.win32-x64')
    expect(result.selected).toContain('@napi-rs/canvas-win32-x64-msvc')
    expect(result.selected).not.toContain('@pnpm/exe.linux-x64')
  })

  it('全平台保留项不随包时失败，避免清单写进一个不会落盘的包', () => {
    const result = selectKeepers(KEEPERS, {
      platform: 'linux',
      arch: 'x64',
      exists: (name: string) => UNIVERSAL.includes(name as (typeof UNIVERSAL)[number]) || LINUX_NATIVES.includes(name as (typeof LINUX_NATIVES)[number]),
      inShipSet: (name: string) => name !== 'better-sqlite3',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toBe('better-sqlite3')
    expect(result.reason).toBe('not-shipped')
  })

  it('入选的平台包逐包写进 asarUnpack，不退回整树解包', () => {
    const selected = selectKeepers(KEEPERS, {
      platform: 'linux',
      arch: 'x64',
      ...present([...UNIVERSAL, ...LINUX_NATIVES]),
    })
    expect(selected.ok).toBe(true)
    if (!selected.ok) return
    const expected = ['@deepseek-ai/dsh', ...selected.selected].sort()
    const lines = asarUnpackEntries(expected)
    expect(lines.join('\n')).not.toContain('**/node_modules/**')
    expect(lines).toContain('  - "node_modules/@deepseek-ai/**"')
    for (const name of [...UNIVERSAL, ...LINUX_NATIVES]) {
      expect(lines).toContain(`  - "node_modules/${name}/**"`)
    }
    expect(lines.filter((line) => line.includes('@deepseek-ai/dsh'))).toEqual([])
  })
})

describe('unpack manifest drift', () => {
  it('linux 那四件不在清单里就是预料外解包，补进清单后对得上', () => {
    const root = mkdtempSync(join(tmpdir(), 'ea-unpack-'))
    dirs.push(root)
    const unpacked = join(root, 'app.asar.unpacked', 'node_modules')
    for (const name of ['@deepseek-ai/dsh', ...LINUX_NATIVES]) {
      const dir = join(unpacked, ...name.split('/'))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), '{}')
    }

    const stale = diffUnpackedPackages(unpacked, ['@deepseek-ai/dsh'])
    expect(stale.missing).toEqual([])
    expect([...stale.unexpected].sort()).toEqual([...LINUX_NATIVES].sort())

    const current = diffUnpackedPackages(unpacked, ['@deepseek-ai/dsh', ...LINUX_NATIVES])
    expect(current.missing).toEqual([])
    expect(current.unexpected).toEqual([])
  })

  it('清单里有、磁盘上没有，报缺落盘而不是当成多出来的包', () => {
    const root = mkdtempSync(join(tmpdir(), 'ea-unpack-miss-'))
    dirs.push(root)
    const unpacked = join(root, 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(unpacked, { recursive: true })
    writeFileSync(join(unpacked, 'package.json'), '{}')
    const diff = diffUnpackedPackages(join(root, 'node_modules'), ['@deepseek-ai/dsh', 'pdfjs-dist'])
    expect(diff.missing).toEqual(['pdfjs-dist'])
    expect(diff.unexpected).toEqual([])
  })
})
