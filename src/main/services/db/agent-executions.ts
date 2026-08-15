// =============================================================
// Agent 执行记录 CRUD
// 从 db-service.ts DBService 对应方法拆分而来（逻辑逐字搬移,行为零变化）
// =============================================================

import type { DbClient } from './statements'
import type { AgentExecutionRecord } from './types'

/**
 * 记录一次 agent 执行开始。返回 execution id,后续 updateExecution 用。
 * 失败返回 -1。
 */
export function recordExecutionStart(ctx: DbClient, agentId: string, prompt: string): number {
  if (!ctx.ready || !ctx.stmts.insertExecution) return -1
  try {
    const result = ctx.stmts.insertExecution.run({
      agent_id: agentId,
      started_at: Date.now(),
      status: 'running',
      prompt,
    })
    return Number(result.lastInsertRowid)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] recordExecutionStart failed:', msg)
    return -1
  }
}

/**
 * 更新一次 agent 执行的结束状态。
 * - costTotal 必须为有限数,否则存 NULL
 * - 字段为 undefined 时不覆盖
 */
export function updateExecution(
  ctx: DbClient,
  id: number,
  fields: {
    status: 'success' | 'failure' | 'aborted'
    output?: string
    error?: string
    tokensInput?: number
    tokensOutput?: number
    costTotal?: number
  },
): boolean {
  if (!ctx.ready || !ctx.stmts.updateExecution) return false
  try {
    const cost =
      fields.costTotal !== undefined && Number.isFinite(fields.costTotal) ? fields.costTotal : null
    // 修复: 检查 changes,对不存在的 id 返回 false (此前 UPDATE 不匹配行不报错,误返回 true)
    const result = ctx.stmts.updateExecution.run({
      id,
      finished_at: Date.now(),
      status: fields.status,
      output: fields.output ?? null,
      error: fields.error ?? null,
      tokens_input: fields.tokensInput ?? null,
      tokens_output: fields.tokensOutput ?? null,
      cost_total: cost,
    })
    return (result.changes ?? 0) > 0
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] updateExecution failed:', msg)
    return false
  }
}

export function getExecutionHistory(
  ctx: DbClient,
  agentId: string | null,
  limit = 100,
): AgentExecutionRecord[] {
  if (!ctx.ready || !ctx.stmts.selectExecutionHistory) return []
  try {
    const rows = ctx.stmts.selectExecutionHistory.all(agentId, agentId, limit)
    return rows as AgentExecutionRecord[]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] getExecutionHistory failed:', msg)
    return []
  }
}
