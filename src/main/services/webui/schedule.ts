// =============================================================
// WebUI 定时窗口 — 按时区判断「现在该不该监听」
// days: JS getDay() 约定 0=周日 … 6=周六
// start/end 为 HH:mm; start>end 视为跨午夜
// =============================================================

import type { WebUiMode } from '@shared/types'

export type { WebUiMode }

export interface WebUiScheduleInput {
  mode: WebUiMode
  timezone: string
  start: string
  end: string
  days: number[]
}

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseHhMm(value: string): { minutes: number } | null {
  if (typeof value !== 'string' || !HH_MM.test(value)) return null
  const [h, m] = value.split(':').map((n) => Number(n))
  return { minutes: h * 60 + m }
}

function weekdayFromShort(short: string): number {
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return map[short] ?? 0
}

export function zonedClock(now: Date, timeZone: string): { day: number; minutes: number } {
  let tz = timeZone
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(now)
  } catch {
    tz = 'UTC'
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  return { day: weekdayFromShort(weekday), minutes: hour * 60 + minute }
}

export function isTimeInWindow(nowMinutes: number, start: string, end: string): boolean {
  const s = parseHhMm(start)
  const e = parseHhMm(end)
  if (!s || !e) return false
  if (s.minutes === e.minutes) return true
  if (s.minutes < e.minutes) return nowMinutes >= s.minutes && nowMinutes < e.minutes
  return nowMinutes >= s.minutes || nowMinutes < e.minutes
}

/** 当前设置下网关是否应该处于监听状态 */
export function shouldWebUiListen(input: WebUiScheduleInput, now = new Date()): boolean {
  if (input.mode === 'off') return false
  if (input.mode === 'always') return true
  const days = Array.isArray(input.days)
    ? input.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : []
  if (days.length === 0) return false
  const clock = zonedClock(now, input.timezone || 'UTC')
  if (!days.includes(clock.day)) return false
  return isTimeInWindow(clock.minutes, input.start, input.end)
}
