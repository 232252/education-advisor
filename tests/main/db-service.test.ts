// =============================================================
// DB Service 测试（P2-5 示例 spec）
// - 用 better-sqlite3 真机跑（已装好 native binding）
// - mock electron.app.getPath 指向 tmp 目录
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'

// vi.hoisted 让 mock 在 import 之前生效
// 注意：hoisted 内部不能 import 模块（被 hoist 之前初始化会 TDZ）
// 所有 path 等逻辑 inline 到 hoisted 内
const mocks = vi.hoisted(() => {
  const sep = process.platform === 'win32' ? '\\' : '/'
  const tmpBase =
    process.env.TEMP || process.env.TMP || `/tmp`
  const tmpDir =
    tmpBase +
    sep +
    `db-svc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    userDataDir: tmpDir,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return tmpDir
      throw new Error(`Unexpected path: ${name}`)
    }),
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
  },
}))

import { dbService } from '../../src/main/services/db-service'

describe('dbService', () => {
  beforeAll(async () => {
    // 实际创建 tmp 目录（hoisted 阶段不能 import node:fs）
    await fsp.mkdir(mocks.userDataDir, { recursive: true })
    // init 会用 userDataDir 创建 db 文件
    await dbService.init()
    if (!dbService.isReady()) {
      // native binding 缺失时,降级测试 isReady() 路径
      console.warn('SUPPRESS: dbService not ready (better-sqlite3 binding missing?)')
    }
  })

  afterAll(async () => {
    await dbService.close()
    // 清理 tmp 目录
    try {
      await fsp.rm(mocks.userDataDir, { recursive: true, force: true })
    } catch {
      // 忽略
    }
  })

  it('isReady 应为 true 或 false 但不抛异常', () => {
    expect(typeof dbService.isReady()).toBe('boolean')
  })

  it('getDbPath 应返回 userData/workstation.db', () => {
    // userData/workstation.db
    const sep = process.platform === 'win32' ? '\\' : '/'
    const expected = mocks.userDataDir + sep + 'workstation.db'
    expect(dbService.getDbPath()).toBe(expected)
  })

  it('recordExecutionStart + updateExecution + getExecutionHistory', () => {
    if (!dbService.isReady()) {
      // 降级模式：API 应静默 no-op,返回 -1/false
      const id = dbService.recordExecutionStart('test-agent', 'hello')
      expect(id).toBe(-1)
      expect(dbService.updateExecution(id, { status: 'success' })).toBe(false)
      expect(dbService.getExecutionHistory('test-agent')).toEqual([])
      return
    }

    const id = dbService.recordExecutionStart('agent-a', 'do work')
    expect(id).toBeGreaterThan(0)

    const ok = dbService.updateExecution(id, {
      status: 'success',
      output: 'done',
      tokensInput: 100,
      tokensOutput: 200,
      costTotal: 0.005,
    })
    expect(ok).toBe(true)

    const history = dbService.getExecutionHistory('agent-a', 10)
    expect(history.length).toBeGreaterThanOrEqual(1)
    const rec = history.find((r) => r.id === id)
    expect(rec).toBeDefined()
    expect(rec?.status).toBe('success')
    expect(rec?.tokens_input).toBe(100)
    expect(rec?.cost_total).toBe(0.005)
  })

  it('NaN 成本应存为 null', () => {
    if (!dbService.isReady()) return
    const id = dbService.recordExecutionStart('agent-b', 'x')
    const ok = dbService.updateExecution(id, {
      status: 'failure',
      costTotal: Number.NaN,
    })
    expect(ok).toBe(true)
    const history = dbService.getExecutionHistory('agent-b', 1)
    const rec = history[0]
    expect(rec.cost_total).toBeNull()
  })

  it('recordCronLog + getCronLogs', () => {
    if (!dbService.isReady()) {
      expect(dbService.recordCronLog('t1', 'info', 'm')).toBe(false)
      expect(dbService.getCronLogs('t1')).toEqual([])
      return
    }
    const ok = dbService.recordCronLog('task-1', 'info', 'started', { foo: 1 })
    expect(ok).toBe(true)
    const logs = dbService.getCronLogs('task-1', 10)
    expect(logs.length).toBeGreaterThanOrEqual(1)
    expect(logs[0].level).toBe('info')
    expect(logs[0].metadata).toBe('{"foo":1}')
  })

  it('cleanup 不会删除新记录', () => {
    if (!dbService.isReady()) {
      const r = dbService.cleanup()
      expect(r).toEqual({ executions: 0, logs: 0 })
      return
    }
    dbService.recordExecutionStart('agent-c', 'x')
    const r = dbService.cleanup(30 * 24 * 60 * 60 * 1000)
    expect(r.executions).toBe(0)
    expect(r.logs).toBe(0)
  })

  it('getStats 返回结构', () => {
    const s = dbService.getStats()
    expect(s).toHaveProperty('executions')
    expect(s).toHaveProperty('logs')
    expect(s).toHaveProperty('ready')
    expect(s).toHaveProperty('path')
    expect(s.ready).toBe(dbService.isReady())
  })

  // ===== Chat Messages 持久化 =====
  it('saveChatMessage + loadChatMessages 往返', () => {
    if (!dbService.isReady()) {
      expect(dbService.saveChatMessage({ role: 'user', content: 'x', timestamp: 1 })).toBe(-1)
      expect(dbService.loadChatMessages()).toEqual([])
      return
    }
    const ts = Date.now()
    const id = dbService.saveChatMessage({
      sessionId: 'test-session',
      role: 'user',
      content: 'hello world',
      thinking: 'let me think',
      toolCalls: '[{"name":"search"}]',
      timestamp: ts,
      provider: 'openai',
      model: 'gpt-4',
      tokenInput: 10,
      tokenOutput: 20,
      cost: 0.001,
    })
    expect(id).toBeGreaterThan(0)

    const msgs = dbService.loadChatMessages('test-session')
    expect(msgs.length).toBeGreaterThanOrEqual(1)
    const m = msgs.find((r) => r.id === id) as Record<string, unknown> | undefined
    expect(m).toBeDefined()
    expect(m?.role).toBe('user')
    expect(m?.content).toBe('hello world')
    expect(m?.thinking).toBe('let me think')
    expect(m?.provider).toBe('openai')
    expect(m?.token_input).toBe(10)
  })

  it('saveChatMessage 默认 session 为 default', () => {
    if (!dbService.isReady()) return
    const id = dbService.saveChatMessage({
      role: 'assistant',
      content: 'response',
      timestamp: Date.now(),
    })
    expect(id).toBeGreaterThan(0)
    const msgs = dbService.loadChatMessages('default')
    const found = msgs.find((r) => r.id === id)
    expect(found).toBeDefined()
  })

  it('listChatSessions 返回包含已写入的 session', () => {
    if (!dbService.isReady()) {
      expect(dbService.listChatSessions()).toEqual([])
      return
    }
    dbService.saveChatMessage({
      sessionId: 'list-test',
      role: 'user',
      content: 'test',
      timestamp: Date.now(),
    })
    const sessions = dbService.listChatSessions()
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    const found = sessions.find((s) => s.id === 'list-test')
    expect(found).toBeDefined()
    expect(found?.message_count).toBeGreaterThanOrEqual(1)
  })

  it('deleteChatSession 删除消息和会话记录', () => {
    if (!dbService.isReady()) {
      expect(dbService.deleteChatSession('x')).toBe(false)
      return
    }
    dbService.saveChatMessage({
      sessionId: 'del-test',
      role: 'user',
      content: 'to be deleted',
      timestamp: Date.now(),
    })
    expect(dbService.loadChatMessages('del-test').length).toBeGreaterThanOrEqual(1)
    const ok = dbService.deleteChatSession('del-test')
    expect(ok).toBe(true)
    expect(dbService.loadChatMessages('del-test').length).toBe(0)
    const sessions = dbService.listChatSessions()
    expect(sessions.find((s) => s.id === 'del-test')).toBeUndefined()
  })

  it('close 后 isReady 应为 false', async () => {
    if (!dbService.isReady()) return
    await dbService.close()
    expect(dbService.isReady()).toBe(false)
    // close 后再 close 不应抛异常
    await dbService.close()
  })
})
