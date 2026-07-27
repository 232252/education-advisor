// =============================================================
// eaa-reason-codes 测试 — 合并 lookupReasonCodeDelta/getReasonCodeDef
// 消除 eaa-handlers.ts L26-71 的重复缓存逻辑
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getReasonCodeDef, lookupReasonCodeDelta, resetReasonCodesCache } from '../eaa-reason-codes'

// mock fs 同步读取,避免依赖真实 config/reason-codes.json 文件
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() =>
      JSON.stringify({
        LATE: { delta: -2.0 },
        ABSENT: { delta: -5.0 },
        BONUS: { delta: null }, // 变量分值,delta 为 null
      }),
    ),
  },
}))

beforeEach(() => {
  resetReasonCodesCache()
  vi.clearAllMocks()
})

describe('lookupReasonCodeDelta', () => {
  it('返回固定分值原因码的 delta', () => {
    expect(lookupReasonCodeDelta('LATE')).toBe(-2.0)
    expect(lookupReasonCodeDelta('ABSENT')).toBe(-5.0)
  })

  it('delta 为 null 时返回 undefined', () => {
    expect(lookupReasonCodeDelta('BONUS')).toBeUndefined()
  })

  it('未知原因码返回 undefined', () => {
    expect(lookupReasonCodeDelta('UNKNOWN')).toBeUndefined()
  })

  it('第二次调用命中缓存,不重复读文件', async () => {
    const fs = (await import('node:fs')).default
    lookupReasonCodeDelta('LATE')
    lookupReasonCodeDelta('ABSENT')
    lookupReasonCodeDelta('LATE')
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })
})

describe('getReasonCodeDef', () => {
  it('返回完整定义(含 null delta)', () => {
    expect(getReasonCodeDef('LATE')).toEqual({ delta: -2.0 })
    expect(getReasonCodeDef('BONUS')).toEqual({ delta: null })
  })

  it('未知原因码返回 undefined', () => {
    expect(getReasonCodeDef('UNKNOWN')).toBeUndefined()
  })

  it('与 lookupReasonCodeDelta 共享同一份缓存', async () => {
    const fs = (await import('node:fs')).default
    lookupReasonCodeDelta('LATE') // 触发首次读取
    getReasonCodeDef('ABSENT') // 应命中缓存
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })
})

describe('文件缺失/损坏的容错', () => {
  it('文件不存在时返回 undefined 且缓存空对象', async () => {
    const fs = (await import('node:fs')).default
    vi.mocked(fs.existsSync).mockReturnValue(false)
    expect(lookupReasonCodeDelta('LATE')).toBeUndefined()
    // 第二次调用不应再次 stat(命中空缓存)
    const callsBefore = vi.mocked(fs.existsSync).mock.calls.length
    lookupReasonCodeDelta('ABSENT')
    expect(vi.mocked(fs.existsSync).mock.calls.length).toBe(callsBefore)
  })

  it('JSON 解析失败时缓存空对象避免反复尝试', async () => {
    const fs = (await import('node:fs')).default
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValueOnce('not valid json {{{')
    expect(() => lookupReasonCodeDelta('LATE')).not.toThrow()
    expect(lookupReasonCodeDelta('LATE')).toBeUndefined()
    // 第二次不应再 readFileSync(命中空缓存)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })
})
