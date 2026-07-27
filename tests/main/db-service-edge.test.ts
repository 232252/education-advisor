// =============================================================
// DB Service 补充 — 执行历史隔离 / Infinity 成本 / 批量压力 / 会话
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'

const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
  const tmpDir = `${tmpBase}${sep}db-edge-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import { dbService } from '../../src/main/services/db-service'

function skip(): boolean {
  if (!dbService.isReady()) {
    console.warn('SUPPRESS: db disabled, skipping')
    return true
  }
  return false
}

describe('dbService 执行历史 — 隔离与边界', () => {
  beforeAll(async () => {
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    await dbService.init()
  })
  afterAll(async () => {
    await dbService.close()
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('不同 agent 的执行历史应隔离', () => {
    if (skip()) return
    dbService.recordExecutionStart('iso-a', 'task a')
    dbService.recordExecutionStart('iso-b', 'task b')
    dbService.recordExecutionStart('iso-a', 'task a2')
    const histA = dbService.getExecutionHistory('iso-a', 10)
    const histB = dbService.getExecutionHistory('iso-b', 10)
    expect(histA.every((r) => r.agent_id === 'iso-a')).toBe(true)
    expect(histB.every((r) => r.agent_id === 'iso-b')).toBe(true)
    expect(histA.length).toBeGreaterThanOrEqual(2)
    expect(histB.length).toBeGreaterThanOrEqual(1)
  })

  it('Infinity 成本应被处理(存为 null 或有限值)', () => {
    if (skip()) return
    const id = dbService.recordExecutionStart('inf-agent', 'x')
    const ok = dbService.updateExecution(id, { status: 'success', costTotal: Infinity })
    expect(ok).toBe(true)
    const hist = dbService.getExecutionHistory('inf-agent', 1)
    // Infinity 不应导致崩溃,值应为 null 或有限数
    const cost = hist[0]?.cost_total
    expect(cost === null || (typeof cost === 'number' && Number.isFinite(cost))).toBe(true)
  })

  it('limit 参数限制返回条数', () => {
    if (skip()) return
    for (let i = 0; i < 5; i++) {
      const id = dbService.recordExecutionStart('lim-agent', `task ${i}`)
      dbService.updateExecution(id, { status: 'success' })
    }
    const all = dbService.getExecutionHistory('lim-agent', 100)
    const limited = dbService.getExecutionHistory('lim-agent', 3)
    expect(all.length).toBeGreaterThanOrEqual(5)
    expect(limited.length).toBeLessThanOrEqual(3)
  })

  it('updateExecution 不存在的 id 返回 false', () => {
    if (skip()) {
      expect(dbService.updateExecution(99999, { status: 'x' })).toBe(false)
      return
    }
    expect(dbService.updateExecution(999999999, { status: 'x' })).toBe(false)
  })

  it('recordExecutionStart 空 prompt 应正常', () => {
    if (skip()) return
    const id = dbService.recordExecutionStart('empty-prompt', '')
    expect(id).toBeGreaterThan(0)
  })
})

describe('dbService Cron 日志 — 边界', () => {
  it('recordCronLog 不同 level', () => {
    if (skip()) return
    for (const lvl of ['info', 'warn', 'error']) {
      expect(dbService.recordCronLog('lvl-task', lvl, `msg-${lvl}`)).toBe(true)
    }
    const logs = dbService.getCronLogs('lvl-task', 10)
    expect(logs.length).toBeGreaterThanOrEqual(3)
  })

  it('recordCronLog 空 metadata', () => {
    if (skip()) return
    expect(dbService.recordCronLog('meta-task', 'info', 'no meta')).toBe(true)
    const logs = dbService.getCronLogs('meta-task', 1)
    expect(logs[0]).toBeDefined()
  })

  it('getCronLogs 不存在的 task 返回空', () => {
    if (skip()) {
      expect(dbService.getCronLogs('nope')).toEqual([])
      return
    }
    expect(dbService.getCronLogs('nonexistent-task-xyz')).toEqual([])
  })
})

describe('dbService 会话管理', () => {
  it('listChatSessions 应返回已写入消息的 session', () => {
    if (skip()) return
    dbService.saveChatMessage({ sessionId: 'sess-list-1', role: 'user', content: 'hi', timestamp: 1 })
    dbService.saveChatMessage({ sessionId: 'sess-list-2', role: 'user', content: 'yo', timestamp: 2 })
    const sessions = dbService.listChatSessions()
    const ids = sessions.map((s) => (s as { session_id?: string }).session_id ?? (s as { id?: string }).id)
    expect(ids).toContain('sess-list-1')
    expect(ids).toContain('sess-list-2')
  })

  it('deleteChatSession 删除后消息不可加载', () => {
    if (skip()) return
    dbService.saveChatMessage({ sessionId: 'del-sess', role: 'user', content: 'x', timestamp: 1 })
    dbService.deleteChatSession('del-sess')
    const msgs = dbService.loadChatMessages('del-sess')
    expect(msgs.length).toBe(0)
  })

  it('deleteChatSession 不存在的 session 不抛错', () => {
    if (skip()) return
    expect(() => dbService.deleteChatSession('never-existed')).not.toThrow()
  })

  it('loadChatMessages 默认 session', () => {
    if (skip()) return
    dbService.saveChatMessage({ role: 'user', content: 'default-msg', timestamp: 1 })
    const msgs = dbService.loadChatMessages()
    expect(msgs.length).toBeGreaterThan(0)
  })
})

describe('dbService 批量压力', () => {
  it('连续 100 条执行记录应正常写入', () => {
    if (skip()) return
    for (let i = 0; i < 100; i++) {
      const id = dbService.recordExecutionStart('bulk-agent', `bulk ${i}`)
      dbService.updateExecution(id, { status: 'success', tokensInput: i, tokensOutput: i * 2 })
    }
    const hist = dbService.getExecutionHistory('bulk-agent', 200)
    expect(hist.length).toBeGreaterThanOrEqual(100)
  })

  it('连续 200 条 cron 日志应正常', () => {
    if (skip()) return
    for (let i = 0; i < 200; i++) {
      dbService.recordCronLog('bulk-cron', 'info', `entry ${i}`)
    }
    const logs = dbService.getCronLogs('bulk-cron', 300)
    expect(logs.length).toBeGreaterThanOrEqual(200)
  })

  it('getStats 返回合理计数', () => {
    if (skip()) return
    const s = dbService.getStats()
    expect(s.executions).toBeGreaterThanOrEqual(0)
    expect(s.logs).toBeGreaterThanOrEqual(0)
  })
})
