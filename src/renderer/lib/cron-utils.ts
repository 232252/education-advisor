// =============================================================
// Cron 表达式校验 — 共享工具模块
// 从 SchedulerPage 提取，供多处复用。
// 格式: minute hour day-of-month month day-of-week
// 支持: * / - , 数字, */n, a-b/n, @yearly/@daily 等宏
// =============================================================

export interface CronValidationResult {
  valid: boolean
  error?: string
}

const CRON_FIELD_RANGES = [
  { name: '分钟', min: 0, max: 59 },
  { name: '小时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12 },
  { name: '周', min: 0, max: 7 }, // 0 和 7 都是周日
] as const

const CRON_MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

function validateCronField(
  field: string,
  range: { name: string; min: number; max: number },
): string | null {
  if (field === '*') return null
  const subFields = field.split(',')
  for (const sub of subFields) {
    if (sub === '') return `空字段 "${field}"`
    // 处理 */n
    if (sub.startsWith('*/')) {
      const step = Number.parseInt(sub.slice(2), 10)
      if (Number.isNaN(step) || step < 1) return `步长 "${sub}" 无效`
      continue
    }
    // 处理 a-b 或 a-b/n
    const rangeMatch = sub.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (rangeMatch) {
      const [, startStr, endStr, stepStr] = rangeMatch
      const start = Number.parseInt(startStr, 10)
      const end = Number.parseInt(endStr, 10)
      const effectiveMaxStart = range.name === '周' && start === 7 ? 7 : range.max
      const effectiveMaxEnd = range.name === '周' && end === 7 ? 7 : range.max
      if (start < range.min || start > effectiveMaxStart)
        return `${start} 超出范围 ${range.min}-${range.max}`
      if (end < range.min || end > effectiveMaxEnd)
        return `${end} 超出范围 ${range.min}-${range.max}`
      if (stepStr) {
        const step = Number.parseInt(stepStr, 10)
        if (step < 1) return `步长 ${step} 无效`
      }
      continue
    }
    // 处理纯数字
    const num = Number.parseInt(sub, 10)
    if (Number.isNaN(num)) return `"${sub}" 不是有效数字`
    // 周的特殊处理: 0 和 7 都表示周日
    const effectiveMax = range.name === '周' && num === 7 ? 7 : range.max
    if (num < range.min || num > effectiveMax) return `${num} 超出范围 ${range.min}-${range.max}`
  }
  return null
}

/** 基本 cron 表达式校验 — 5 段格式 + 每段范围检查
 *  支持宏表达式 (@daily, @hourly 等,与 node-cron 兼容) */
export function validateCron(expr: string): CronValidationResult {
  if (!expr || typeof expr !== 'string') return { valid: false, error: '表达式不能为空' }
  // 宏表达式支持 (@daily 等与 node-cron 兼容)
  const macroKey = expr.trim().toLowerCase()
  if (macroKey.startsWith('@')) {
    if (macroKey in CRON_MACROS) return { valid: true }
    return {
      valid: false,
      error: `未知宏表达式: ${expr} (支持: @yearly/@monthly/@weekly/@daily/@hourly)`,
    }
  }
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { valid: false, error: '需要 5 段: 分 时 日 月 周' }
  for (let i = 0; i < 5; i++) {
    const err = validateCronField(parts[i], CRON_FIELD_RANGES[i])
    if (err) return { valid: false, error: `${CRON_FIELD_RANGES[i].name}: ${err}` }
  }
  return { valid: true }
}

/** Cron 预设快捷选项 */
export const CRON_PRESETS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 8:00', value: '0 8 * * *' },
  { label: '每周一 9:00', value: '0 9 * * 1' },
  { label: '每月 1 号', value: '0 0 1 * *' },
] as const
