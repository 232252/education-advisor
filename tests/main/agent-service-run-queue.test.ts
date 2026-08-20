// =============================================================
// Agent Service — runAgent 串行队列测试
// 修复: 并发 runAgent 同一 agent 不再抛 "Agent is already running",
// 改为排队串行执行; abort 清空排队任务; 队列深度有上限。
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const mocks = vi.hoisted(() => {
  if (!process.resourcesPath) {
    Object.defineProperty(process, 'resourcesPath', {
      value: require('node:path').join(require('node:os').tmpdir(), 'fake-resources'),
      configurable: true,
    })
  }
  return {
    userDataDir: '',
    getPath: vi.fn((n: string) => (n === 'userData' ? mocks.userDataDir : '')),
    unsubscribeFn: vi.fn(),
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))

// Agent mock: prompt 按传入文本路由到当前测试设置的行为函数。
// 注: executeRun 有 continuation 机制(单次运行可能多次调用 prompt),
// 因此按 prompt 文本区分"哪一次运行的首轮",不依赖调用次数。
const agentMockState = {
  /** 收到的所有 prompt 文本(含 continuation) */
  calls: [] as Array<unknown>,
  /** 当前测试的行为函数,按 prompt 文本返回 promise */
  implFor: (_text: unknown): Promise<void> => Promise.resolve(),
}

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: class {
    state = {
      messages: [],
      tools: [],
      systemPrompt: '',
      model: {},
      thinkingLevel: 'medium',
    }
    async prompt(text?: unknown) {
      agentMockState.calls.push(text)
      return agentMockState.implFor(text)
    }
    waitForIdle() {
      return Promise.resolve()
    }
    async abort() {
      /* no-op */
    }
    subscribe() {
      return mocks.unsubscribeFn
    }
  },
}))

vi.mock('@earendil-works/pi-ai/compat', () => ({
  getEnvApiKey: vi.fn(() => 'test-key'),
  streamSimple: vi.fn(),
  getModel: vi.fn(() => ({
    id: 'test-model',
    name: 'Test',
    api: 'openai-completions',
    provider: 'test-provider',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 4096,
  })),
  getModels: vi.fn(() => [
    {
      id: 'test-model',
      name: 'Test',
      api: 'openai-completions',
      provider: 'test-provider',
      baseUrl: '',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32000,
      maxTokens: 4096,
    },
  ]),
  getProviders: vi.fn(() => ['test-provider']),
}))

vi.mock('./compaction-helper', () => ({ compactAgentMessages: vi.fn() }))
vi.mock('./cron-service', () => ({
  cronService: {
    setAgentRunner: vi.fn(),
    syncAgentSchedules: vi.fn(() => new Map()),
    getNextRunAt: vi.fn(() => undefined),
  },
}))
vi.mock('./db-service', () => ({
  dbService: {
    recordExecutionStart: vi.fn(() => 1),
    updateExecution: vi.fn(() => true),
  },
}))
vi.mock('./eaa-tools', () => ({ getToolsByCapability: vi.fn(() => []) }))
vi.mock('./file-tools', () => ({ allFileTools: [] }))
vi.mock('./keystore-service', () => ({
  keystoreService: {
    getApiKey: vi.fn(() => 'test-key'),
    getSecret: vi.fn(() => ''),
  },
}))
vi.mock('./settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      models: {
        defaultProvider: 'test-provider',
        defaultModel: 'test-model',
        customModels: {},
      },
      // M15: execution.ts 读取 general.agentTimeoutMins 作为 waitForIdle 超时
      general: {
        agentTimeoutMins: 5,
      },
      chat: {
        thinkingLevel: 'medium',
        steeringMode: 'all',
        followUpMode: 'all',
        showImages: true,
        compaction: {
          enabled: false,
          reserveTokens: 8000,
          keepRecentTokens: 16000,
        },
      },
    })),
  },
}))
vi.mock('./skill-service', () => ({
  skillService: { listSkills: vi.fn(() => []) },
}))
vi.mock('./utility-tools', () => ({ allUtilityTools: [] }))

import { agentService } from '../../src/main/services/agent-service'

const tmpRoot = path.join(
  os.tmpdir(),
  `agent-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const userDataDir = path.join(tmpRoot, 'userData')

const fakeWin = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
}

beforeAll(async () => {
  mocks.userDataDir = userDataDir
  Object.defineProperty(process, 'resourcesPath', {
    value: path.join(tmpRoot, 'resources'),
    configurable: true,
  })
  await fsp.mkdir(userDataDir, { recursive: true })
})

afterAll(async () => {
  try {
    await fsp.rm(tmpRoot, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks()
})

/** 注入测试 agent 配置 */
function injectTestAgent(id: string) {
  const agents = (agentService as unknown as { agents: Map<string, unknown> }).agents
  agents.set(id, {
    id,
    name: `Test ${id}`,
    role: 'test',
    description: 'test',
    enabled: true,
    modelTier: 'low_cost',
    schedule: [],
    capabilities: [],
    riskThresholds: undefined,
  })
  const agentStatus = (agentService as unknown as { agentStatus: Map<string, unknown> })
    .agentStatus
  agentStatus.set(id, 'idle')
  return () => {
    agents.delete(id)
    agentStatus.delete(id)
  }
}

/** 可控的 deferred promise */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('AgentService runAgent 串行队列', () => {
  it('并发调用同一 agent: 排队执行,不抛 already running', async () => {
    const cleanup = injectTestAgent('test-queue-serial')
    agentMockState.calls = []

    const gate = deferred()
    const order: string[] = []
    agentMockState.implFor = async (text) => {
      if (text === 'first') {
        order.push('first-start')
        await gate.promise
        order.push('first-end')
      } else if (text === 'second') {
        order.push('second-start')
      }
    }

    // 并发触发两次运行(不 await 第一次)
    const p1 = agentService.runAgent('test-queue-serial', 'first', fakeWin as never)
    const p2 = agentService.runAgent('test-queue-serial', 'second', fakeWin as never)

    // 让第一次运行开始
    await new Promise((r) => setTimeout(r, 100))
    expect(order).toEqual(['first-start']) // 第二次还在排队

    gate.resolve()
    await p1
    await p2

    // 两次都执行了,且严格串行(second 在 first 结束后才开始)
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
    expect(agentMockState.calls).toContain('first')
    expect(agentMockState.calls).toContain('second')
    cleanup()
  })

  it('队列深度超限: 拒绝并提示排队已满', async () => {
    const cleanup = injectTestAgent('test-queue-full')
    agentMockState.calls = []

    const gate = deferred()
    agentMockState.implFor = async (text) => {
      if (text === 'run') await gate.promise
    }

    // 第一个占用运行位
    const p1 = agentService.runAgent('test-queue-full', 'run', fakeWin as never)
    await new Promise((r) => setTimeout(r, 100))

    // 排队 8 个(达到 MAX_RUN_QUEUE_DEPTH)
    const queued: Array<Promise<void>> = []
    for (let i = 0; i < 8; i++) {
      queued.push(agentService.runAgent('test-queue-full', `q${i}`, fakeWin as never))
    }
    await new Promise((r) => setTimeout(r, 20))

    // 第 9 个应被拒绝
    await expect(
      agentService.runAgent('test-queue-full', 'overflow', fakeWin as never),
    ).rejects.toThrow('排队已满')

    gate.resolve()
    await p1
    await Promise.all(queued)
    cleanup()
  })

  it('abort 清空排队任务: 排队中的运行被跳过', async () => {
    const cleanup = injectTestAgent('test-queue-abort')
    agentMockState.calls = []

    const gate = deferred()
    agentMockState.implFor = async (text) => {
      if (text === 'run') await gate.promise
    }

    // 第一个占用运行位
    const p1 = agentService.runAgent('test-queue-abort', 'run', fakeWin as never)
    await new Promise((r) => setTimeout(r, 100))

    // 排队 2 个
    const q1 = agentService.runAgent('test-queue-abort', 'q1', fakeWin as never)
    const q2 = agentService.runAgent('test-queue-abort', 'q2', fakeWin as never)
    await new Promise((r) => setTimeout(r, 20))

    // abort: 当前运行被中止 + 排队任务被清空
    const aborted = await agentService.abortAgent('test-queue-abort', fakeWin as never)
    expect(aborted).toBe(true)

    gate.resolve()
    await p1
    await q1
    await q2

    // 排队的 2 个被跳过(prompt 从未收到 q1/q2)
    expect(agentMockState.calls).toContain('run')
    expect(agentMockState.calls).not.toContain('q1')
    expect(agentMockState.calls).not.toContain('q2')
    cleanup()
  })

  it('abort 无运行无排队时返回 false', async () => {
    const cleanup = injectTestAgent('test-queue-abort-idle')
    const aborted = await agentService.abortAgent('test-queue-abort-idle', fakeWin as never)
    expect(aborted).toBe(false)
    cleanup()
  })

  it('前序运行失败不阻塞后续队列', async () => {
    const cleanup = injectTestAgent('test-queue-error')
    agentMockState.calls = []

    agentMockState.implFor = (text) =>
      text === 'fail' ? Promise.reject(new Error('LLM API error')) : Promise.resolve()

    const p1 = agentService.runAgent('test-queue-error', 'fail', fakeWin as never)
    const p2 = agentService.runAgent('test-queue-error', 'ok', fakeWin as never)

    // runAgent 不 rethrow(catch 吞掉),两个都正常 resolve
    await p1
    await p2
    // 第二次运行确实执行了
    expect(agentMockState.calls).toContain('ok')
    cleanup()
  })

  it('MEDIUM-1: 队列排满时 abort,新请求应立即被接受而非误拒', async () => {
    const cleanup = injectTestAgent('test-queue-abort-reset')
    agentMockState.calls = []

    const gate = deferred()
    agentMockState.implFor = async (text) => {
      if (text === 'run') await gate.promise
    }

    // 占住运行位 + 排满 8 个
    const p1 = agentService.runAgent('test-queue-abort-reset', 'run', fakeWin as never)
    await new Promise((r) => setTimeout(r, 100))
    const queued: Array<Promise<unknown>> = []
    for (let i = 0; i < 8; i++) {
      queued.push(agentService.runAgent('test-queue-abort-reset', `q${i}`, fakeWin as never))
    }
    await new Promise((r) => setTimeout(r, 20))

    // abort: 清空队列 + 重置 depth
    await agentService.abortAgent('test-queue-abort-reset', fakeWin as never)

    // 立即重新入队应被接受(修复前: depth 仍为 8,被误拒"排队已满")
    const pNew = agentService.runAgent('test-queue-abort-reset', 'after-abort', fakeWin as never)

    gate.resolve()
    await p1
    await Promise.all(queued)
    await pNew

    // 新请求确实执行了
    expect(agentMockState.calls).toContain('after-abort')
    cleanup()
  })

  it('LOW-1: run settle 后 tail 被清理,不再持有闭包', async () => {
    const cleanup = injectTestAgent('test-queue-tail-cleanup')
    agentMockState.calls = []
    agentMockState.implFor = () => Promise.resolve()

    await agentService.runAgent('test-queue-tail-cleanup', 'once', fakeWin as never)
    // 让 cleanupTail 的 then 回调执行
    await new Promise((r) => setTimeout(r, 10))

    const tails = (agentService as unknown as { runQueueTails: Map<string, unknown> })
      .runQueueTails
    expect(tails.has('test-queue-tail-cleanup')).toBe(false)
    cleanup()
  })
})
