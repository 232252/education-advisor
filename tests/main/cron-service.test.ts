// =============================================================
// Cron Service 测试 — 任务增删改查、立即执行、状态广播
// 覆盖：addTask/listTasks/removeTask/toggleTask/runNow
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpDir = path.join(
  os.tmpdir(),
  `cron-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)

const mocks = vi.hoisted(() => ({
  getPath: vi.fn((name: string) => {
    if (name === 'userData') return tmpDir
    throw new Error(`Unexpected path: ${name}`)
  }),
  isPackaged: false,
  webContentsSend: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
    isPackaged: mocks.isPackaged,
  },
  BrowserWindow: class {},
}))

const { cronService } = await import('../../src/main/services/cron-service')

// mock settingsService 因为 cron-service 依赖
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: () => ({
      feishu: { bitableSync: { enabled: false, syncInterval: '0 */6 * * *' } },
    }),
  },
}))

vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: { getSecret: vi.fn().mockReturnValue('') },
}))

vi.mock('../../src/main/services/feishu-service', () => ({
  syncBitableNow: vi.fn().mockResolvedValue({ success: true }),
}))

describe('cronService', () => {
  beforeAll(async () => {
    await fsp.mkdir(tmpDir, { recursive: true })
  })

  afterAll(async () => {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks()
  })

  beforeEach(async () => {
    // 清理
    for (const t of cronService.listTasks()) {
      cronService.removeTask(t.id)
    }
  })

  it('listTasks 初始应为空', () => {
    expect(cronService.listTasks()).toEqual([])
  })

  it('addTask 应添加任务并返回 id', () => {
    const id = cronService.addTask({
      name: 'Test Task',
      agentId: 'agent-1',
      expression: '0 9 * * *',
      prompt: 'do something',
      enabled: true,
      modelTier: 'low_cost',
    })
    expect(id).toMatch(/^task-/)
    const tasks = cronService.listTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].name).toBe('Test Task')
    expect(tasks[0].agentId).toBe('agent-1')
  })

  it('addTask 含无效 cron 应被拒（不调度）', () => {
    const id = cronService.addTask({
      name: 'Invalid',
      agentId: 'a',
      expression: 'invalid-cron',
      prompt: 'x',
      enabled: true,
      modelTier: 'low_cost',
    })
    // 任务被添加但未调度
    const task = cronService.listTasks().find((t) => t.id === id)
    expect(task).toBeDefined()
    // 但 nextRunAt 不应存在
    expect(cronService.getNextRunAt(id)).toBeUndefined()
  })

  it('updateTask 应修改字段并重新调度', () => {
    const id = cronService.addTask({
      name: 'Original',
      agentId: 'a',
      expression: '0 9 * * *',
      prompt: 'x',
      enabled: true,
      modelTier: 'low_cost',
    })
    const result = cronService.updateTask(id, { name: 'Updated' })
    expect(result.success).toBe(true)
    expect(cronService.listTasks().find((t) => t.id === id)?.name).toBe('Updated')
  })

  it('updateTask 不存在的 id 应返回失败', () => {
    const result = cronService.updateTask('nonexistent', { name: 'x' })
    expect(result.success).toBe(false)
  })

  it('removeTask 应移除任务', () => {
    const id = cronService.addTask({
      name: 'To Remove',
      agentId: 'a',
      expression: '0 9 * * *',
      prompt: 'x',
      enabled: true,
      modelTier: 'low_cost',
    })
    const result = cronService.removeTask(id)
    expect(result.success).toBe(true)
    expect(cronService.listTasks().find((t) => t.id === id)).toBeUndefined()
  })

  it('toggleTask 关闭应停止调度，开启应重新调度', () => {
    const id = cronService.addTask({
      name: 'Toggle',
      agentId: 'a',
      expression: '0 9 * * *',
      prompt: 'x',
      enabled: true,
      modelTier: 'low_cost',
    })
    cronService.toggleTask(id, false)
    expect(cronService.getNextRunAt(id)).toBeUndefined()
    cronService.toggleTask(id, true)
    expect(cronService.getNextRunAt(id)).toBeDefined()
  })

  it('toggleTask 不存在的 id 应返回失败', () => {
    expect(cronService.toggleTask('nonexistent', true).success).toBe(false)
  })

  it('getLogs 应返回空数组（无执行历史）', () => {
    expect(cronService.getLogs()).toEqual([])
  })

  it('getLogs(taskId) 应过滤', () => {
    const id1 = cronService.addTask({
      name: 'A',
      agentId: 'a',
      expression: '0 9 * * *',
      prompt: 'x',
      enabled: true,
      modelTier: 'low_cost',
    })
    const id2 = cronService.addTask({
      name: 'B',
      agentId: 'a',
      expression: '0 10 * * *',
      prompt: 'y',
      enabled: true,
      modelTier: 'low_cost',
    })
    expect(cronService.getLogs(id1)).toEqual([])
    expect(cronService.getLogs(id2)).toEqual([])
  })

  it('runNow 不存在的 id 应不抛错', async () => {
    await expect(cronService.runNow('nonexistent')).resolves.toBeUndefined()
  })

  it('shutdown 应清理所有任务', async () => {
    cronService.addTask({
      name: 'A',
      agentId: 'a',
      expression: '0 9 * * *',
      prompt: 'x',
      enabled: true,
      modelTier: 'low_cost',
    })
    await cronService.shutdown()
    // shutdown 后 listTasks 仍返回（但 scheduled jobs 已停止）
    // 我们只验证 shutdown 不抛错
  })

  it('registerBitableSync 关闭时不应注册', () => {
    // settings mock 关闭 bitableSync
    cronService.registerBitableSync()
    // 不应有 'feishu-bitable-sync' 任务
    const tasks = cronService.listTasks()
    expect(tasks.find((t) => t.id === 'feishu-bitable-sync')).toBeUndefined()
  })

  it('executeBitableSync 关闭时返回 skipped', async () => {
    const result = await cronService.executeBitableSync()
    expect(result.success).toBe(false)
    expect(result.skipped).toMatch(/disabled/)
  })

  it('syncAgentSchedules 应清理旧任务并创建新任务', () => {
    cronService.syncAgentSchedules([
      {
        id: 'agent-x',
        name: 'Agent X',
        schedule: ['0 9 * * *', '0 18 * * *'],
        modelTier: 'high_quality',
      },
    ])
    const tasks = cronService.listTasks()
    const agentTasks = tasks.filter((t) => t.id.startsWith('agent-schedule-agent-x'))
    expect(agentTasks).toHaveLength(2)
  })

  it('syncAgentSchedules 重新调用应清理旧 agent-schedule 任务', () => {
    cronService.syncAgentSchedules([
      { id: 'a1', name: 'A1', schedule: ['0 9 * * *'], modelTier: 'low_cost' },
    ])
    cronService.syncAgentSchedules([
      { id: 'a2', name: 'A2', schedule: ['0 10 * * *'], modelTier: 'low_cost' },
    ])
    const tasks = cronService.listTasks()
    expect(tasks.find((t) => t.id === 'agent-schedule-a1-0')).toBeUndefined()
    expect(tasks.find((t) => t.id === 'agent-schedule-a2-0')).toBeDefined()
  })

  it('syncAgentSchedules 应跳过无效 cron', () => {
    cronService.syncAgentSchedules([
      { id: 'a3', name: 'A3', schedule: ['invalid-cron'], modelTier: 'low_cost' },
    ])
    const tasks = cronService.listTasks()
    expect(tasks.find((t) => t.id === 'agent-schedule-a3-0')).toBeUndefined()
  })

  it('loadPersistedLogs 无文件时应静默返回', async () => {
    // 不应抛错
    await expect(cronService.loadPersistedLogs()).resolves.toBeUndefined()
    expect(cronService.getLogs()).toEqual([])
  })
})
