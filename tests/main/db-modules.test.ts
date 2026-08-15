// =============================================================
// db/ 拆分模块测试 — cron-logs / agent-executions / chat-messages / classes
// 通过构造 mock DbClient(无需 better-sqlite3)覆盖各函数分支
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbClient } from '../../src/main/services/db/statements'
import { recordCronLog, getCronLogs } from '../../src/main/services/db/cron-logs'
import {
  recordExecutionStart,
  updateExecution,
  getExecutionHistory,
} from '../../src/main/services/db/agent-executions'
import {
  saveChatMessage,
  loadChatMessages,
  deleteChatSession,
  listChatSessions,
} from '../../src/main/services/db/chat-messages'
import {
  insertClass,
  updateClass,
  getClassById,
  getClassByClassId,
  listClasses,
  deleteClass,
} from '../../src/main/services/db/classes'

/** 构造 mock DbClient: stmts 中的每个语句都是 vi.fn */
function makeCtx(
  stmts: Record<string, unknown> = {},
  opts: { ready?: boolean; withDb?: boolean } = {},
): DbClient {
  const ctx = {
    ready: opts.ready ?? true,
    db: opts.withDb === false ? null : { transaction: vi.fn((fn: () => void) => fn) },
    stmts,
    setError: vi.fn(),
  }
  return ctx as unknown as DbClient
}

describe('db/cron-logs', () => {
  it('recordCronLog: ready=false 或语句缺失返回 false', () => {
    const notReady = makeCtx({ insertCronLog: { run: vi.fn() } }, { ready: false })
    expect(recordCronLog(notReady, 't1', 'info', 'msg')).toBe(false)

    const noStmt = makeCtx({})
    expect(recordCronLog(noStmt, 't1', 'info', 'msg')).toBe(false)
  })

  it('recordCronLog: 成功写入,metadata 序列化为 JSON / 缺省为 null', () => {
    const run = vi.fn()
    const ctx = makeCtx({ insertCronLog: { run } })
    expect(recordCronLog(ctx, 't1', 'warn', '任务执行', { extra: 1 })).toBe(true)
    const arg = run.mock.calls[0][0]
    expect(arg.task_id).toBe('t1')
    expect(arg.level).toBe('warn')
    expect(arg.message).toBe('任务执行')
    expect(typeof arg.timestamp).toBe('number')
    expect(arg.metadata).toBe('{"extra":1}')

    run.mockClear()
    expect(recordCronLog(ctx, 't1', 'info', '无元数据')).toBe(true)
    expect(run.mock.calls[0][0].metadata).toBeNull()
  })

  it('recordCronLog: run 抛错返回 false 并 setError', () => {
    const ctx = makeCtx({
      insertCronLog: {
        run: vi.fn(() => {
          throw new Error('UNIQUE constraint failed')
        }),
      },
    })
    expect(recordCronLog(ctx, 't1', 'info', 'msg')).toBe(false)
    expect(ctx.setError).toHaveBeenCalledWith('UNIQUE constraint failed')
  })

  it('getCronLogs: 语句缺失/未就绪返回空数组', () => {
    expect(getCronLogs(makeCtx({}), 't1')).toEqual([])
    expect(getCronLogs(makeCtx({ selectCronLogs: { all: vi.fn() } }, { ready: false }), 't1')).toEqual([])
  })

  it('getCronLogs: 透传 (taskId, taskId, limit),默认 limit=200', () => {
    const rows = [{ id: 1 }]
    const all = vi.fn(() => rows)
    const ctx = makeCtx({ selectCronLogs: { all } })
    expect(getCronLogs(ctx, 't1')).toBe(rows)
    expect(all).toHaveBeenCalledWith('t1', 't1', 200)
    getCronLogs(ctx, null, 50)
    expect(all).toHaveBeenLastCalledWith(null, null, 50)
  })

  it('getCronLogs: 抛错返回 [] 并 setError', () => {
    const ctx = makeCtx({
      selectCronLogs: {
        all: vi.fn(() => {
          throw new Error('db locked')
        }),
      },
    })
    expect(getCronLogs(ctx, 't1')).toEqual([])
    expect(ctx.setError).toHaveBeenCalledWith('db locked')
  })
})

describe('db/agent-executions', () => {
  it('recordExecutionStart: 返回 lastInsertRowid', () => {
    const run = vi.fn(() => ({ lastInsertRowid: 42n }))
    const ctx = makeCtx({ insertExecution: { run } })
    expect(recordExecutionStart(ctx, 'agent-1', '写周报')).toBe(42)
    const arg = run.mock.calls[0][0]
    expect(arg.agent_id).toBe('agent-1')
    expect(arg.status).toBe('running')
    expect(arg.prompt).toBe('写周报')
    expect(typeof arg.started_at).toBe('number')
  })

  it('recordExecutionStart: 未就绪/抛错返回 -1', () => {
    const notReady = makeCtx({ insertExecution: { run: vi.fn() } }, { ready: false })
    expect(recordExecutionStart(notReady, 'a', 'p')).toBe(-1)

    const ctx = makeCtx({
      insertExecution: {
        run: vi.fn(() => {
          throw new Error('insert failed')
        }),
      },
    })
    expect(recordExecutionStart(ctx, 'a', 'p')).toBe(-1)
    expect(ctx.setError).toHaveBeenCalledWith('insert failed')
  })

  it('updateExecution: changes>0 返回 true,字段映射与默认 null', () => {
    const run = vi.fn(() => ({ changes: 1 }))
    const ctx = makeCtx({ updateExecution: { run } })
    expect(
      updateExecution(ctx, 7, {
        status: 'success',
        output: 'done',
        tokensInput: 100,
        tokensOutput: 50,
        costTotal: 0.02,
      }),
    ).toBe(true)
    const arg = run.mock.calls[0][0]
    expect(arg.id).toBe(7)
    expect(arg.status).toBe('success')
    expect(arg.output).toBe('done')
    expect(arg.error).toBeNull()
    expect(arg.tokens_input).toBe(100)
    expect(arg.tokens_output).toBe(50)
    expect(arg.cost_total).toBe(0.02)
    expect(typeof arg.finished_at).toBe('number')
  })

  it('updateExecution: changes=0(不存在 id)返回 false', () => {
    const ctx = makeCtx({ updateExecution: { run: vi.fn(() => ({ changes: 0 })) } })
    expect(updateExecution(ctx, 999, { status: 'failure', error: 'x' })).toBe(false)
  })

  it('updateExecution: costTotal 非有限数存 null', () => {
    const run = vi.fn(() => ({ changes: 1 }))
    const ctx = makeCtx({ updateExecution: { run } })
    updateExecution(ctx, 1, { status: 'aborted', costTotal: Number.NaN })
    expect(run.mock.calls[0][0].cost_total).toBeNull()
    updateExecution(ctx, 1, { status: 'aborted' })
    expect(run.mock.calls[1][0].cost_total).toBeNull()
  })

  it('updateExecution: 未就绪返回 false;抛错 setError', () => {
    const notReady = makeCtx({ updateExecution: { run: vi.fn() } }, { ready: false })
    expect(updateExecution(notReady, 1, { status: 'success' })).toBe(false)

    const ctx = makeCtx({
      updateExecution: {
        run: vi.fn(() => {
          throw new Error('update boom')
        }),
      },
    })
    expect(updateExecution(ctx, 1, { status: 'success' })).toBe(false)
    expect(ctx.setError).toHaveBeenCalledWith('update boom')
  })

  it('getExecutionHistory: 透传参数并返回行;未就绪返回 []', () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const all = vi.fn(() => rows)
    const ctx = makeCtx({ selectExecutionHistory: { all } })
    expect(getExecutionHistory(ctx, 'agent-1')).toBe(rows)
    expect(all).toHaveBeenCalledWith('agent-1', 'agent-1', 100)
    getExecutionHistory(ctx, null, 5)
    expect(all).toHaveBeenLastCalledWith(null, null, 5)

    const notReady = makeCtx({ selectExecutionHistory: { all: vi.fn() } }, { ready: false })
    expect(getExecutionHistory(notReady, null)).toEqual([])
  })
})

describe('db/chat-messages', () => {
  it('saveChatMessage: 默认 session=default,可选字段 null,返回 rowid', () => {
    const insertRun = vi.fn(() => ({ lastInsertRowid: 9 }))
    const upsertRun = vi.fn()
    const ctx = makeCtx({
      insertChatMessage: { run: insertRun },
      upsertSessionMeta: { run: upsertRun },
    })
    const ts = 1767225600000
    const id = saveChatMessage(ctx, { role: 'user', content: 'hi', timestamp: ts, model: 'm1' })
    expect(id).toBe(9)

    const arg = insertRun.mock.calls[0][0]
    expect(arg.session_id).toBe('default')
    expect(arg.role).toBe('user')
    expect(arg.content).toBe('hi')
    expect(arg.thinking).toBeNull()
    expect(arg.tool_calls).toBeNull()
    expect(arg.timestamp).toBe(ts)
    expect(arg.model).toBe('m1')

    // syncSessionMeta 被调用(增量 upsert)
    expect(upsertRun).toHaveBeenCalledTimes(1)
    const meta = upsertRun.mock.calls[0]
    expect(meta[0]).toBe('default')
    expect(meta[2]).toBe('m1')
  })

  it('saveChatMessage: 指定 sessionId 透传', () => {
    const insertRun = vi.fn(() => ({ lastInsertRowid: 1 }))
    const upsertRun = vi.fn()
    const ctx = makeCtx({
      insertChatMessage: { run: insertRun },
      upsertSessionMeta: { run: upsertRun },
    })
    saveChatMessage(ctx, { sessionId: 's9', role: 'assistant', content: 'ok', timestamp: 1 })
    expect(insertRun.mock.calls[0][0].session_id).toBe('s9')
    expect(upsertRun.mock.calls[0][0]).toBe('s9')
  })

  it('saveChatMessage: 未就绪返回 -1;insert 抛错返回 -1 并 setError', () => {
    const notReady = makeCtx(
      { insertChatMessage: { run: vi.fn() } },
      { ready: false },
    )
    expect(saveChatMessage(notReady, { role: 'user', content: 'x', timestamp: 1 })).toBe(-1)

    const ctx = makeCtx({
      insertChatMessage: {
        run: vi.fn(() => {
          throw new Error('disk full')
        }),
      },
    })
    expect(saveChatMessage(ctx, { role: 'user', content: 'x', timestamp: 1 })).toBe(-1)
    expect(ctx.setError).toHaveBeenCalledWith('disk full')
  })

  it('loadChatMessages: 透传 sessionId,默认 default', () => {
    const rows = [{ id: 1 }]
    const all = vi.fn(() => rows)
    const ctx = makeCtx({ selectChatMessages: { all } })
    expect(loadChatMessages(ctx, 's1')).toBe(rows)
    expect(all).toHaveBeenCalledWith('s1')
    loadChatMessages(ctx)
    expect(all).toHaveBeenLastCalledWith('default')
    expect(loadChatMessages(makeCtx({}), 's1')).toEqual([])
  })

  it('deleteChatSession: 事务包裹两条删除语句', () => {
    const delMsgs = { run: vi.fn() }
    const delMeta = { run: vi.fn() }
    const transaction = vi.fn((fn: () => void) => fn)
    const ctx = makeCtx({ deleteChatSession: delMsgs, deleteChatSessionMeta: delMeta })
    ctx.db = { transaction } as never
    expect(deleteChatSession(ctx, 's1')).toBe(true)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(delMsgs.run).toHaveBeenCalledWith('s1')
    expect(delMeta.run).toHaveBeenCalledWith('s1')
  })

  it('deleteChatSession: db 缺失或语句缺失返回 false', () => {
    const noDb = makeCtx({
      deleteChatSession: { run: vi.fn() },
      deleteChatSessionMeta: { run: vi.fn() },
    })
    noDb.db = null
    expect(deleteChatSession(noDb, 's1')).toBe(false)

    const missingStmt = makeCtx({ deleteChatSession: { run: vi.fn() } })
    expect(deleteChatSession(missingStmt, 's1')).toBe(false)

    const notReady = makeCtx(
      { deleteChatSession: { run: vi.fn() }, deleteChatSessionMeta: { run: vi.fn() } },
      { ready: false },
    )
    expect(deleteChatSession(notReady, 's1')).toBe(false)
  })

  it('deleteChatSession: 抛错返回 false 并 setError', () => {
    const transaction = vi.fn(() => {
      throw new Error('tx failed')
    })
    const ctx = makeCtx({
      deleteChatSession: { run: vi.fn() },
      deleteChatSessionMeta: { run: vi.fn() },
    })
    ctx.db = { transaction } as never
    expect(deleteChatSession(ctx, 's1')).toBe(false)
    expect(ctx.setError).toHaveBeenCalledWith('tx failed')
  })

  it('listChatSessions: 返回行;未就绪返回 []', () => {
    const rows = [{ id: 's1' }]
    const ctx = makeCtx({ listChatSessions: { all: vi.fn(() => rows) } })
    expect(listChatSessions(ctx)).toBe(rows)
    expect(listChatSessions(makeCtx({}))).toEqual([])
  })
})

describe('db/classes', () => {
  const baseRecord = {
    id: 'uuid-1',
    class_id: 'G7-1',
    name: '一班',
    archived: 0,
    created_at: 1767225600000,
  }

  it('insertClass: 可选字段 null 化,成功返回 true', () => {
    const run = vi.fn()
    const ctx = makeCtx({ insertClass: { run } })
    expect(
      insertClass(ctx, {
        ...baseRecord,
        grade: '七年级',
        note: undefined,
        teacher: '王老师',
      } as never),
    ).toBe(true)
    const arg = run.mock.calls[0][0]
    expect(arg.grade).toBe('七年级')
    expect(arg.note).toBeNull()
    expect(arg.archived_at).toBeNull()
    expect(arg.teacher).toBe('王老师')
  })

  it('insertClass: 未就绪/唯一冲突返回 false', () => {
    const notReady = makeCtx({ insertClass: { run: vi.fn() } }, { ready: false })
    expect(insertClass(notReady, baseRecord as never)).toBe(false)

    const ctx = makeCtx({
      insertClass: {
        run: vi.fn(() => {
          throw new Error('UNIQUE constraint')
        }),
      },
    })
    expect(insertClass(ctx, baseRecord as never)).toBe(false)
    expect(ctx.setError).toHaveBeenCalledWith('UNIQUE constraint')
  })

  it('updateClass: 字段缺省时回退到 before 记录', () => {
    const run = vi.fn(() => ({ changes: 1 }))
    const ctx = makeCtx({
      updateClass: { run },
      selectClassById: {
        get: vi.fn(() => ({
          grade: '七年级',
          note: '旧备注',
          archived: 0,
          archived_at: null,
          teacher: '王老师',
        })),
      },
    })
    expect(updateClass(ctx, 'uuid-1', { name: '改名班' })).toBe(true)
    const arg = run.mock.calls[0][0]
    expect(arg.name).toBe('改名班')
    expect(arg.grade).toBe('七年级')
    expect(arg.note).toBe('旧备注')
    expect(arg.archived).toBe(0)
    expect(arg.teacher).toBe('王老师')
  })

  it('updateClass: 无 before 记录时回退到 null/0;显式 null 透传', () => {
    const run = vi.fn(() => ({ changes: 1 }))
    const ctx = makeCtx({
      updateClass: { run },
      selectClassById: { get: vi.fn(() => undefined) },
    })
    updateClass(ctx, 'uuid-x', { name: 'n', grade: null })
    const arg = run.mock.calls[0][0]
    expect(arg.grade).toBeNull()
    expect(arg.note).toBeNull()
    expect(arg.archived).toBe(0)
    expect(arg.archived_at).toBeNull()
    expect(arg.teacher).toBeNull()
  })

  it('updateClass: changes=0 返回 false;未就绪返回 false', () => {
    const ctx = makeCtx({
      updateClass: { run: vi.fn(() => ({ changes: 0 })) },
      selectClassById: { get: vi.fn() },
    })
    expect(updateClass(ctx, 'uuid-x', { name: 'n' })).toBe(false)

    const notReady = makeCtx({ updateClass: { run: vi.fn() } }, { ready: false })
    expect(updateClass(notReady, 'uuid-x', { name: 'n' })).toBe(false)
  })

  it('getClassById / getClassByClassId: 命中返回记录,未命中返回 null', () => {
    const rec = { id: 'uuid-1', class_id: 'G7-1' }
    const ctx = makeCtx({ selectClassById: { get: vi.fn(() => rec) } })
    expect(getClassById(ctx, 'uuid-1')).toBe(rec)

    const miss = makeCtx({ selectClassById: { get: vi.fn(() => undefined) } })
    expect(getClassById(miss, 'nope')).toBeNull()

    const byClassId = makeCtx({ selectClassByClassId: { get: vi.fn(() => rec) } })
    expect(getClassByClassId(byClassId, 'G7-1')).toBe(rec)
    expect(getClassByClassId(makeCtx({}), 'G7-1')).toBeNull()
  })

  it('listClasses: 返回行;未就绪返回 []', () => {
    const rows = [baseRecord]
    const ctx = makeCtx({ listClasses: { all: vi.fn(() => rows) } })
    expect(listClasses(ctx)).toBe(rows)
    expect(listClasses(makeCtx({}))).toEqual([])
  })

  it('deleteClass: changes>0 返回 true,changes=0 返回 false', () => {
    const ok = makeCtx({ deleteClass: { run: vi.fn(() => ({ changes: 1 })) } })
    expect(deleteClass(ok, 'uuid-1')).toBe(true)

    const miss = makeCtx({ deleteClass: { run: vi.fn(() => ({ changes: 0 })) } })
    expect(deleteClass(miss, 'uuid-1')).toBe(false)
  })
})