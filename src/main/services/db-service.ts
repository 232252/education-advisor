// =============================================================
// DB Service — 基于 better-sqlite3 的本地落库
// 用途：agent 执行历史 / 定时任务日志 / 审计轨迹
// 修复：
//   P2-4: 实现 plan §5.8 承诺的 SQLite 持久化层
// 设计：
//   - 单例（避免重复打开 DB）
//   - 异步初始化（init() 在 app.whenReady 之后调用）
//   - 优雅降级（sqlite 加载失败时 isReady=false,所有方法 no-op,
//     主流程不中断）
//   - 同步 API（better-sqlite3 本身是同步的,不阻塞事件循环,
//     因为每个写操作 < 1ms）
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

// better-sqlite3 是 native 模块,可能加载失败（重新编译失败/平台不支持）
// 用 require 而非 import,让 try/catch 包裹更干净
// eslint-disable-next-line @typescript-eslint/no-require-imports
type BetterSqlite3 = typeof import('better-sqlite3')
type Database = import('better-sqlite3').Database
type Statement = import('better-sqlite3').Statement

/** agent 执行历史记录 */
export interface AgentExecutionRecord {
  id?: number
  agent_id: string
  started_at: number
  finished_at?: number
  status: 'running' | 'success' | 'failure' | 'aborted'
  prompt?: string
  output?: string
  error?: string
  tokens_input?: number
  tokens_output?: number
  cost_total?: number
}

/** 定时任务日志 */
export interface CronLogRecord {
  id?: number
  task_id: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  timestamp: number
  metadata?: string // JSON 字符串
}

/** 班级记录（本地存档/删除管理） */
export interface ClassRecord {
  id: string
  /** 班级编号，与 EAA 学生 class_id 对齐，如 "G7-3" */
  class_id: string
  /** 班级显示名称，如 "七年级3班" */
  name: string
  /** 年级，如 "七年级" */
  grade?: string
  /** 备注 */
  note?: string
  /** 是否已存档（不再教这个班，但保留数据，默认隐藏该班学生） */
  archived: 0 | 1
  created_at: number
  archived_at?: number
  /** 班主任姓名（可选） */
  teacher?: string | null
}

class DBService {
  private db: Database | null = null
  private dbPath: string = ''
  private _ready = false
  private _lastError: string | null = null
  /** CONCERN 修复: 定期清理定时器 (每 24 小时清理一次过期数据) */
  private cleanupTimer: NodeJS.Timeout | null = null
  /** 预编译语句缓存 */
  private stmts: {
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
    listChatSessions?: Statement
    // 班级管理
    insertClass?: Statement
    updateClass?: Statement
    selectClassById?: Statement
    selectClassByClassId?: Statement
    listClasses?: Statement
    deleteClass?: Statement
  } = {}

  /**
   * 异步初始化。必须在 app.whenReady() 之后调用。
   * 失败不抛异常,降级为 in-memory disabled 模式。
   */
  async init(): Promise<void> {
    if (this._ready) return
    try {
      const userData = app.getPath('userData')
      this.dbPath = path.join(userData, 'workstation.db')
      await fsp.mkdir(path.dirname(this.dbPath), { recursive: true })

      // 动态 require,允许失败降级
      const BetterSqlite3: BetterSqlite3 = require('better-sqlite3')
      this.db = new BetterSqlite3(this.dbPath)
      // WAL 模式提升并发读性能
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('foreign_keys = ON')

      this.createTables()
      this.prepareStatements()
      this._ready = true
      console.log(`[DB] SQLite ready at ${this.dbPath}`)
      // RISK 修复: 启动时自动清理过期数据,防止 DB 无限增长
      this.cleanupOldData()
      // CONCERN 修复: 定期清理 (每 24 小时),防止长时间运行的实例 DB 持续增长
      // batchSize=10000 可能追赶不上高频写入,定期清理确保最终一致
      this.cleanupTimer = setInterval(
        () => {
          this.cleanupOldData()
        },
        24 * 60 * 60 * 1000,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this._lastError = `Failed to init SQLite: ${msg}`
      console.warn(`[DB] ${this._lastError} — falling back to no-op mode`)
      this._ready = false
      this.db = null
    }
  }

  private createTables(): void {
    if (!this.db) return
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
        content TEXT NOT NULL,
        thinking TEXT,
        tool_calls TEXT,
        timestamp INTEGER NOT NULL,
        provider TEXT,
        model TEXT,
        token_input INTEGER,
        token_output INTEGER,
        cost REAL
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '新对话',
        provider TEXT,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at);

      CREATE TABLE IF NOT EXISTS agent_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL CHECK(status IN ('running','success','failure','aborted')),
        prompt TEXT,
        output TEXT,
        error TEXT,
        tokens_input INTEGER,
        tokens_output INTEGER,
        cost_total REAL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_executions_agent_id ON agent_executions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_executions_started_at ON agent_executions(started_at);

      CREATE TABLE IF NOT EXISTS cron_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('info','warn','error','debug')),
        message TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cron_logs_task_id ON cron_logs(task_id);
      CREATE INDEX IF NOT EXISTS idx_cron_logs_timestamp ON cron_logs(timestamp);

      CREATE TABLE IF NOT EXISTS classes (
        id TEXT PRIMARY KEY,
        class_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        grade TEXT,
        note TEXT,
        archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
        created_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_classes_archived ON classes(archived);
      -- arch-class-1: 班主任字段（v0.1 增量迁移，幂等）
      ALTER TABLE classes ADD COLUMN teacher TEXT;
    `)
  }

  private prepareStatements(): void {
    if (!this.db) return
    this.stmts.insertExecution = this.db.prepare(`
      INSERT INTO agent_executions
        (agent_id, started_at, status, prompt)
      VALUES (@agent_id, @started_at, @status, @prompt)
    `)
    this.stmts.updateExecution = this.db.prepare(`
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
    this.stmts.selectExecutionById = this.db.prepare(`SELECT * FROM agent_executions WHERE id = ?`)
    this.stmts.selectExecutionHistory = this.db.prepare(`
      SELECT * FROM agent_executions
      WHERE agent_id = ? OR ? IS NULL
      ORDER BY started_at DESC
      LIMIT ?
    `)
    this.stmts.deleteOldExecutions = this.db.prepare(
      `DELETE FROM agent_executions WHERE started_at < ?`,
    )
    this.stmts.countExecutions = this.db.prepare(`SELECT COUNT(*) as count FROM agent_executions`)
    this.stmts.insertCronLog = this.db.prepare(`
      INSERT INTO cron_logs (task_id, level, message, timestamp, metadata)
      VALUES (@task_id, @level, @message, @timestamp, @metadata)
    `)
    this.stmts.selectCronLogs = this.db.prepare(`
      SELECT * FROM cron_logs
      WHERE task_id = ? OR ? IS NULL
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    this.stmts.deleteOldCronLogs = this.db.prepare(`DELETE FROM cron_logs WHERE timestamp < ?`)
    this.stmts.countCronLogs = this.db.prepare(`SELECT COUNT(*) as count FROM cron_logs`)

    // Chat message statements
    this.stmts.insertChatMessage = this.db.prepare(`
      INSERT INTO chat_messages (session_id, role, content, thinking, tool_calls, timestamp, provider, model, token_input, token_output, cost)
      VALUES (@session_id, @role, @content, @thinking, @tool_calls, @timestamp, @provider, @model, @token_input, @token_output, @cost)
    `)
    this.stmts.selectChatMessages = this.db.prepare(`
      SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC
    `)
    this.stmts.deleteChatSession = this.db.prepare(`
      DELETE FROM chat_messages WHERE session_id = ?
    `)
    this.stmts.deleteChatSessionMeta = this.db.prepare(`
      DELETE FROM chat_sessions WHERE id = ?
    `)
    this.stmts.countChatMessages = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?
    `)
    this.stmts.getSessionTitle = this.db.prepare(`
      SELECT title FROM chat_sessions WHERE id = ?
    `)
    this.stmts.upsertChatSession = this.db.prepare(`
      INSERT INTO chat_sessions (id, title, provider, model, created_at, updated_at, message_count)
      VALUES (@id, @title, @provider, @model, @created_at, @updated_at, @message_count)
      ON CONFLICT(id) DO UPDATE SET
        title = COALESCE(NULLIF(@title, ''), chat_sessions.title),
        updated_at = @updated_at,
        message_count = @message_count
    `)
    this.stmts.listChatSessions = this.db.prepare(`
      SELECT * FROM chat_sessions ORDER BY updated_at DESC
    `)

    // 班级管理预编译语句
    this.stmts.insertClass = this.db.prepare(`
      INSERT INTO classes (id, class_id, name, grade, note, archived, created_at, archived_at, teacher)
      VALUES (@id, @class_id, @name, @grade, @note, @archived, @created_at, @archived_at, @teacher)
    `)
    this.stmts.updateClass = this.db.prepare(`
      UPDATE classes SET
        name = COALESCE(NULLIF(@name, ''), name),
        grade = @grade,
        note = @note,
        archived = @archived,
        archived_at = @archived_at,
        teacher = @teacher
      WHERE id = @id
    `)
    this.stmts.selectClassById = this.db.prepare(`SELECT * FROM classes WHERE id = ?`)
    this.stmts.selectClassByClassId = this.db.prepare(`SELECT * FROM classes WHERE class_id = ?`)
    this.stmts.listClasses = this.db.prepare(
      `SELECT * FROM classes ORDER BY archived ASC, created_at DESC`,
    )
    this.stmts.deleteClass = this.db.prepare(`DELETE FROM classes WHERE id = ?`)
  }

  isReady(): boolean {
    return this._ready
  }

  getLastError(): string | null {
    return this._lastError
  }

  getDbPath(): string {
    return this.dbPath
  }

  // -------------------- Agent Executions --------------------

  /**
   * 记录一次 agent 执行开始。返回 execution id,后续 updateExecution 用。
   * 失败返回 -1。
   */
  recordExecutionStart(agentId: string, prompt: string): number {
    if (!this._ready || !this.stmts.insertExecution) return -1
    try {
      const result = this.stmts.insertExecution.run({
        agent_id: agentId,
        started_at: Date.now(),
        status: 'running',
        prompt,
      })
      return Number(result.lastInsertRowid)
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] recordExecutionStart failed:', this._lastError)
      return -1
    }
  }

  /**
   * 更新一次 agent 执行的结束状态。
   * - costTotal 必须为有限数,否则存 NULL
   * - 字段为 undefined 时不覆盖
   */
  updateExecution(
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
    if (!this._ready || !this.stmts.updateExecution) return false
    try {
      const cost =
        fields.costTotal !== undefined && Number.isFinite(fields.costTotal)
          ? fields.costTotal
          : null
      this.stmts.updateExecution.run({
        id,
        finished_at: Date.now(),
        status: fields.status,
        output: fields.output ?? null,
        error: fields.error ?? null,
        tokens_input: fields.tokensInput ?? null,
        tokens_output: fields.tokensOutput ?? null,
        cost_total: cost,
      })
      return true
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] updateExecution failed:', this._lastError)
      return false
    }
  }

  getExecutionHistory(agentId: string | null, limit = 100): AgentExecutionRecord[] {
    if (!this._ready || !this.stmts.selectExecutionHistory) return []
    try {
      const rows = this.stmts.selectExecutionHistory.all(agentId, agentId, limit)
      return rows as AgentExecutionRecord[]
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] getExecutionHistory failed:', this._lastError)
      return []
    }
  }

  // -------------------- Cron Logs --------------------

  recordCronLog(
    taskId: string,
    level: CronLogRecord['level'],
    message: string,
    metadata?: Record<string, unknown>,
  ): boolean {
    if (!this._ready || !this.stmts.insertCronLog) return false
    try {
      this.stmts.insertCronLog.run({
        task_id: taskId,
        level,
        message,
        timestamp: Date.now(),
        metadata: metadata ? JSON.stringify(metadata) : null,
      })
      return true
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] recordCronLog failed:', this._lastError)
      return false
    }
  }

  getCronLogs(taskId: string | null, limit = 200): CronLogRecord[] {
    if (!this._ready || !this.stmts.selectCronLogs) return []
    try {
      const rows = this.stmts.selectCronLogs.all(taskId, taskId, limit)
      return rows as CronLogRecord[]
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] getCronLogs failed:', this._lastError)
      return []
    }
  }

  // -------------------- Chat Messages --------------------

  saveChatMessage(msg: {
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
  }): number {
    if (!this._ready || !this.stmts.insertChatMessage) return -1
    try {
      const result = this.stmts.insertChatMessage.run({
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
      this.syncSessionMeta(msg.sessionId ?? 'default', msg.model, msg.timestamp)
      return Number(result.lastInsertRowid)
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] saveChatMessage failed:', this._lastError)
      return -1
    }
  }

  /** 同步 chat_sessions 元数据（消息计数、更新时间、模型） */
  private syncSessionMeta(sessionId: string, model?: string, timestamp?: number): void {
    if (!this._ready || !this.stmts.upsertChatSession || !this.stmts.countChatMessages) return
    try {
      const cntRow = this.stmts.countChatMessages.get(sessionId) as { cnt: number } | undefined
      const messageCount = cntRow?.cnt ?? 0
      // 尝试获取已有标题，保留原值
      const titleRow = this.stmts.getSessionTitle?.get(sessionId) as { title: string } | undefined
      const title = titleRow?.title ?? `对话 ${new Date().toLocaleString()}`
      this.stmts.upsertChatSession.run({
        id: sessionId,
        title,
        provider: null,
        model: model ?? null,
        created_at: timestamp ?? Date.now(),
        updated_at: timestamp ?? Date.now(),
        message_count: messageCount,
      })
    } catch (err) {
      console.error('[DB] syncSessionMeta failed:', err)
    }
  }

  /** Load chat messages for a session */
  loadChatMessages(sessionId: string = 'default'): Array<Record<string, unknown>> {
    if (!this._ready || !this.stmts.selectChatMessages) return []
    try {
      return this.stmts.selectChatMessages.all(sessionId) as Array<Record<string, unknown>>
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] loadChatMessages failed:', this._lastError)
      return []
    }
  }

  /** Delete all messages for a chat session AND the session record itself */
  deleteChatSession(sessionId: string): boolean {
    if (!this._ready) return false
    try {
      // 先删消息
      if (this.stmts.deleteChatSession) {
        this.stmts.deleteChatSession.run(sessionId)
      }
      // 再删会话记录
      if (this.stmts.deleteChatSessionMeta) {
        this.stmts.deleteChatSessionMeta.run(sessionId)
      }
      return true
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] deleteChatSession failed:', this._lastError)
      return false
    }
  }

  /** List all chat sessions ordered by updated_at DESC */
  listChatSessions(): Array<Record<string, unknown>> {
    if (!this._ready || !this.stmts.listChatSessions) return []
    try {
      return this.stmts.listChatSessions.all() as Array<Record<string, unknown>>
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] listChatSessions failed:', this._lastError)
      return []
    }
  }

  // -------------------- Classes（班级管理） --------------------

  /** 新增班级。class_id 唯一冲突时返回 false。 */
  insertClass(record: ClassRecord): boolean {
    if (!this._ready || !this.stmts.insertClass) return false
    try {
      this.stmts.insertClass.run({
        id: record.id,
        class_id: record.class_id,
        name: record.name,
        grade: record.grade ?? null,
        note: record.note ?? null,
        archived: record.archived,
        created_at: record.created_at,
        archived_at: record.archived_at ?? null,
        teacher: (record as ClassRecord & { teacher?: string | null }).teacher ?? null,
      })
      return true
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] insertClass failed:', this._lastError)
      return false
    }
  }

  /** 更新班级（名称/年级/备注/存档状态）。字段为 undefined/null 时不覆盖。 */
  updateClass(
    id: string,
    fields: {
      name?: string
      grade?: string | null
      note?: string | null
      archived?: 0 | 1
      archived_at?: number | null
      teacher?: string | null
    },
  ): boolean {
    if (!this._ready || !this.stmts.updateClass) return false
    try {
      const before = this.stmts.selectClassById?.get(id) as ClassRecord | undefined
      const r = this.stmts.updateClass.run({
        id,
        name: fields.name ?? '',
        grade: fields.grade !== undefined ? fields.grade : (before?.grade ?? null),
        note: fields.note !== undefined ? fields.note : (before?.note ?? null),
        archived: fields.archived !== undefined ? fields.archived : (before?.archived ?? 0),
        archived_at:
          fields.archived_at !== undefined ? fields.archived_at : (before?.archived_at ?? null),
        teacher: fields.teacher !== undefined ? fields.teacher : (before?.teacher ?? null),
      })
      return Number(r.changes) > 0
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] updateClass failed:', this._lastError)
      return false
    }
  }

  /** 按主键 id 查询班级 */
  getClassById(id: string): ClassRecord | null {
    if (!this._ready || !this.stmts.selectClassById) return null
    try {
      return (this.stmts.selectClassById.get(id) as ClassRecord | undefined) ?? null
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] getClassById failed:', this._lastError)
      return null
    }
  }

  /** 按班级编号 class_id 查询班级（用于判断是否已存在/是否已存档） */
  getClassByClassId(classId: string): ClassRecord | null {
    if (!this._ready || !this.stmts.selectClassByClassId) return null
    try {
      return (this.stmts.selectClassByClassId.get(classId) as ClassRecord | undefined) ?? null
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] getClassByClassId failed:', this._lastError)
      return null
    }
  }

  /** 列出所有班级，未存档的排前面 */
  listClasses(): ClassRecord[] {
    if (!this._ready || !this.stmts.listClasses) return []
    try {
      return this.stmts.listClasses.all() as ClassRecord[]
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] listClasses failed:', this._lastError)
      return []
    }
  }

  /** 删除班级记录（仅删本地记录，不动学生数据） */
  deleteClass(id: string): boolean {
    if (!this._ready || !this.stmts.deleteClass) return false
    try {
      const r = this.stmts.deleteClass.run(id)
      return Number(r.changes) > 0
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] deleteClass failed:', this._lastError)
      return false
    }
  }

  // -------------------- Cleanup --------------------

  /**
   * 清理超过 maxAgeMs 的旧记录,默认 30 天。
   * 返回删除的总行数。
   */
  cleanup(maxAgeMs = 30 * 24 * 60 * 60 * 1000): { executions: number; logs: number } {
    if (!this._ready || !this.db) return { executions: 0, logs: 0 }
    const cutoff = Date.now() - maxAgeMs
    let executions = 0
    let logs = 0
    try {
      if (this.stmts.deleteOldExecutions) {
        const r = this.stmts.deleteOldExecutions.run(cutoff)
        executions = Number(r.changes)
      }
      if (this.stmts.deleteOldCronLogs) {
        const r = this.stmts.deleteOldCronLogs.run(cutoff)
        logs = Number(r.changes)
      }
      // WAL checkpoint 释放磁盘空间
      this.db.pragma('wal_checkpoint(TRUNCATE)')
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] cleanup failed:', this._lastError)
    }
    return { executions, logs }
  }

  /** RISK 修复: 清理过期数据,防止 DB 无限增长
   *  - chat_messages: 保留最近 90 天
   *  - agent_executions: 保留最近 90 天
   *  - 每次最多删除 10000 条,防止长时间阻塞 */
  cleanupOldData(maxAgeDays = 90, batchSize = 10000): void {
    if (!this._ready || !this.db) return
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    try {
      const tx = this.db.transaction(() => {
        // 先查数量,避免不必要的 DELETE
        const msgCount = this.db!.prepare(
          'SELECT COUNT(*) as n FROM chat_messages WHERE timestamp < ?',
        ).get(cutoff) as { n: number }
        if (msgCount.n > 0) {
          this.db!.prepare(
            'DELETE FROM chat_messages WHERE rowid IN (SELECT rowid FROM chat_messages WHERE timestamp < ? LIMIT ?)',
          ).run(cutoff, batchSize)
        }
        const execCount = this.db!.prepare(
          'SELECT COUNT(*) as n FROM agent_executions WHERE started_at < ?',
        ).get(cutoff) as { n: number }
        if (execCount.n > 0) {
          this.db!.prepare(
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
  getStats(): { executions: number; logs: number; ready: boolean; path: string } {
    let executions = 0
    let logs = 0
    if (this._ready) {
      try {
        if (this.stmts.countExecutions) {
          const r = this.stmts.countExecutions.get() as { count: number } | undefined
          executions = r?.count ?? 0
        }
        if (this.stmts.countCronLogs) {
          const r = this.stmts.countCronLogs.get() as { count: number } | undefined
          logs = r?.count ?? 0
        }
      } catch (err) {
        // Medium 修复: 不再静默吞错,记录错误日志便于排查
        console.error('[DB] getStats failed:', err)
      }
    }
    return { executions, logs, ready: this._ready, path: this.dbPath }
  }

  /** 优雅关闭（graceful shutdown） */
  async close(): Promise<void> {
    // Medium 修复: 清理定期清理定时器,避免 app 退出后 timer 仍引用已关闭的 db
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    if (!this.db) return
    try {
      this.db.close()
      this._ready = false
      this.db = null
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err)
      console.error('[DB] close failed:', this._lastError)
    }
  }

  /**
   * 测试用：直接获取 db 实例（生产代码不应使用）。
   * 仅在测试中通过 __test__ 钩子访问。
   */
  __test__getDb(): Database | null {
    return this.db
  }

  /** 测试用：检查 db 文件是否存在 */
  static __test__dbExists(p: string): boolean {
    return fs.existsSync(p)
  }
}

export const dbService = new DBService()
