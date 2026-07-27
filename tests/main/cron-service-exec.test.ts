// =============================================================
// Cron Service 补充测试 — executeTask happy path / 并发锁 / 日志持久化
// 此前只测了 CRUD,核心执行路径(executeTask)未覆盖
// =============================================================

import fsp from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmpDir = path.join(
  os.tmpdir(),
  `cron-exec-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  app: { getPath: mocks.getPath, isPackaged: mocks.isPackaged },
  BrowserWindow: class {},
}))

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

const { cronService } = await import('../../src/main/services/cron-service')

// 伪造 BrowserWindow: webContents.send 可观测
function makeFakeWin() {
  return {
    webContents: {
      send: mocks.webContentsSend,
    },
    isDestroyed: () => false,
  } as unknown as import('electron').BrowserWindow
}

describe('cronService executeTask 补充', () => {
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
    for (const t of cronService.listTasks()) {
      cronService.removeTask(t.id)
    }
    mocks.webContentsSend.mockClear()
  })

  describe('runNow happy path', () => {
    it('设置 mainWindow + agentRunner 后 runNow 应执行 agent', async () => {
      const runner = vi.fn(async () => undefined)
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '执行测试',
        agentId: 'test-agent',
        expression: '0 9 * * *',
        prompt: '运行一下',
        enabled: true,
        modelTier: 'low_cost',
      })

      await cronService.runNow(id)

      expect(runner).toHaveBeenCalledWith('test-agent', '运行一下', expect.anything())
      // 状态应广播
      expect(mocks.webContentsSend).toHaveBeenCalled()
      // 任务 lastStatus 应为 success
      const task = cronService.listTasks().find((t) => t.id === id)
      expect(task?.lastStatus).toBe('success')
    })

    it('getLogs 应返回执行日志', async () => {
      const runner = vi.fn(async () => undefined)
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '日志测试',
        agentId: 'log-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      await cronService.runNow(id)

      const logs = cronService.getLogs(id)
      expect(logs.length).toBeGreaterThanOrEqual(1)
      expect(logs[0].status).toBe('success')
      expect(logs[0].agentId).toBe('log-agent')
    })

    it('agentRunner 抛错时 lastStatus=error,日志记录错误', async () => {
      const runner = vi.fn(async () => {
        throw new Error('agent 崩了')
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '错误测试',
        agentId: 'err-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      await cronService.runNow(id)

      const task = cronService.listTasks().find((t) => t.id === id)
      expect(task?.lastStatus).toBe('error')
      const logs = cronService.getLogs(id)
      expect(logs.some((l) => l.status === 'error' && l.error?.includes('崩了'))).toBe(true)
    })

    it('未设置 agentRunner 时应警告但不崩溃', async () => {
      // 用一个没有 runner 的 cronService
      cronService.setMainWindow(makeFakeWin())
      // 不调 setAgentRunner (或设为 null — 用一个新的 runner=null)
      // 注意: setAgentRunner 只能设置非 null,我们用 hack 清空
      ;(cronService as unknown as { agentRunner: unknown }).agentRunner = null

      const id = cronService.addTask({
        name: '无runner',
        agentId: 'a',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      // 不应抛错
      await cronService.runNow(id)
    })
  })

  describe('per-task 并发锁 (High 2.3)', () => {
    it('同一任务并发 runNow 应只执行一次', async () => {
      let callCount = 0
      const runner = vi.fn(async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 100))
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '并发锁',
        agentId: 'lock-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      // 并发触发两次
      await Promise.all([cronService.runNow(id), cronService.runNow(id)])
      // runner 应只被调一次(第二次被锁跳过)
      expect(callCount).toBe(1)
    })

    it('不同任务可并发执行', async () => {
      const runner = vi.fn(async (_id: string) => {
        await new Promise((r) => setTimeout(r, 50))
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id1 = cronService.addTask({
        name: '任务A',
        agentId: 'a1',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      const id2 = cronService.addTask({
        name: '任务B',
        agentId: 'a2',
        expression: '0 10 * * *',
        prompt: 'y',
        enabled: true,
        modelTier: 'low_cost',
      })

      await Promise.all([cronService.runNow(id1), cronService.runNow(id2)])
      expect(runner).toHaveBeenCalledTimes(2)
    })
  })

  describe('日志持久化', () => {
    it('flushLogs 应将日志写入 JSONL 文件', async () => {
      const runner = vi.fn(async () => undefined)
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '持久化测试',
        agentId: 'persist-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      await cronService.runNow(id)
      await cronService.flushLogs()

      const logFile = path.join(tmpDir, 'cron-logs.jsonl')
      expect(fs.existsSync(logFile)).toBe(true)
      const content = fs.readFileSync(logFile, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)
      expect(lines.length).toBeGreaterThanOrEqual(1)
      const entry = JSON.parse(lines[lines.length - 1])
      expect(entry.taskId).toBe(id)
      expect(entry.status).toBe('success')
    })

    it('多次执行后日志累积且可按 taskId 过滤', async () => {
      const runner = vi.fn(async () => undefined)
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id1 = cronService.addTask({
        name: '过滤A',
        agentId: 'fa',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })
      const id2 = cronService.addTask({
        name: '过滤B',
        agentId: 'fb',
        expression: '0 9 * * *',
        prompt: 'y',
        enabled: true,
        modelTier: 'low_cost',
      })
      await cronService.runNow(id1)
      await cronService.runNow(id2)
      await cronService.runNow(id1)

      const logs1 = cronService.getLogs(id1)
      const logs2 = cronService.getLogs(id2)
      expect(logs1.length).toBe(2)
      expect(logs2.length).toBe(1)
      // 所有 id1 日志的 taskId 都是 id1
      expect(logs1.every((l) => l.taskId === id1)).toBe(true)
    })
  })

  describe('MAX_USER_TASKS 限制', () => {
    it('超过 100 个用户任务应抛错', () => {
      // 添加 100 个
      for (let i = 0; i < 100; i++) {
        cronService.addTask({
          name: `T${i}`,
          agentId: 'a',
          expression: '0 9 * * *',
          prompt: 'x',
          enabled: false,
          modelTier: 'low_cost',
        })
      }
      expect(cronService.listTasks().length).toBe(100)
      // 第 101 个应抛错
      expect(() =>
        cronService.addTask({
          name: 'overflow',
          agentId: 'a',
          expression: '0 9 * * *',
          prompt: 'x',
          enabled: false,
          modelTier: 'low_cost',
        }),
      ).toThrow(/limit/i)
    })
  })
})
