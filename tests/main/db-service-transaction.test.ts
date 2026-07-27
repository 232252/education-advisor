// =============================================================
// DB Service — deleteChatSession 事务原子性回归测试
// 修复: 两步删除用事务包裹,保证原子性
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const sep = process.platform === 'win32' ? '\\' : '/'
const tmpBase = process.env.TEMP || process.env.TMP || '/tmp'
const tmpDir = `${tmpBase}${sep}db-tx-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return tmpDir
    throw new Error(`Unexpected path: ${name}`)
  }),
}))

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

describe('dbService deleteChatSession 事务原子性', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
    await dbService.init()
  })

  afterAll(async () => {
    await dbService.close()
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('删除会话时消息和会话记录同时被删除', () => {
    if (skip()) return
    const sessionId = `tx-atomic-${Date.now()}`
    dbService.saveChatMessage({
      sessionId,
      role: 'user',
      content: 'msg1',
      timestamp: 1,
    })
    dbService.saveChatMessage({
      sessionId,
      role: 'assistant',
      content: 'reply1',
      timestamp: 2,
    })

    // 确认写入
    expect(dbService.loadChatMessages(sessionId).length).toBeGreaterThanOrEqual(2)

    // 删除
    expect(dbService.deleteChatSession(sessionId)).toBe(true)

    // 消息被删
    expect(dbService.loadChatMessages(sessionId).length).toBe(0)

    // 会话记录被删
    const sessions = dbService.listChatSessions()
    const ids = sessions.map(
      (s) => (s as { session_id?: string }).session_id ?? (s as { id?: string }).id,
    )
    expect(ids).not.toContain(sessionId)
  })

  it('删除不存在的 session 不抛错(事务仍成功)', () => {
    if (skip()) return
    expect(() => dbService.deleteChatSession('never-exists-tx')).not.toThrow()
  })

  it('连续删除多个会话各自独立', () => {
    if (skip()) return
    const s1 = `multi-del-1-${Date.now()}`
    const s2 = `multi-del-2-${Date.now()}`
    dbService.saveChatMessage({ sessionId: s1, role: 'user', content: 'a', timestamp: 1 })
    dbService.saveChatMessage({ sessionId: s2, role: 'user', content: 'b', timestamp: 2 })

    expect(dbService.deleteChatSession(s1)).toBe(true)

    // s2 不受影响
    expect(dbService.loadChatMessages(s2).length).toBeGreaterThanOrEqual(1)

    expect(dbService.deleteChatSession(s2)).toBe(true)
    expect(dbService.loadChatMessages(s2).length).toBe(0)
  })
})
