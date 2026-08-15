// =============================================================
// 日志格式化 — 行格式 / 值序列化 / 日期文件名
// =============================================================

import type { LogLevel } from './levels'

export function fmt(level: LogLevel, scope: string, msg: string): string {
  const t = new Date().toISOString()
  return `${t} [${level.toUpperCase()}] [${scope}] ${msg}`
}

export function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** 今天的日期串(YYYY-MM-DD,用于日志文件名) */
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
