// =============================================================
// Chat 消息 / 会话 CRUD
// 从 db-service.ts DBService 对应方法拆分而来（逻辑逐字搬移,行为零变化）
// =============================================================

import type { DbClient } from './statements'

export function saveChatMessage(
  ctx: DbClient,
  msg: {
    sessionId?: string
    role: string
    content: string
    thinking?: string
    toolCalls?: string
    timestamp: number
    provider?: string
    model?: string
    tokenInput?: number
    tokenOutput?: number
    cost?: number
  },
): number {
  if (!ctx.ready || !ctx.stmts.insertChatMessage) return -1
  try {
    const result = ctx.stmts.insertChatMessage.run({
      session_id: msg.sessionId ?? 'default',
      role: msg.role,
      content: msg.content,
      thinking: msg.thinking ?? null,
      tool_calls: msg.toolCalls ?? null,
      timestamp: msg.timestamp,
      provider: msg.provider ?? null,
      model: msg.model ?? null,
      token_input: msg.tokenInput ?? null,
      token_output: msg.tokenOutput ?? null,
      cost: msg.cost ?? null,
    })
    // Upsert session metadata (message_count, updated_at, model)
    syncSessionMeta(ctx, msg.sessionId ?? 'default', msg.model, msg.timestamp)
    return Number(result.lastInsertRowid)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    ctx.setError(errMsg)
    console.error('[DB] saveChatMessage failed:', errMsg)
    return -1
  }
}

/** 同步 chat_sessions 元数据（消息计数、更新时间、模型）
 *  PERF 优化: 用增量更新 message_count = message_count + 1 替代 COUNT 查询,
 *  避免每次 saveChatMessage 都执行全表扫描 COUNT */
function syncSessionMeta(
  ctx: DbClient,
  sessionId: string,
  model?: string,
  timestamp?: number,
): void {
  if (!ctx.ready || !ctx.stmts.upsertSessionMeta) return
  try {
    // 使用预编译语句,避免每次 saveChatMessage 都重新 prepare SQL
    ctx.stmts.upsertSessionMeta.run(
      sessionId,
      `对话 ${new Date().toLocaleString()}`,
      model ?? null,
      timestamp ?? Date.now(),
      timestamp ?? Date.now(),
      model ?? null,
      timestamp ?? Date.now(),
    )
  } catch (err) {
    console.error('[DB] syncSessionMeta failed:', err)
  }
}

/** Load chat messages for a session */
export function loadChatMessages(
  ctx: DbClient,
  sessionId: string = 'default',
): Array<Record<string, unknown>> {
  if (!ctx.ready || !ctx.stmts.selectChatMessages) return []
  try {
    return ctx.stmts.selectChatMessages.all(sessionId) as Array<Record<string, unknown>>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] loadChatMessages failed:', msg)
    return []
  }
}

/** Delete all messages for a chat session AND the session record itself
 *  修复: 两步删除用事务包裹,保证原子性(要么全删,要么全不删) */
export function deleteChatSession(ctx: DbClient, sessionId: string): boolean {
  if (!ctx.ready || !ctx.db) return false
  try {
    const delMsgs = ctx.stmts.deleteChatSession
    const delMeta = ctx.stmts.deleteChatSessionMeta
    if (!delMsgs || !delMeta) return false
    // 事务保证原子性: 消息和会话记录要么同时删除,要么同时保留
    ctx.db.transaction(() => {
      delMsgs.run(sessionId)
      delMeta.run(sessionId)
    })()
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] deleteChatSession failed:', msg)
    return false
  }
}

/** List all chat sessions ordered by updated_at DESC */
export function listChatSessions(ctx: DbClient): Array<Record<string, unknown>> {
  if (!ctx.ready || !ctx.stmts.listChatSessions) return []
  try {
    return ctx.stmts.listChatSessions.all() as Array<Record<string, unknown>>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.setError(msg)
    console.error('[DB] listChatSessions failed:', msg)
    return []
  }
}
