// =============================================================
// M35: cron 错过调度补偿测试
// - 单元级: compensateMissedExecution 判定逻辑(注入过期 lastRunAt 断言补跑)
// - 服务级: 真实 node-cron missed 路径 — Atomics.wait 阻塞事件循环模拟系统睡眠
//   (vitest fake timers 跳过时钟后逾期定时器不会触发,无法模拟"睡过头",
//    故用真实定时器 + 事件循环阻塞让 node-cron v4 的 planBeat 判定 missed),
//   断言: 醒来后补跑一次(skipped_missed 日志)、正常调度不受影响
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronLogEntry, CronTask } from '@shared/types'
import type { SchedulerBindingState } from '../../src/main/services/cron/scheduler-binding'

const tmpDir = path.join(
  os.tmpdir(),
  `cron-missed-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
const { compensateMissedExecution } = await import(
  '../../src/main/services/cron/scheduler-binding'
)

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

// 伪造 BrowserWindow: webContents.send 可观测
function makeFakeWin() {
  return {
    webContents: {
      send: mocks.webContentsSend,
    },
    isDestroyed: () => false,
  } as unknown as import('electron').BrowserWindow
}

function makeExecution(agentId: string): import('@shared/types').AgentExecution {
  return {
    id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    prompt: 'x',
    output: 'ok',
    startedAt: Date.now(),
    durationMs: 1,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: 0,
    status: 'success',
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 轮询等待 agent runner 被调用 n 次(真实定时器场景) */
async function waitForCalls(calls: unknown[], n: number, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  while (calls.length < n) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for call #${n} (got ${calls.length})`)
    }
    await sleep(50)
  }
}

/** 阻塞事件循环模拟系统睡眠(期间定时器冻结,醒来后逾期定时器才触发) */
function blockEventLoop(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(ms, 0))
}

// -------------------------------------------------------------
// 单元级: compensateMissedExecution 判定逻辑
// -------------------------------------------------------------
function makeBindingState(runningTasks: Set<string> = new Set()) {
  const pushed: CronLogEntry[] = []
  const state: SchedulerBindingState = {
    scheduledJobs: new Map(),
    nextRunAt: new Map(),
    runningTasks,
    pushLog: (entry) => pushed.push(entry),
  }
  return { state, pushed }
}

function makeTask(patch: Partial<CronTask> = {}): CronTask {
  return {
    id: 't-missed',
    name: 'Missed Task',
    agentId: 'agent-x',
    expression: '0 */6 * * *',
    prompt: 'x',
    enabled: true,
    modelTier: 'low_cost',
    ...patch,
  }
}

describe('M35 compensateMissedExecution 判定逻辑(单元)', () => {
  it('注入过期的 lastRunAt(落后于错过槽位 ≥1 周期)→ 记 skipped_missed 日志并立即补跑一次', () => {
    const { state, pushed } = makeBindingState()
    // lastRunAt 过期一天,错过槽位是一小时前 → 整个周期被错过
    const task = makeTask({ lastRunAt: Date.now() - 24 * 3600_000 })
    const onFire = vi.fn()
    const missedSlot = new Date(Date.now() - 3600_000)

    compensateMissedExecution(state, task.id, task, onFire, missedSlot)

    expect(onFire).toHaveBeenCalledTimes(1)
    expect(pushed).toHaveLength(1)
    expect(pushed[0].taskId).toBe('t-missed')
    expect(pushed[0].agentId).toBe('agent-x')
    expect(pushed[0].status).toBe('skipped_missed')
    expect(pushed[0].durationMs).toBe(0)
    expect(pushed[0].error).toContain('补跑')
  })

  it('lastRunAt ≥ 槽位时间(runNow 手动跑过,槽位已被覆盖)→ 不补跑', () => {
    const { state, pushed } = makeBindingState()
    const missedSlot = new Date(Date.now() - 3600_000)
    const task = makeTask({ lastRunAt: Date.now() })
    const onFire = vi.fn()

    compensateMissedExecution(state, task.id, task, onFire, missedSlot)

    expect(onFire).not.toHaveBeenCalled()
    expect(pushed).toHaveLength(0)
  })

  it('lastRunAt 恰好等于槽位时间(该槽位按时执行过)→ 不补跑', () => {
    const { state, pushed } = makeBindingState()
    const slotMs = Date.now() - 3600_000
    const task = makeTask({ lastRunAt: slotMs })
    const onFire = vi.fn()

    compensateMissedExecution(state, task.id, task, onFire, new Date(slotMs))

    expect(onFire).not.toHaveBeenCalled()
    expect(pushed).toHaveLength(0)
  })

  it('任务从未执行过(lastRunAt 缺失)且首个应跑槽位被错过 → 补跑', () => {
    const { state, pushed } = makeBindingState()
    const task = makeTask() // 无 lastRunAt
    const onFire = vi.fn()

    compensateMissedExecution(state, task.id, task, onFire, new Date(Date.now() - 60_000))

    expect(onFire).toHaveBeenCalledTimes(1)
    expect(pushed).toHaveLength(1)
  })

  it('首个补跑仍在执行(runningTasks 持锁)→ 同批后续 missed 槽位不重复补跑', () => {
    const { state, pushed } = makeBindingState(new Set(['t-missed']))
    const task = makeTask({ lastRunAt: Date.now() - 24 * 3600_000 })
    const onFire = vi.fn()

    compensateMissedExecution(state, task.id, task, onFire, new Date(Date.now() - 3600_000))

    expect(onFire).not.toHaveBeenCalled()
    expect(pushed).toHaveLength(0)
  })

  it('补跑完成后 lastRunAt 已刷新 → 更早的 missed 槽位不再补(保守补一次而非追帧)', () => {
    const { state, pushed } = makeBindingState()
    // 模拟: 第一个槽位(2h 前)已补跑,执行链将 lastRunAt 刷新为 now
    const task = makeTask({ lastRunAt: Date.now() })
    const onFire = vi.fn()

    // 同批第二个 missed 槽位(1h 前)到达 → lastRunAt 已覆盖它,不重复补
    compensateMissedExecution(state, task.id, task, onFire, new Date(Date.now() - 3600_000))

    expect(onFire).not.toHaveBeenCalled()
    expect(pushed).toHaveLength(0)
  })

  it('任务已禁用 → 不补跑', () => {
    const { state, pushed } = makeBindingState()
    const task = makeTask({ enabled: false, lastRunAt: Date.now() - 24 * 3600_000 })
    const onFire = vi.fn()

    compensateMissedExecution(state, task.id, task, onFire, new Date(Date.now() - 3600_000))

    expect(onFire).not.toHaveBeenCalled()
    expect(pushed).toHaveLength(0)
  })
})

// -------------------------------------------------------------
// 服务级: 真实 node-cron missed 路径(真实定时器 + 事件循环阻塞)
// 表达式用 6 段式 */5 * * * * *(每 5 秒)缩短周期;node-cron 容差 1s,
// 阻塞到"槽位+3.5s"保证该槽位 lateBy≈3s > 容差 → 判 missed 且不迟到执行
// -------------------------------------------------------------
describe('M35 错过调度补偿(服务级)', () => {
  beforeEach(() => {
    for (const t of cronService.listTasks()) {
      cronService.removeTask(t.id)
    }
    mocks.webContentsSend.mockClear()
  })

  it(
    '系统睡眠(阻塞事件循环)错过槽位 → 醒来补跑一次;后续正常调度不受影响',
    async () => {
      const runnerCalls: string[] = []
      const runner = vi.fn(async (agentId: string) => {
        runnerCalls.push(agentId)
        return makeExecution(agentId)
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '睡眠补偿测试',
        agentId: 'sleep-agent',
        expression: '*/5 * * * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      try {
        // 阶段1: 正常到点执行一次(作为 lastRunAt 基准),此时不应有任何补偿
        await waitForCalls(runnerCalls, 1)
        await sleep(100) // 等执行链收尾(per-task 锁释放 / lastRunAt 刷新)
        expect(cronService.getLogs(id).filter((l) => l.status === 'skipped_missed')).toHaveLength(0)

        // 阶段2: 阻塞事件循环模拟系统睡眠,睡到"下一个 5s 槽位 + 3.5s"
        //   该槽位 lateBy≈3s > node-cron 容差 1s → planBeat 判 missed 且不迟到执行
        const wakeAt = Math.ceil(Date.now() / 5000) * 5000 + 3500
        blockEventLoop(wakeAt - Date.now())

        // 阶段3: 醒来 → execution:missed → 记 skipped_missed 日志并立即补跑一次
        await waitForCalls(runnerCalls, 2)
        const skipped = cronService.getLogs(id).filter((l) => l.status === 'skipped_missed')
        expect(skipped).toHaveLength(1)
        expect(skipped[0].taskId).toBe(id)
        expect(skipped[0].agentId).toBe('sleep-agent')
        expect(skipped[0].error).toContain('补跑')

        // 阶段4: 醒来后下一个 5s 槽位恢复正常到点执行(正常调度不受影响)
        await waitForCalls(runnerCalls, 3)
        // 补跑只发生一次(共 3 次执行: 1 次睡前正常 + 1 次补跑 + 1 次醒后正常)
        expect(runner).toHaveBeenCalledTimes(3)
        expect(cronService.getLogs(id).filter((l) => l.status === 'skipped_missed')).toHaveLength(1)
        const task = cronService.listTasks().find((t) => t.id === id)
        expect(task?.lastStatus).toBe('success')
      } finally {
        cronService.removeTask(id)
      }
    },
    30_000,
  )

  it(
    '正常运行(无睡眠)→ 不产生 skipped_missed 日志,调度照旧',
    async () => {
      const runnerCalls: string[] = []
      const runner = vi.fn(async (agentId: string) => {
        runnerCalls.push(agentId)
        return makeExecution(agentId)
      })
      cronService.setAgentRunner(runner)
      cronService.setMainWindow(makeFakeWin())

      const id = cronService.addTask({
        name: '正常调度测试',
        agentId: 'normal-agent',
        expression: '*/5 * * * * *',
        prompt: 'x',
        enabled: true,
        modelTier: 'low_cost',
      })

      try {
        // 连续两次到点执行
        await waitForCalls(runnerCalls, 1)
        await waitForCalls(runnerCalls, 2)

        expect(runner).toHaveBeenCalledTimes(2)
        const logs = cronService.getLogs(id)
        expect(logs.filter((l) => l.status === 'skipped_missed')).toHaveLength(0)
        expect(logs.filter((l) => l.status === 'success').length).toBeGreaterThanOrEqual(2)
      } finally {
        cronService.removeTask(id)
      }
    },
    30_000,
  )
})
