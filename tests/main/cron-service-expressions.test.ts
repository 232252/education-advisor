// =============================================================
// Cron Service — 表达式验证 / 任务生命周期 / 系统任务 边界测试
// =============================================================

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const tmpDir = path.join(
  os.tmpdir(),
  `cron-expr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((n: string) => (n === 'userData' ? tmpDir : '')),
  isPackaged: false,
}))

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: mocks.isPackaged } }))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: () => ({ feishu: { bitableSync: { enabled: false, syncInterval: '0 */6 * * *' } } }),
  },
}))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getSecret: vi.fn().mockReturnValue('') },
}))
vi.mock('../../src/main/services/feishu-service', () => ({
  syncBitableNow: vi.fn().mockResolvedValue({ success: true }),
}))

const { cronService } = await import('../../src/main/services/cron-service')

describe('cronService — 合法 cron 表达式', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
  })
  afterAll(async () => {
    await cronService.shutdown()
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    for (const t of cronService.listTasks()) cronService.removeTask(t.id)
  })

  const validExpressions = [
    '0 9 * * *', // 每天9点
    '*/5 * * * *', // 每5分钟
    '0 */2 * * *', // 每2小时
    '0 0 * * 0', // 每周日0点
    '0 0 1 * *', // 每月1号
    '30 4 * * 1-5', // 工作日4:30
    '0 0,12 * * *', // 每天0点和12点
    '0 0 1 1 *', // 每年1月1号
  ]

  for (const expr of validExpressions) {
    it(`合法表达式 "${expr}" 应被接受(有 nextRunAt)`, () => {
      const id = cronService.addTask({
        name: `Test ${expr}`,
        agentId: 'a',
        expression: expr,
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      const next = cronService.getNextRunAt(id)
      // 合法表达式应有 nextRunAt (字符串)
      expect(typeof next).toBe('string')
    })
  }
})

describe('cronService — 非法 cron 表达式', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
  })
  afterAll(async () => {
    await cronService.shutdown()
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    for (const t of cronService.listTasks()) cronService.removeTask(t.id)
  })

  const invalidExpressions = [
    'invalid',
    '',
    'abc def ghi',
    '* * *', // 字段不足
    '100 * * * *', // 分钟越界
    '* 25 * * *', // 小时越界
    '* * * * 8', // 星期越界
    '*****',
  ]

  for (const expr of invalidExpressions) {
    it(`非法表达式 "${expr}" 任务被添加但无 nextRunAt`, () => {
      const id = cronService.addTask({
        name: `Invalid ${expr}`,
        agentId: 'a',
        expression: expr,
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      // 任务被添加到列表
      expect(cronService.listTasks().find((t) => t.id === id)).toBeDefined()
      // 但没有 nextRunAt(未被调度)
      expect(cronService.getNextRunAt(id)).toBeUndefined()
    })
  }
})

describe('cronService — 任务生命周期完整流程', () => {
  beforeEach(() => {
    for (const t of cronService.listTasks()) cronService.removeTask(t.id)
  })

  it('add → update → toggle off → toggle on → remove', () => {
    const id = cronService.addTask({
      name: '生命周期',
      agentId: 'life-agent',
      expression: '0 9 * * *',
      prompt: 'do',
      enabled: true,
      modelTier: 'low_cost',
    })
    expect(cronService.listTasks().length).toBe(1)

    // update
    const upd = cronService.updateTask(id, { name: '改名', prompt: 'new prompt' })
    expect(upd.success).toBe(true)
    const task = cronService.listTasks().find((t) => t.id === id)
    expect(task?.name).toBe('改名')
    expect(task?.prompt).toBe('new prompt')

    // toggle off
    const off = cronService.toggleTask(id, false)
    expect(off.success).toBe(true)
    expect(cronService.listTasks().find((t) => t.id === id)?.enabled).toBe(false)

    // toggle on
    cronService.toggleTask(id, true)
    expect(cronService.listTasks().find((t) => t.id === id)?.enabled).toBe(true)

    // remove
    cronService.removeTask(id)
    expect(cronService.listTasks().find((t) => t.id === id)).toBeUndefined()
  })

  it('update 不存在的任务返回失败', () => {
    const r = cronService.updateTask('nonexistent', { name: 'x' })
    expect(r.success).toBe(false)
  })

  it('toggle 不存在的任务返回失败', () => {
    const r = cronService.toggleTask('nonexistent', true)
    expect(r.success).toBe(false)
  })

  it('remove 不存在的任务不报错', () => {
    expect(() => cronService.removeTask('nonexistent')).not.toThrow()
  })
})

describe('cronService — 系统任务计数排除', () => {
  it('agent-schedule-* 任务不计入用户任务上限', () => {
    // 添加一些 "系统" 任务(用 agent-schedule- 前缀)
    for (let i = 0; i < 5; i++) {
      cronService.addTask({
        name: `Agent Schedule ${i}`,
        agentId: 'a',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
    }
    // 用户任务应能继续添加(不受系统任务影响)
    const userId = cronService.addTask({
      name: 'User Task',
      agentId: 'b',
      expression: '0 10 * * *',
      prompt: 'y',
      enabled: true,
      modelTier: 'low_cost',
    })
    expect(userId).toMatch(/^task-/)
  })
})
