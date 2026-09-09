// =============================================================
// DB Service — 过期数据清理 / 统计
// 从 db-service.ts DBService.cleanup / cleanupOldData / getStats 下沉
// (纯重构,逻辑逐字搬移)
// =============================================================

import { errText } from '../../utils/err-text'
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
    const msg = errText(err)
    ctx.setError(msg)
    console.error('[DB] cleanup failed:', msg)
  }
  return { executions, logs }
}

/** RISK 修复: 清理过期数据,防止 DB 无限增长
 *  - chat_messages: 保留最近 90 天
 *  - agent_executions: 保留最近 90 天
 *
 *  分块异步版(流畅度 2026-09-02): 原实现一次事务同步删最多 2×10000 行,
 *  24h 定时触发落在交互中可阻塞主进程 50-500ms — 现每块默认 1000 行,
 *  块间 setTimeout 让出事件循环,循环到追平(或安全上限)。
 */
export async function cleanupOldData(
  ctx: DbClient,
  maxAgeDays = 90,
  batchSize = 1000,
  maxBatches = 100,
): Promise<{ messages: number; executions: number }> {
  if (!ctx.ready || !ctx.db) return { messages: 0, executions: 0 }
  const db = ctx.db
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
  const delMessages = db.prepare(
    'DELETE FROM chat_messages WHERE rowid IN (SELECT rowid FROM chat_messages WHERE timestamp < ? LIMIT ?)',
  )
  const delExecs = db.prepare(
    'DELETE FROM agent_executions WHERE rowid IN (SELECT rowid FROM agent_executions WHERE started_at < ? LIMIT ?)',
  )
  let messages = 0
  let executions = 0
  try {
    for (let i = 0; i < maxBatches; i++) {
      const m = delMessages.run(cutoff, batchSize)
      const e = delExecs.run(cutoff, batchSize)
      messages += Number(m.changes)
      executions += Number(e.changes)
      // 两类都不足一块 = 已追平,提前结束
      if (Number(m.changes) < batchSize && Number(e.changes) < batchSize) break
      // 让出事件循环 — 主进程继续处理 IPC/EAA 子进程泵/状态推送
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (messages + executions > 0) {
      console.log(
        `[DB] Cleanup(chunked): removed ${messages} messages / ${executions} executions (cutoff=${new Date(cutoff).toISOString()})`,
      )
    }
  } catch (err) {
    console.error('[DB] Cleanup failed:', err)
  }
  return { messages, executions }
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
