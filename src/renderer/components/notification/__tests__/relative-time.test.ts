// =============================================================
// formatRelativeTime — 通知时间相对格式化测试
// =============================================================

import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from '../relative-time'

const t = (_key: string, fallback?: string) => fallback ?? _key
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatRelativeTime', () => {
  it('1 分钟内 → 刚刚', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 30_000, now, t)).toBe('刚刚')
    expect(formatRelativeTime(now - 59_000, now, t)).toBe('刚刚')
  })

  it('分钟级 → N 分钟前', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 5 * MIN, now, t)).toBe('5 分钟前')
    expect(formatRelativeTime(now - 59 * MIN, now, t)).toBe('59 分钟前')
  })

  it('小时级 → N 小时前', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 1 * HOUR, now, t)).toBe('1 小时前')
    expect(formatRelativeTime(now - 23 * HOUR, now, t)).toBe('23 小时前')
  })

  it('1 天前 → 昨天', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 1 * DAY, now, t)).toBe('昨天')
    expect(formatRelativeTime(now - 1.5 * DAY, now, t)).toBe('昨天')
  })

  it('2-6 天 → N 天前', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 2 * DAY, now, t)).toBe('2 天前')
    expect(formatRelativeTime(now - 6 * DAY, now, t)).toBe('6 天前')
  })

  it('7 天及以上 → 本周(上限兜底)', () => {
    const now = Date.now()
    expect(formatRelativeTime(now - 7 * DAY, now, t)).toBe('本周')
    expect(formatRelativeTime(now - 30 * DAY, now, t)).toBe('本周')
  })

  it('t 函数的 i18n key 优先于 fallback 顺序', () => {
    const tKeys: string[] = []
    const tRecorder = (key: string, fallback?: string) => {
      tKeys.push(key)
      return fallback ?? key
    }
    formatRelativeTime(Date.now() - 30_000, Date.now(), tRecorder)
    expect(tKeys).toContain('time.justNow')
  })
})
