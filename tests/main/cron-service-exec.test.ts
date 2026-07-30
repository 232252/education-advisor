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

// R169: runAgent 现返回 AgentExecution | undefined;undefined 表示排队期间被 abort(记 error)。
// 因此"成功" mock 必须返回 status:'success' 的 execution 对象。
function makeExecution(
  agentId: string,
  status: 'success' | 'error' | 'timeout' = 'success',
  output = 'ok',
): import('../../src/shared/types').AgentExecution {
  return {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    prompt: 'x',
    output,
    startedAt: Date.now(),
    durationMs: 1,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: 0,
    status,
  }
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
      const runner = vi.fn(async () => makeExecution('test-agent'))
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
      const runner = vi.fn(async () => makeExecution('log-agent'))
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
        return makeExecution('lock-agent')
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
      const runner = vi.fn(async (agentId: string) => {
        await new Promise((r) => setTimeout(r, 50))
        return makeExecution(agentId)
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
      const runner = vi.fn(async () => makeExecution('persist-agent'))
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
      const runner = vi.fn(async (agentId: string) => makeExecution(agentId))
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

  // =============================================================
  // 熔断器 (circuit breaker) — 修复 Agent 调度配额耗尽后空转
  // 根因: 配额耗尽(429/rate_limit)后 cron 仍按时触发,每次都失败空转。
  // 修复: 连续 N 次配额类错误后自动暂停该任务的 cron 触发。
  // =============================================================
  describe('熔断器 circuit breaker', () => {
    it('连续 3 次配额类错误(429)后,第 4 次 cron 触发应被跳过', async () => {
      // runner 每次都抛 429 配额错误
      const runner = vi.fn(async () => {
        throw new Error('429 rate_limit_error 已达到 Token Plan 用量上限')
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '配额耗尽测试',
        agentId: 'quota-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      // 连续 3 次 cron 触发,全部失败 (达阈值 3)
      await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id)
      expect(runner).toHaveBeenCalledTimes(3)

      // 第 4 次 cron 触发应被熔断跳过,不再调 runner
      await cronService.triggerScheduled(id)
      expect(runner).toHaveBeenCalledTimes(3) // 仍是 3,没增加

      // lastStatus 应标记为熔断跳过
      const task = cronService.listTasks().find((t) => t.id === id)
      expect(task?.lastStatus).toBe('skipped_circuit_breaker')
    })

    it('熔断后 runNow 手动触发仍执行(绕过熔断)', async () => {
      let callCount = 0
      const runner = vi.fn(async () => {
        callCount++
        // 前 3 次抛配额错误触发熔断
        if (callCount <= 3) {
          throw new Error('rate_limit: quota exceeded')
        }
        return makeExecution('manual-agent')
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '手动绕过测试',
        agentId: 'manual-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      // 触发熔断
      await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id) // 第 4 次被跳过
      expect(callCount).toBe(3)

      // runNow 手动触发应绕过熔断,实际执行第 4 次
      await cronService.runNow(id)
      expect(callCount).toBe(4)
    })

    it('runNow 手动成功后熔断重置,后续 cron 触发恢复正常', async () => {
      let callCount = 0
      const runner = vi.fn(async () => {
        callCount++
        if (callCount <= 3) throw new Error('429 too many requests')
        // 第 4 次起成功
        return makeExecution('recover-agent')
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '恢复测试',
        agentId: 'recover-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      // 触发熔断 (3 次失败)
      for (let i = 0; i < 3; i++) await cronService.triggerScheduled(id)
      // 手动触发成功 -> 重置熔断
      await cronService.runNow(id)
      expect(callCount).toBe(4)

      // 后续 cron 触发应恢复正常执行
      await cronService.triggerScheduled(id)
      expect(callCount).toBe(5)
      const task = cronService.listTasks().find((t) => t.id === id)
      expect(task?.lastStatus).toBe('success')
    })

    it('普通错误(非配额类)连续失败不触发熔断', async () => {
      const runner = vi.fn(async () => {
        throw new Error('network error: ECONNRESET')
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '普通错误测试',
        agentId: 'net-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      // 连续 4 次普通错误,不应熔断
      for (let i = 0; i < 4; i++) await cronService.triggerScheduled(id)
      expect(runner).toHaveBeenCalledTimes(4) // 全部执行了,没被跳过
      const task = cronService.listTasks().find((t) => t.id === id)
      expect(task?.lastStatus).toBe('error') // 不是 skipped_circuit_breaker
    })

    it('toggleTask 关再开重置熔断', async () => {
      const runner = vi.fn(async () => {
        throw new Error('429 quota')
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: 'toggle 恢复测试',
        agentId: 'toggle-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      // 触发熔断
      for (let i = 0; i < 3; i++) await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id) // 被跳过
      expect(runner).toHaveBeenCalledTimes(3)

      // toggle 关再开 -> 重置熔断
      cronService.toggleTask(id, false)
      cronService.toggleTask(id, true)

      // 再次 cron 触发应执行 (又会失败,但至少没被熔断跳过)
      await cronService.triggerScheduled(id)
      expect(runner).toHaveBeenCalledTimes(4)
    })

    it('成功执行清零失败计数(2失败+1成功+再失败,从1起算)', async () => {
      let callCount = 0
      const runner = vi.fn(async () => {
        callCount++
        // 第 1,2 次失败,第 3 次成功,第 4,5,6 次失败才触发熔断
        if (callCount === 1 || callCount === 2) throw new Error('429 rate_limit')
        if (callCount === 3) return makeExecution('reset-agent') // 成功
        if (callCount >= 4) throw new Error('429 rate_limit')
        return makeExecution('reset-agent')
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '计数清零测试',
        agentId: 'reset-agent',
        expression: '0 9 * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      // 2 次失败
      await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id)
      // 1 次成功 -> 清零
      await cronService.triggerScheduled(id)
      // 再 2 次失败 (累计 2,未达阈值 3)
      await cronService.triggerScheduled(id)
      await cronService.triggerScheduled(id)
      // 第 6 次:累计 3,触发熔断;第 7 次应被跳过
      await cronService.triggerScheduled(id)
      expect(callCount).toBe(6)
      await cronService.triggerScheduled(id)
      expect(callCount).toBe(6) // 第 7 次被跳过
    })
  })
})
