import { describe, expect, it } from 'vitest'
import { isTimeInWindow, parseHhMm, shouldWebUiListen, zonedClock } from '../../src/main/services/webui/schedule'

describe('webui schedule', () => {
  it('parseHhMm 接受合法时刻', () => {
    expect(parseHhMm('08:00')).toEqual({ minutes: 8 * 60 })
    expect(parseHhMm('23:59')).toEqual({ minutes: 23 * 60 + 59 })
    expect(parseHhMm('24:00')).toBeNull()
    expect(parseHhMm('9:00')).toBeNull()
  })

  it('isTimeInWindow 支持同日窗口与跨午夜', () => {
    expect(isTimeInWindow(8 * 60, '08:00', '22:00')).toBe(true)
    expect(isTimeInWindow(7 * 60, '08:00', '22:00')).toBe(false)
    expect(isTimeInWindow(23 * 60, '22:00', '06:00')).toBe(true)
    expect(isTimeInWindow(5 * 60, '22:00', '06:00')).toBe(true)
    expect(isTimeInWindow(12 * 60, '22:00', '06:00')).toBe(false)
  })

  it('shouldWebUiListen: off / always / scheduled', () => {
    const base = {
      timezone: 'UTC',
      start: '00:00',
      end: '23:59',
      days: [0, 1, 2, 3, 4, 5, 6],
    }
    expect(shouldWebUiListen({ ...base, mode: 'off' })).toBe(false)
    expect(shouldWebUiListen({ ...base, mode: 'always' })).toBe(true)
    expect(shouldWebUiListen({ ...base, mode: 'scheduled' })).toBe(true)
    expect(shouldWebUiListen({ ...base, mode: 'scheduled', days: [] })).toBe(false)
  })

  it('zonedClock 返回 0-6 的星期与分钟', () => {
    const clock = zonedClock(new Date('2026-09-10T00:00:00Z'), 'UTC')
    expect(clock.day).toBeGreaterThanOrEqual(0)
    expect(clock.day).toBeLessThanOrEqual(6)
    expect(clock.minutes).toBeGreaterThanOrEqual(0)
    expect(clock.minutes).toBeLessThan(24 * 60)
  })
})
