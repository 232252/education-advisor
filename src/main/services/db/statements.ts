// =============================================================
// DB 预编译语句缓存 — 结构定义与统一 prepare
// 从 db-service.ts DBService.prepareStatements / this.stmts 拆分而来
// （SQL 逐字搬移,纯重构,行为零变化）
// =============================================================

type Database = import('better-sqlite3').Database
type Statement = import('better-sqlite3').Statement

/** 预编译语句缓存（字段与原 DBService.stmts 一一对应） */
export interface DbStatements {
  insertExecution?: Statement
  updateExecution?: Statement
  selectExecutionById?: Statement
  selectExecutionHistory?: Statement
  deleteOldExecutions?: Statement
  countExecutions?: Statement
  insertCronLog?: Statement
  selectCronLogs?: Statement
  deleteOldCronLogs?: Statement
  countCronLogs?: Statement
  insertChatMessage?: Statement
  selectChatMessages?: Statement
  deleteChatSession?: Statement
  deleteChatSessionMeta?: Statement
  countChatMessages?: Statement
  getSessionTitle?: Statement
  upsertChatSession?: Statement
  upsertSessionMeta?: Statement
  listChatSessions?: Statement
  // 班级管理
  insertClass?: Statement
  updateClass?: Statement
  selectClassById?: Statement
  selectClassByClassId?: Statement
  listClasses?: Statement
  deleteClass?: Statement
}

/**
 * 领域函数运行上下文 — DBService 把自身状态投影给 db/ 子模块。
 * - ready  对应 DBService._ready
 * - db     对应 DBService.db
 * - stmts  对应 DBService.stmts
 * - setError 对应 DBService._lastError 赋值
 */
export interface DbClient {
  ready: boolean
  db: Database | null
  stmts: DbStatements
  setError(msg: string): void
}

/** 预编译全部语句（SQL 与原 prepareStatements 逐字一致） */
export function prepareAllStatements(db: Database | null): DbStatements {
  const stmts: DbStatements = {}
  if (!db) return stmts
  stmts.insertExecution = db.prepare(`
      INSERT INTO agent_executions
        (agent_id, started_at, status, prompt)
      VALUES (@agent_id, @started_at, @status, @prompt)
    `)
  stmts.updateExecution = db.prepare(`
      UPDATE agent_executions SET
        finished_at = @finished_at,
        status = @status,
        output = @output,
        error = @error,
        tokens_input = @tokens_input,
        tokens_output = @tokens_output,
        cost_total = @cost_total
      WHERE id = @id
    `)
  stmts.selectExecutionById = db.prepare(`SELECT * FROM agent_executions WHERE id = ?`)
  stmts.selectExecutionHistory = db.prepare(`
      SELECT * FROM agent_executions
      WHERE agent_id = ? OR ? IS NULL
      ORDER BY started_at DESC
      LIMIT ?
    `)
  stmts.deleteOldExecutions = db.prepare(`DELETE FROM agent_executions WHERE started_at < ?`)
  stmts.countExecutions = db.prepare(`SELECT COUNT(*) as count FROM agent_executions`)
  stmts.insertCronLog = db.prepare(`
      INSERT INTO cron_logs (task_id, level, message, timestamp, metadata)
      VALUES (@task_id, @level, @message, @timestamp, @metadata)
    `)
  stmts.selectCronLogs = db.prepare(`
      SELECT * FROM cron_logs
      WHERE task_id = ? OR ? IS NULL
      ORDER BY timestamp DESC
      LIMIT ?
    `)
  stmts.deleteOldCronLogs = db.prepare(`DELETE FROM cron_logs WHERE timestamp < ?`)
  stmts.countCronLogs = db.prepare(`SELECT COUNT(*) as count FROM cron_logs`)

  // Chat message statements
  stmts.insertChatMessage = db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, thinking, tool_calls, timestamp, provider, model, token_input, token_output, cost)
      VALUES (@session_id, @role, @content, @thinking, @tool_calls, @timestamp, @provider, @model, @token_input, @token_output, @cost)
    `)
  stmts.selectChatMessages = db.prepare(`
      SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC
    `)
  stmts.deleteChatSession = db.prepare(`
      DELETE FROM chat_messages WHERE session_id = ?
    `)
  stmts.deleteChatSessionMeta = db.prepare(`
      DELETE FROM chat_sessions WHERE id = ?
    `)
  stmts.countChatMessages = db.prepare(`
      SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?
    `)
  stmts.getSessionTitle = db.prepare(`
      SELECT title FROM chat_sessions WHERE id = ?
    `)
  stmts.upsertChatSession = db.prepare(`
      INSERT INTO chat_sessions (id, title, provider, model, created_at, updated_at, message_count)
      VALUES (@id, @title, @provider, @model, @created_at, @updated_at, @message_count)
      ON CONFLICT(id) DO UPDATE SET
        title = COALESCE(NULLIF(@title, ''), chat_sessions.title),
        updated_at = @updated_at,
        message_count = @message_count
    `)
  // 预编译 syncSessionMeta 语句 (增量更新 message_count,避免每次 saveChatMessage 都 prepare)
  stmts.upsertSessionMeta = db.prepare(`
      INSERT INTO chat_sessions (id, title, provider, model, created_at, updated_at, message_count)
      VALUES (?, ?, NULL, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        model = COALESCE(NULLIF(?, ''), chat_sessions.model),
        updated_at = ?,
        message_count = chat_sessions.message_count + 1
    `)
  stmts.listChatSessions = db.prepare(`
      SELECT * FROM chat_sessions ORDER BY updated_at DESC
    `)

  // 班级管理预编译语句
  stmts.insertClass = db.prepare(`
      INSERT INTO classes (id, class_id, name, grade, note, archived, created_at, archived_at, teacher)
      VALUES (@id, @class_id, @name, @grade, @note, @archived, @created_at, @archived_at, @teacher)
    `)
  stmts.updateClass = db.prepare(`
      UPDATE classes SET
        name = COALESCE(NULLIF(@name, ''), name),
        grade = @grade,
        note = @note,
        archived = @archived,
        archived_at = @archived_at,
        teacher = @teacher
      WHERE id = @id
    `)
  stmts.selectClassById = db.prepare(`SELECT * FROM classes WHERE id = ?`)
  stmts.selectClassByClassId = db.prepare(`SELECT * FROM classes WHERE class_id = ?`)
  stmts.listClasses = db.prepare(`SELECT * FROM classes ORDER BY archived ASC, created_at DESC`)
  stmts.deleteClass = db.prepare(`DELETE FROM classes WHERE id = ?`)
  return stmts
}
