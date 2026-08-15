// =============================================================
// Scheduler 模块纯函数 — 状态推导/过滤/格式化（无副作用）
// =============================================================

import type { CronLogEntry } from '@shared/types'

/** 任务最近一次执行状态 → 展示文本 */
export function cronStatusLabel(status?: string): string {
  switch (status) {
    case 'success':
      return '成功'
    case 'error':
      return '失败'
    case 'timeout':
      return '超时'
    case 'skipped_circuit_breaker':
      return '已暂停(配额熔断)'
    case 'skipped':
      // F2 修复: bitableSync 返回 skipped 字段(如开关已关闭)时的状态
      return '已跳过'
    default:
      return ''
  }
}

/** 任务最近一次执行状态 → 颜色 class */
export function cronStatusColor(status?: string): string {
  switch (status) {
    case 'success':
      return 'text-green-500 dark:text-green-400'
    case 'error':
      return 'text-red-500 dark:text-red-400'
    case 'timeout':
      return 'text-yellow-500 dark:text-yellow-400'
    case 'skipped_circuit_breaker':
      return 'text-orange-500 dark:text-orange-400'
    case 'skipped':
      // F2 修复: 与 cronStatusLabel 的 'skipped' 分支配套
      return 'text-gray-500 dark:text-gray-400'
    default:
      return 'text-gray-400 dark:text-gray-600'
  }
}

/** 日志时间格式化: HH:mm:ss */
export function formatLogTime(timestamp: number): string {
  const time = new Date(timestamp)
  return `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`
}

/** 按选中任务过滤日志（未选中时返回全部） */
export function selectLogsForTask(logs: CronLogEntry[], taskId: string | null): CronLogEntry[] {
  return taskId ? logs.filter((l) => l.taskId === taskId) : logs
}

/** 取最近 limit 条日志（倒序,返回新数组） */
export function getRecentLogs(logs: CronLogEntry[], limit: number): CronLogEntry[] {
  return [...logs].reverse().slice(0, limit)
}

/** 是否为 Agent schedule 自动生成的任务（不可编辑/删除） */
export function isAutoTask(id: string): boolean {
  return id.startsWith('agent-schedule-')
}
