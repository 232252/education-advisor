// =============================================================
// DSH 版本 pin 一致性守卫
//
// 核心运行时规划（docs/DSH_CORE_RUNTIME.md §4.1）：官方版本只在一处锁定，
// 小升级改 pin + 跑 CI。教师端提示文案里的 DSH 版本必须来自单一来源：
//   1. 装配时注入的版本可以覆盖（升级/测试都不必改文案代码）；
//   2. 未注入时的兜底值必须与已安装运行时一致（漂移即红）。
// =============================================================

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))

function installedDshVersion(): string {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
  ) as { version?: string }
  if (!manifest.version) throw new Error('@deepseek-ai/dsh 未安装或没有 version 字段')
  return manifest.version
}

async function missingBinError(): Promise<string> {
  const { DshImWebHost } = await import('../im-host')
  const host = new DshImWebHost({
    home: join(ROOT, 'tmp-version-pin-home'),
    dshBin: join(ROOT, 'definitely-missing-dsh-bin.js'),
    imDir: join(ROOT, 'vendor', 'dsh-im'),
    toolsDir: join(ROOT, 'vendor', 'eaa-tools'),
    execPath: process.execPath,
    electronAsNode: true,
  })
  const result = await host.open()
  expect(result.ok).toBe(false)
  return result.error ?? ''
}

describe('DSH 版本单一来源', () => {
  afterEach(async () => {
    const { configureDshRuntimeVersion } = await import('../dsh-version')
    configureDshRuntimeVersion('')
  })

  it('装配注入的版本出现在缺可执行文件提示里，而不是写死的旧版本', async () => {
    const { configureDshRuntimeVersion } = await import('../dsh-version')
    configureDshRuntimeVersion('9.9.9-eaa-test')
    const error = await missingBinError()
    expect(error).toContain('9.9.9-eaa-test')
    expect(error).not.toContain('0.2.2-rc.1')
  })

  it('未注入时兜底版本与已安装的 @deepseek-ai/dsh 一致', async () => {
    const { dshRuntimeVersion } = await import('../dsh-version')
    expect(dshRuntimeVersion()).toBe(installedDshVersion())
    const error = await missingBinError()
    expect(error).toContain(installedDshVersion())
  })

  it('dsh 服务源码里不再写死版本串（注释除外），文案都走单一来源', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url))
    const versionPattern = /\b0\.2\.\d+(?:-[\w.]+)?/
    const offenders: string[] = []
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name === 'dsh-version.ts') continue
      const lines = readFileSync(join(dir, name), 'utf8').split(/\r?\n/)
      lines.forEach((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        if (versionPattern.test(line)) offenders.push(`${name}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
