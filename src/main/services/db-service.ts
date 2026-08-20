// =============================================================
// DB Service — 基于 better-sqlite3 的本地落库（薄编排层）
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
// 拆分（纯重构,行为零变化,领域逻辑逐字搬移到 db/ 子模块）：
//   - db/types.ts           记录类型定义
//   - db/connection.ts      路径解析(R155) + 打开数据库 + pragma
//   - db/schema.ts          建表/索引 DDL
//   - db/statements.ts      预编译语句缓存与 DbClient 上下文
//   - db/maintenance.ts     过期数据清理 / 统计
//   - db/agent-executions.ts / db/cron-logs.ts /
//     db/chat-messages.ts / db/classes.ts   领域 CRUD
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { getExecutionHistory, recordExecutionStart, updateExecution } from './db/agent-executions'
import {
  deleteChatSession,
  listChatSessions,
  loadChatMessages,
  saveChatMessage,
} from './db/chat-messages'
import {
  deleteClass,
  getClassByClassId,
  getClassById,
  insertClass,
  listClasses,
  updateClass,
} from './db/classes'
import { openDatabase, resolveDbPath } from './db/connection'
import { getCronLogs, recordCronLog } from './db/cron-logs'
import { cleanup, cleanupOldData, getStats } from './db/maintenance'
import { createTables } from './db/schema'
import type { DbClient, DbStatements } from './db/statements'
import { prepareAllStatements } from './db/statements'
import type { AgentExecutionRecord, ClassRecord, CronLogRecord } from './db/types'

type Database = import('better-sqlite3').Database

// 类型 re-export（旧导入路径 '../services/db-service' 不变）
export type { AgentExecutionRecord, ClassRecord, CronLogRecord } from './db/types'

class DBService {
  private db: Database | null = null
  private dbPath: string = ''
  private _ready = false
  private _lastError: string | null = null
  /** CONCERN 修复: 定期清理定时器 (每 24 小时清理一次过期数据) */
  private cleanupTimer: NodeJS.Timeout | null = null
  /** 预编译语句缓存 */
  private stmts: DbStatements = {}

  /** 把类状态投影为 db/ 领域函数的运行上下文 */
  private get client(): DbClient {
    return {
      ready: this._ready,
      db: this.db,
      stmts: this.stmts,
      setError: (msg: string) => {
        this._lastError = msg
      },
    }
  }

  /**
   * 异步初始化。必须在 app.whenReady() 之后调用。
   * 失败不抛异常,降级为 in-memory disabled 模式。
   * (路径解析/打开数据库/pragma 逻辑下沉到 db/connection.ts,
   *  建表/预编译分别下沉到 db/schema.ts 与 db/statements.ts)
   */
  async init(): Promise<void> {
    if (this._ready) return
    try {
      // __dirname 在编排层求值后传参,保证子模块中项目根解析与下沉前一致
      this.dbPath = resolveDbPath(__dirname)
      await fsp.mkdir(path.dirname(this.dbPath), { recursive: true })

      this.db = openDatabase(this.dbPath)
      createTables(this.db)
      this.stmts = prepareAllStatements(this.db)
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
    return recordExecutionStart(this.client, agentId, prompt)
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
    return updateExecution(this.client, id, fields)
  }

  getExecutionHistory(agentId: string | null, limit = 100): AgentExecutionRecord[] {
    return getExecutionHistory(this.client, agentId, limit)
  }

  // -------------------- Cron Logs --------------------

  recordCronLog(
    taskId: string,
    level: CronLogRecord['level'],
    message: string,
    metadata?: Record<string, unknown>,
  ): boolean {
    return recordCronLog(this.client, taskId, level, message, metadata)
  }

  getCronLogs(taskId: string | null, limit = 200): CronLogRecord[] {
    return getCronLogs(this.client, taskId, limit)
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
    return saveChatMessage(this.client, msg)
  }

  /** Load chat messages for a session */
  loadChatMessages(sessionId: string = 'default'): Array<Record<string, unknown>> {
    return loadChatMessages(this.client, sessionId)
  }

  /** Delete all messages for a chat session AND the session record itself
   *  修复: 两步删除用事务包裹,保证原子性(要么全删,要么全不删) */
  deleteChatSession(sessionId: string): boolean {
    return deleteChatSession(this.client, sessionId)
  }

  /** List all chat sessions ordered by updated_at DESC */
  listChatSessions(): Array<Record<string, unknown>> {
    return listChatSessions(this.client)
  }

  // -------------------- Classes（班级管理） --------------------

  /** 新增班级。class_id 唯一冲突时返回 false。 */
  insertClass(record: ClassRecord): boolean {
    return insertClass(this.client, record)
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
    return updateClass(this.client, id, fields)
  }

  /** 按主键 id 查询班级 */
  getClassById(id: string): ClassRecord | null {
    return getClassById(this.client, id)
  }

  /** 按班级编号 class_id 查询班级（用于判断是否已存在/是否已存档） */
  getClassByClassId(classId: string): ClassRecord | null {
    return getClassByClassId(this.client, classId)
  }

  /** 列出所有班级，未存档的排前面 */
  listClasses(): ClassRecord[] {
    return listClasses(this.client)
  }

  /** 删除班级记录（仅删本地记录，不动学生数据） */
  deleteClass(id: string): boolean {
    return deleteClass(this.client, id)
  }

  // -------------------- Cleanup --------------------

  /**
   * 清理超过 maxAgeMs 的旧记录,默认 30 天。
   * 返回删除的总行数。
   * (逻辑下沉到 db/maintenance.ts)
   */
  cleanup(maxAgeMs = 30 * 24 * 60 * 60 * 1000): { executions: number; logs: number } {
    return cleanup(this.client, maxAgeMs)
  }

  /** RISK 修复: 清理过期数据,防止 DB 无限增长
   *  - chat_messages: 保留最近 90 天
   *  - agent_executions: 保留最近 90 天
   *  - 每次最多删除 10000 条,防止长时间阻塞
   *  (逻辑下沉到 db/maintenance.ts) */
  cleanupOldData(maxAgeDays = 90, batchSize = 10000): void {
    cleanupOldData(this.client, maxAgeDays, batchSize)
  }

  /**
   * 获取统计信息（用于设置页面 / 调试）。
   * (逻辑下沉到 db/maintenance.ts)
   */
  getStats(): { executions: number; logs: number; ready: boolean; path: string } {
    return getStats(this.client, this.dbPath)
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
