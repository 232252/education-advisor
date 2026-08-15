// =============================================================
// Cron 日志 CRUD
// 从 db-service.ts DBService 对应方法拆分而来（逻辑逐字搬移,行为零变化）
// =============================================================

import type { DbClient } from './statements'
import type { CronLogRecord } from './types'

export function recordCronLog(
  ctx: DbClient,
  taskId: string,
  level: CronLogRecord['level'],
  message: string,
  metadata?: Record<string, unknown>,
): boolean {
  if (!ctx.ready || !ctx.stmts.insertCronLog) return false
  try {
    ctx.stmts.insertCronLog.run({
      task_id: taskId,
      level,
      message,
      timestamp: Date.now(),
      metadata: metadata ? JSON.stringify(metadata) : null,
    })
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] recordCronLog failed:', msg)
    return false
  }
}

export function getCronLogs(ctx: DbClient, taskId: string | null, limit = 200): CronLogRecord[] {
  if (!ctx.ready || !ctx.stmts.selectCronLogs) return []
  try {
    const rows = ctx.stmts.selectCronLogs.all(taskId, taskId, limit)
    return rows as CronLogRecord[]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] getCronLogs failed:', msg)
    return []
  }
}
