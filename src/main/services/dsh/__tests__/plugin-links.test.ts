import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dshPluginLinkSpec } from '../im-url'
import {
  materializeProfileLinks,
  packageModuleDir,
  profileLinksCurrent,
  readPluginPackageName,
  resolveDshProfileDir,
  resolvedModuleDir,
  sameDir,
} from '../plugin-links'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function writePlugin(root: string, dirName: string, name: string): string {
  const dir = join(root, dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.1.0' }))
  return dir
}

describe('plugin-links', () => {
  it('新建 profile 时写下官方层、link: 依赖和 node_modules 链接', () => {
    const root = tempDir('eaa-links-new-')
    const home = join(root, 'home')
    const imDir = writePlugin(root, 'dsh-im', '@xmanrui/dsh-im')
    const panelDir = writePlugin(
      join(root, 'dsh-im', 'integrations'),
      'eaa-panel',
      'eaa-dsh-im-panel',
    )

    materializeProfileLinks({
      home,
      profile: 'web',
      plugins: [{ dir: imDir }, { dir: panelDir }],
    })

    const profileDir = resolveDshProfileDir(home, 'web')
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dependencies['@xmanrui/dsh-im']).toBe(dshPluginLinkSpec(imDir))
    expect(manifest.dependencies['eaa-dsh-im-panel']).toBe(dshPluginLinkSpec(panelDir))
    expect(manifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@xmanrui/dsh-im',
      'eaa-dsh-im-panel',
    ])
    expect(existsSync(join(profileDir, 'cordis.patch.yml'))).toBe(true)
    expect(existsSync(join(profileDir, 'pnpm-workspace.yaml'))).toBe(true)
    expect(sameDir(resolvedModuleDir(profileDir, '@xmanrui/dsh-im') ?? '', imDir)).toBe(true)
    expect(sameDir(resolvedModuleDir(profileDir, 'eaa-dsh-im-panel') ?? '', panelDir)).toBe(true)
    expect(
      profileLinksCurrent({ home, profile: 'web', plugins: [{ dir: imDir }, { dir: panelDir }] }),
    ).toBe(true)
  })

  it('stamp 目标缺失或链到旧路径时改写链接，不删官方层', () => {
    const root = tempDir('eaa-links-stale-')
    const home = join(root, 'home')
    const oldIm = writePlugin(root, 'old-im', '@xmanrui/dsh-im')
    const newIm = writePlugin(root, 'new-im', '@xmanrui/dsh-im')
    const tools = writePlugin(root, 'eaa-tools', '@education-advisor/eaa-tools')
    const vendorTools = writePlugin(root, 'vendor-tools', '@education-advisor/eaa-tools')

    materializeProfileLinks({
      home,
      profile: 'web',
      plugins: [{ dir: oldIm }, { dir: vendorTools }],
    })
    const profileDir = resolveDshProfileDir(home, 'web')
    expect(
      profileLinksCurrent({ home, profile: 'web', plugins: [{ dir: newIm }, { dir: tools }] }),
    ).toBe(false)

    materializeProfileLinks({
      home,
      profile: 'web',
      plugins: [{ dir: newIm }, { dir: tools }],
    })

    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dependencies['@xmanrui/dsh-im']).toBe(dshPluginLinkSpec(newIm))
    expect(manifest.dependencies['@education-advisor/eaa-tools']).toBe(dshPluginLinkSpec(tools))
    expect(manifest.dsh.profile.bundles[0]).toBe('@deepseek-ai/dsh-base')
    expect(sameDir(realpathSync(packageModuleDir(profileDir, '@xmanrui/dsh-im')), newIm)).toBe(true)
    expect(
      sameDir(realpathSync(packageModuleDir(profileDir, '@education-advisor/eaa-tools')), tools),
    ).toBe(true)
    expect(
      profileLinksCurrent({ home, profile: 'web', plugins: [{ dir: newIm }, { dir: tools }] }),
    ).toBe(true)
  })

  it('只有 stamp、没有 package.json 链接时不算就位', () => {
    const root = tempDir('eaa-links-stamp-only-')
    const home = join(root, 'home')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'eaa-dsh-im.stamp'), '5.10.0+panel1\n')
    const imDir = writePlugin(root, 'dsh-im', '@xmanrui/dsh-im')
    expect(profileLinksCurrent({ home, profile: 'web', plugins: [{ dir: imDir }] })).toBe(false)
    expect(readPluginPackageName(imDir)).toBe('@xmanrui/dsh-im')
  })
})
