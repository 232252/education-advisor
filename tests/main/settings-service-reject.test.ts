// =============================================================
// Settings Service — update() 防御性校验测试
// 覆盖此前未测试的拒绝路径: NaN/Infinity/function/symbol/bigint/
// 超长字符串/对象过深/setCustomModels 非数组
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}settings-reject-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import { settingsService } from '../../src/main/services/settings-service'

describe('settingsService.update — 类型拒绝', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    settingsService.reset()
  })

  afterAll(async () => {
    settingsService.reset()
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('拒绝 null', () => {
    expect(() => settingsService.update('general.theme', null)).toThrow(/Invalid value type/)
  })

  it('拒绝 undefined', () => {
    expect(() => settingsService.update('general.theme', undefined)).toThrow(/Invalid value type/)
  })

  it('拒绝 function', () => {
    expect(() => settingsService.update('general.theme', () => 'x')).toThrow(
      /Invalid value type/,
    )
  })

  it('拒绝 symbol', () => {
    expect(() => settingsService.update('general.theme', Symbol('s'))).toThrow(
      /Invalid value type/,
    )
  })

  it('拒绝 bigint', () => {
    expect(() => settingsService.update('general.autoUpdate', 10n)).toThrow(/Invalid value type/)
  })

  it('拒绝 NaN', () => {
    expect(() => settingsService.update('chat.maxTokens', NaN)).toThrow(/NaN/)
  })

  it('拒绝 Infinity', () => {
    expect(() => settingsService.update('chat.maxTokens', Infinity)).toThrow(/Infinity/)
  })

  it('拒绝 -Infinity', () => {
    expect(() => settingsService.update('chat.maxTokens', -Infinity)).toThrow(/Infinity/)
  })
})

describe('settingsService.update — 超长字符串 / 对象深度', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    settingsService.reset()
  })

  it('拒绝超过 1,000,000 字符的字符串', () => {
    const long = 'a'.repeat(1_000_001)
    expect(() => settingsService.update('general.theme', long)).toThrow(/Value too long/)
  })

  it('接受恰好 1,000,000 字符的字符串(边界)', () => {
    const exact = 'x'.repeat(1_000_000)
    expect(() => settingsService.update('general.dataDir', exact)).not.toThrow()
  })

  it('拒绝深度 > 10 的嵌套对象', () => {
    // 构造深度 11 的对象
    let obj: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 11; i++) {
      obj = { nested: obj }
    }
    // customModels 是一个对象字段,可以接受对象
    expect(() =>
      settingsService.update('general.dataDir', obj as unknown as string),
    ).toThrow(/depth|Object depth/i)
  })

  it('接受深度 <= 10 的对象', () => {
    let obj: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 9; i++) {
      obj = { nested: obj }
    }
    expect(() => settingsService.update('general.dataDir', obj as unknown as string)).not.toThrow()
  })

  it('深度计算应识别数组为单层', () => {
    // 数组里的对象不计入额外深度(取决于实现)
    const arr = [{ a: { b: { c: 1 } } }] // 深度有限
    expect(() => settingsService.update('models.enabledModels', arr)).not.toThrow()
  })
})

describe('settingsService.update — dotPath 校验', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    settingsService.reset()
  })

  it('空 dotPath 抛错', () => {
    expect(() => settingsService.update('', 'x')).toThrow(/non-empty/)
  })

  it('含空段的 dotPath 抛错', () => {
    expect(() => settingsService.update('general..theme', 'x')).toThrow(/empty segment/)
    expect(() => settingsService.update('.theme', 'x')).toThrow(/empty segment/)
    expect(() => settingsService.update('general.', 'x')).toThrow(/empty segment/)
  })

  it('不存在的 dotPath 抛错(防 typo)', () => {
    expect(() => settingsService.update('general.nonExistent', 'x')).toThrow(/not found/)
    expect(() => settingsService.update('general.typoFeild', 'x')).toThrow(/not found/)
  })

  it('有效 dotPath 正常更新', () => {
    expect(() => settingsService.update('general.theme', 'light')).not.toThrow()
    expect(settingsService.getSettings().general.theme).toBe('light')
  })

  it('嵌套 dotPath 正常更新', () => {
    expect(() => settingsService.update('models.retry.maxRetries', 5)).not.toThrow()
    expect(settingsService.getSettings().models.retry.maxRetries).toBe(5)
  })
})

describe('settingsService.setCustomModels — 校验', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    settingsService.reset()
  })

  it('非数组 models 抛错', () => {
    expect(() => settingsService.setCustomModels('openai', 'not array' as unknown as never)).toThrow(
      /must be an array/,
    )
    expect(() => settingsService.setCustomModels('openai', { a: 1 } as unknown as never)).toThrow(
      /must be an array/,
    )
    expect(() => settingsService.setCustomModels('openai', null as unknown as never)).toThrow(
      /must be an array/,
    )
  })

  it('合法数组应被接受', () => {
    expect(() =>
      settingsService.setCustomModels('openai', [{ id: 'gpt-4o', label: 'GPT-4o' }]),
    ).not.toThrow()
    const settings = settingsService.getSettings()
    expect(settings.models.customModels?.openai).toHaveLength(1)
  })

  it('空数组也应被接受', () => {
    expect(() => settingsService.setCustomModels('anthropic', [])).not.toThrow()
    expect(settingsService.getSettings().models.customModels?.anthropic).toEqual([])
  })
})

describe('settingsService — DEFAULT_SETTINGS 不被污染', () => {
  it('多次 update/reset 后,默认值保持不变', () => {
    settingsService.reset()
    settingsService.update('general.theme', 'light')
    settingsService.update('general.language', 'en-US')
    settingsService.reset()
    const s = settingsService.getSettings()
    // reset 后应回到默认
    expect(s.general.theme).toBe('dark')
    expect(s.general.language).toBe('zh-CN')
  })
})
