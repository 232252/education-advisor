// =============================================================
// formatRelativeTime — 通知时间相对格式化测试
// =============================================================

import { describe, expect, it } from 'vitest'
import { tr } from '../../../i18n'
import { formatRelativeTime } from '../relative-time'

// 注入真 tr: 占位符替换/key 优先于 fallback 的语义已在 i18n 单测覆盖,
// 此处验证 formatRelativeTime 的分支选择与占位符传递
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatRelativeTime', () => {
  it('1 分钟内 → 刚刚', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 30_000, now, tr)).toBe('刚刚')
    expect(formatRelativeTime(now - 59_000, now, tr)).toBe('刚刚')
  })

  it('分钟级 → N 分钟前', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 5 * MIN, now, tr)).toBe('5 分钟前')
    expect(formatRelativeTime(now - 59 * MIN, now, tr)).toBe('59 分钟前')
  })

  it('小时级 → N 小时前', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 1 * HOUR, now, tr)).toBe('1 小时前')
    expect(formatRelativeTime(now - 23 * HOUR, now, tr)).toBe('23 小时前')
  })

  it('1 天前 → 昨天', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 1 * DAY, now, tr)).toBe('昨天')
    expect(formatRelativeTime(now - 1.5 * DAY, now, tr)).toBe('昨天')
  })

  it('2-6 天 → N 天前', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 2 * DAY, now, tr)).toBe('2 天前')
    expect(formatRelativeTime(now - 6 * DAY, now, tr)).toBe('6 天前')
  })

  it('7 天及以上 → 本周(上限兜底)', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 7 * DAY, now, tr)).toBe('本周')
    expect(formatRelativeTime(now - 30 * DAY, now, tr)).toBe('本周')
  })

  it('tr 函数的 i18n key 请求(分支应请求正确 key)', () => {
    const keys: string[] = []
    const recorder = (key: string, _vars: Record<string, string | number>, fallback?: string) => {
      keys.push(key)
      return fallback ?? key
    }
    formatRelativeTime(Date.now() - 30_000, Date.now(), recorder)
    expect(keys).toContain('time.justNow')
  })
})
