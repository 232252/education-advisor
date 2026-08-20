// =============================================================
// Agent Service — finally 块 abort controller 回归测试
// 修复: finally 块中调用 abortController.abort(),确保 agent
// 异常退出(如 waitForIdle 超时)后不再继续消耗 API token
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
    abortCallCount: 0,
    unsubscribeFn: vi.fn(),
    // M15: 可注入的 agent 超时(分钟),execution.ts 每次运行时读取
    agentTimeoutMins: 5,
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))

// Agent mock: waitForIdle/prompt 可动态修改
const agentMockState = {
  waitForIdleImpl: (): Promise<void> => Promise.resolve(),
  promptImpl: (): Promise<void> => Promise.resolve(),
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
    async prompt() {
      return agentMockState.promptImpl()
    }
    waitForIdle() {
      return agentMockState.waitForIdleImpl()
    }
    async abort() {
      mocks.abortCallCount++
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
// 注意: mock 路径必须是测试文件到真实模块的相对路径。
// 此前写成 './db-service'(测试文件同级,不存在)——vitest 静默不拦截,
// 实际加载的是真实 db-service(M15 测试断言落库状态时才发现)。
vi.mock('../../src/main/services/db-service', () => ({
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
// 同上: mock 路径修正为到真实模块的相对路径(M15 需注入 agentTimeoutMins)
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      models: {
        defaultProvider: 'test-provider',
        defaultModel: 'test-model',
        customModels: {},
      },
      // M15: execution.ts 读取 general.agentTimeoutMins 作为 waitForIdle 超时
      general: {
        agentTimeoutMins: mocks.agentTimeoutMins,
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
  `agent-finally-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
)
const userDataDir = path.join(tmpRoot, 'userData')

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

describe('AgentService finally 块 abort', () => {
  it('agent.prompt() 抛错时 finally 块应调用 abort', async () => {
    mocks.abortCallCount = 0
    // 设置 prompt 抛错
    agentMockState.promptImpl = () => Promise.reject(new Error('LLM API error'))
    agentMockState.waitForIdleImpl = () => Promise.resolve()

    const cleanup = injectTestAgent('test-prompt-error')
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    }

    // runAgent 不 rethrow(catch 块吞掉错误),所以应正常 resolve
    await agentService.runAgent('test-prompt-error', 'test', fakeWin as never)

    // finally 块应调用了 abort
    expect(mocks.abortCallCount).toBeGreaterThanOrEqual(1)

    // 恢复
    agentMockState.promptImpl = () => Promise.resolve()
    cleanup()
  })

  it('agent 正常完成后 finally 块也应调用 abort', async () => {
    mocks.abortCallCount = 0
    agentMockState.promptImpl = () => Promise.resolve()
    agentMockState.waitForIdleImpl = () => Promise.resolve()

    const cleanup = injectTestAgent('test-normal-complete')
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    }

    await agentService.runAgent('test-normal-complete', 'test', fakeWin as never)

    // 正常完成后 finally 也应调用 abort(idempotent)
    expect(mocks.abortCallCount).toBeGreaterThanOrEqual(1)

    cleanup()
  })

  it('连续运行两次同一 agent,第二次应正常启动', async () => {
    mocks.abortCallCount = 0
    agentMockState.promptImpl = () => Promise.resolve()
    agentMockState.waitForIdleImpl = () => Promise.resolve()

    const cleanup = injectTestAgent('test-double-run')
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    }

    // 第一次运行
    await agentService.runAgent('test-double-run', 'first', fakeWin as never)
    expect(mocks.abortCallCount).toBeGreaterThanOrEqual(1)

    // 第二次运行应正常(finally 已清理 runningAgents)
    mocks.abortCallCount = 0
    await agentService.runAgent('test-double-run', 'second', fakeWin as never)
    expect(mocks.abortCallCount).toBeGreaterThanOrEqual(1)

    cleanup()
  })
})

describe('M15: Agent 超时错标修复 + 可配置', () => {
  it('waitForIdle 超时应落库 status=timeout 而非 error(DB 映射 aborted)', async () => {
    mocks.abortCallCount = 0
    // 注入小超时: 0.001 分钟 = 60ms
    mocks.agentTimeoutMins = 0.001
    agentMockState.promptImpl = () => Promise.resolve()
    // waitForIdle 永不 resolve → 触发 withTimeout 超时
    agentMockState.waitForIdleImpl = () => new Promise<void>(() => {})

    const cleanup = injectTestAgent('test-m15-timeout')
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    }

    // 引入被 mock 的 dbService 断言落库状态
    const { dbService } = await import('../../src/main/services/db-service')
    const updateExecutionMock = dbService.updateExecution as unknown as ReturnType<typeof vi.fn>
    updateExecutionMock.mockClear()

    const exec = await agentService.runAgent('test-m15-timeout', 'test', fakeWin as never)

    // 内存执行记录: timeout(此前被错标为 error)
    expect(exec?.status).toBe('timeout')
    expect(exec?.output).toMatch(/timed out/i)

    // DB 写入: CHECK 约束不含 'timeout',映射为 'aborted'
    expect(updateExecutionMock).toHaveBeenCalledTimes(1)
    const dbCall = updateExecutionMock.mock.calls[0]?.[1] as { status?: string }
    expect(dbCall?.status).toBe('aborted')

    // finally 块仍应 abort(超时后不再消耗 API token)
    expect(mocks.abortCallCount).toBeGreaterThanOrEqual(1)

    // 恢复
    mocks.agentTimeoutMins = 5
    agentMockState.waitForIdleImpl = () => Promise.resolve()
    cleanup()
  }, 15_000)

  it('非超时错误(LLM API error)仍落库 status=error/failure', async () => {
    mocks.abortCallCount = 0
    mocks.agentTimeoutMins = 5
    agentMockState.promptImpl = () => Promise.reject(new Error('LLM API error'))
    agentMockState.waitForIdleImpl = () => Promise.resolve()

    const cleanup = injectTestAgent('test-m15-error')
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send: vi.fn() },
    }

    const { dbService } = await import('../../src/main/services/db-service')
    const updateExecutionMock = dbService.updateExecution as unknown as ReturnType<typeof vi.fn>
    updateExecutionMock.mockClear()

    const exec = await agentService.runAgent('test-m15-error', 'test', fakeWin as never)

    expect(exec?.status).toBe('error')
    const dbCall = updateExecutionMock.mock.calls[0]?.[1] as { status?: string }
    expect(dbCall?.status).toBe('failure')

    agentMockState.promptImpl = () => Promise.resolve()
    cleanup()
  })
})
