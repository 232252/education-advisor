// =============================================================
// DB Service — 过期数据清理 / 统计
// 从 db-service.ts DBService.cleanup / cleanupOldData / getStats 下沉
// (纯重构,逻辑逐字搬移)
// =============================================================

import type { DbClient } from './statements'

/**
 * 清理超过 maxAgeMs 的旧记录,默认 30 天。
 * 返回删除的总行数。
 */
export function cleanup(
  ctx: DbClient,
  maxAgeMs = 30 * 24 * 60 * 60 * 1000,
): { executions: number; logs: number } {
  if (!ctx.ready || !ctx.db) return { executions: 0, logs: 0 }
  const cutoff = Date.now() - maxAgeMs
  let executions = 0
  let logs = 0
  try {
    if (ctx.stmts.deleteOldExecutions) {
      const r = ctx.stmts.deleteOldExecutions.run(cutoff)
      executions = Number(r.changes)
    }
    if (ctx.stmts.deleteOldCronLogs) {
      const r = ctx.stmts.deleteOldCronLogs.run(cutoff)
      logs = Number(r.changes)
    }
    // WAL checkpoint 释放磁盘空间
    ctx.db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] cleanup failed:', msg)
  }
  return { executions, logs }
}

/** RISK 修复: 清理过期数据,防止 DB 无限增长
 *  - chat_messages: 保留最近 90 天
 *  - agent_executions: 保留最近 90 天
 *  - 每次最多删除 10000 条,防止长时间阻塞 */
export function cleanupOldData(ctx: DbClient, maxAgeDays = 90, batchSize = 10000): void {
  if (!ctx.ready || !ctx.db) return
  // M-8 修复: 捕获 db 引用到局部变量,避免事务内可选链返回 undefined 导致 .get()/.run() 抛 TypeError
  const db = ctx.db
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  try {
    const tx = db.transaction(() => {
      // 先查数量,避免不必要的 DELETE
      const msgCount = db
        .prepare('SELECT COUNT(*) as n FROM chat_messages WHERE timestamp < ?')
        .get(cutoff) as { n: number }
      if (msgCount.n > 0) {
        db.prepare(
          'DELETE FROM chat_messages WHERE rowid IN (SELECT rowid FROM chat_messages WHERE timestamp < ? LIMIT ?)',
        ).run(cutoff, batchSize)
      }
      const execCount = db
        .prepare('SELECT COUNT(*) as n FROM agent_executions WHERE started_at < ?')
        .get(cutoff) as { n: number }
      if (execCount.n > 0) {
        db.prepare(
          'DELETE FROM agent_executions WHERE rowid IN (SELECT rowid FROM agent_executions WHERE started_at < ? LIMIT ?)',
        ).run(cutoff, batchSize)
      }
    })
    tx()
    console.log(
      `[DB] Cleanup: removed old messages/executions (cutoff=${new Date(cutoff).toISOString()})`,
    )
  } catch (err) {
    console.error('[DB] Cleanup failed:', err)
  }
}

/**
 * 获取统计信息（用于设置页面 / 调试）。
 */
export function getStats(
  ctx: DbClient,
  dbPath: string,
): { executions: number; logs: number; ready: boolean; path: string } {
  let executions = 0
  let logs = 0
  if (ctx.ready) {
    try {
      if (ctx.stmts.countExecutions) {
        const r = ctx.stmts.countExecutions.get() as { count: number } | undefined
        executions = r?.count ?? 0
      }
      if (ctx.stmts.countCronLogs) {
        const r = ctx.stmts.countCronLogs.get() as { count: number } | undefined
        logs = r?.count ?? 0
      }
    } catch (err) {
      // Medium 修复: 不再静默吞错,记录错误日志便于排查
      console.error('[DB] getStats failed:', err)
    }
  }
  return { executions, logs, ready: ctx.ready, path: dbPath }
}
