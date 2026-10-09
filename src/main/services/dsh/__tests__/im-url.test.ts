import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dshPluginLinkSpec,
  dshPnpmLaunch,
  dshWebLaunchArgs,
  parseDshWebAnnouncement,
} from '../im-url'

describe('parseDshWebAnnouncement', () => {
  it('取出带 token 的根 URL', () => {
    const text = 'booting\ndsh web: http://127.0.0.1:3080/?token=abc\nready\n'
    expect(parseDshWebAnnouncement(text)).toBe('http://127.0.0.1:3080/?token=abc')
  })

  it('丢掉 LAN 后缀，只留本机地址', () => {
    const text =
      'dsh web: http://127.0.0.1:4312/?token=abc (LAN: http://192.168.1.5:4312/?token=abc)'
    expect(parseDshWebAnnouncement(text)).toBe('http://127.0.0.1:4312/?token=abc')
  })

  it('还没打印地址时返回 null', () => {
    expect(parseDshWebAnnouncement('dsh web: opening the default browser')).toBeNull()
  })
})

describe('dshWebLaunchArgs', () => {
  it('把补丁放在 web 应用自己的参数前面，并保持顺序', () => {
    expect(
      dshWebLaunchArgs(['C:/home/hardening.yml', 'C:/home/providers.yml', 'C:/home/mcp.yml']),
    ).toEqual([
      'web',
      '--patch',
      'C:/home/hardening.yml',
      '--patch',
      'C:/home/providers.yml',
      '--patch',
      'C:/home/mcp.yml',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-open',
    ])
  })
})

describe('dshPluginLinkSpec', () => {
  it('把 Windows 路径写成 pnpm link 说明符', () => {
    expect(dshPluginLinkSpec('C:\\repo\\vendor\\dsh-im')).toBe('link:C:/repo/vendor/dsh-im')
  })
})

describe('dshPnpmLaunch', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    dirs.length = 0
  })

  it('优先用 dsh 旁边的 pnpm.mjs，避免 Windows 直接执行 .cmd', () => {
    const root = mkdtempSync(join(tmpdir(), 'pnpm-launch-'))
    dirs.push(root)
    const bin = join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const script = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
    mkdirSync(dirname(bin), { recursive: true })
    mkdirSync(dirname(script), { recursive: true })
    writeFileSync(script, '')
    expect(dshPnpmLaunch(bin, 'C:/node.exe')).toEqual({
      command: 'C:/node.exe',
      prefix: [script],
      shell: false,
    })
  })

  it('旁边没有 pnpm 时退回 PATH', () => {
    expect(dshPnpmLaunch('', 'node')).toEqual({
      command: 'pnpm',
      prefix: [],
      shell: process.platform === 'win32',
    })
  })
})
