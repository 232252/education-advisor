// =============================================================
// Cron 表达式校验纯函数
// 从 cron-service.ts 抽出,逻辑零修改(逐行对照搬迁)
// =============================================================

import cron from 'node-cron'
import { log } from '../../utils/logger'

/**
 * 判断 5 字段 cron 表达式是否"过于激进"(触发间隔 < minMinutes 分钟)。
 * 用于防止 bitable 同步等系统任务被配置成每秒/每分钟执行,导致 LLM/API 成本失控。
 *
 * 策略: 解析分钟字段,若为星号(每分钟)或"星号斜杠 N"步进(N < minMinutes)则判定为激进。
 * 仅做保守下限判断,不覆盖所有边界情况——足够拦截最常见的危险配置。
 */
export function isTooAggressiveCron(expr: string, minMinutes = 5): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length < 5) return false
  const minuteField = fields[0]
  // `*` = 每分钟
  if (minuteField === '*') return true
  // `*/N` = 每 N 分钟
  const stepMatch = minuteField.match(/^\*\/(\d+)$/)
  if (stepMatch) {
    const step = Number(stepMatch[1])
    return Number.isFinite(step) && step < minMinutes
  }
  return false
}

/**
 * 根据 settings.feishu.bitableSync.syncInterval 解析出安全合法的 cron 表达式。
 * 从 CronService.registerBitableSync 抽出,逻辑逐行对照搬迁。
 * syncInterval 可能是 cron 表达式(包含空格)或分钟数。
 */
export function resolveBitableSyncExpression(intervalRaw: string | number): string {
  let expr: string
  if (typeof intervalRaw === 'string' && intervalRaw.trim().split(/\s+/).length >= 5) {
    // 已经是完整的 cron 表达式（5 字段）。B6-2 修复: 必须通过 node-cron 校验,
    // 否则任意 "a b c d e" 或 "* * * * *" 都会被当作合法 cron,导致无限/错误调度。
    const candidate = intervalRaw.trim()
    if (!cron.validate(candidate)) {
      log(
        'warn',
        'cron',
        `bitableSync.syncInterval='${candidate}' 不是合法 cron 表达式,回退到默认 6 小时`,
      )
      expr = '0 */6 * * *'
    } else if (isTooAggressiveCron(candidate)) {
      // B6-2 修复: 拒绝过于激进的调度(如每秒/每分钟),防止 bitable 同步+LLM 成本失控
      log(
        'warn',
        'cron',
        `bitableSync.syncInterval='${candidate}' 过于激进(< 5 分钟),已放宽到每 5 分钟以控制成本`,
      )
      expr = '*/5 * * * *'
    } else {
      expr = candidate
    }
  } else {
    // 视为分钟数，转换为 cron 表达式
    const minutes = typeof intervalRaw === 'number' ? intervalRaw : Number(intervalRaw) || 360
    if (minutes < 60) {
      // B6-2: 分钟数模式下也强制不低于 5 分钟
      const safeMinutes = Math.max(5, Math.round(minutes))
      expr = `*/${safeMinutes} * * * *`
    } else {
      const hours = Math.max(1, Math.round(minutes / 60))
      expr = `0 */${Math.min(23, hours)} * * *`
    }
  }
  return expr
}
