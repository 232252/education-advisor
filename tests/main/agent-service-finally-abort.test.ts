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
