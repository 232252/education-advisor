// =============================================================
// M0: Agent 运行来源(source)隔离 — abort 误杀修复回归测试
// 场景(2026-09-12 装机实测 P0): 飞书 bot 与 UI 聊天共用 main agent,
// UI 切换会话时 switchSession 无差别 abort,把飞书触发的运行杀成半截话。
// 本文件锚定三件事:
//   1. source='channel' 的在途运行不受 UI abortAgent 影响
//   2. source='ui' 的运行 abort 后执行记录记 aborted(不再伪装 success)
//   3. 状态事件负载自动携带 source(status-tracking 登记表)
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { makeFakeWindow } from './helpers/electron-ipc'
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
    agentTimeoutMins: 5,
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))

// Agent mock: prompt 由测试外部控制 resolve 时机(模拟长任务中途被 abort)
const agentMockState = {
  waitForIdleImpl: (): Promise<void> => Promise.resolve(),
  promptImpl: (): Promise<void> => Promise.resolve(),
}

// DSH 替身 mock（替代已移除的 pi-agent-core）
vi.mock('../../src/main/services/dsh/agent-facade', () => ({
  createDshAgent: () => ({
    state: { tools: [], messages: [] },
    subscribe: () => mocks.unsubscribeFn,
    prompt: () => agentMockState.promptImpl(),
    waitForIdle: () => agentMockState.waitForIdleImpl(),
    abort: async () => { mocks.abortCallCount++ },
  }),
}))
vi.mock('../../src/main/services/dsh/tool-bridge', () => ({
  ensureActiveEaaToolBridge: async () => ({ port: 1, patchDir: '', close: async () => {} }),
  mountEaaAgentTools: async (opts) => ({
    serverName: 'eaa-test',
    patchPath: '/tmp/test.patch.yml',
    toolNameMap: {},
    endpoint: { url: 'http://127.0.0.1:1/mcp/x', token: 't', toolCount: 0 },
    release: async () => {},
  }),
}))
vi.mock('../../src/main/services/dsh/runtime', () => ({
  getDshRuntimeCwd: () => mocks.userDataDir,
  createDshRuntime: () => ({
    turnEvents: async function* () {
      yield { type: 'assistant/message', data: { turn: 1, step: 1, stream: [{ type: 'text-chunks', texts: ['ok'] }], usage: { inputTokens: 3, outputTokens: 1 } } }
      yield { type: 'turn/end', data: { turn: 1, reason: 'completed' } }
    },
    dispose: async () => {},
  }),
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
  getModels: vi.fn(() => []),
  getProviders: vi.fn(() => ['test-provider']),
}))

vi.mock('./cron-service', () => ({
  cronService: {
    setAgentRunner: vi.fn(),
    syncAgentSchedules: vi.fn(() => new Map()),
    getNextRunAt: vi.fn(() => undefined),
  },
}))
vi.mock('../../src/main/services/db-service', () => ({
  dbService: {
    recordExecutionStart: vi.fn(() => 1),
    updateExecution: vi.fn(() => true),
  },
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      models: {
        defaultProvider: 'test-provider',
        defaultModel: 'test-model',
        customModels: {},
        // 本文件断言的是 pi 运行时的 Agent/abort 行为（agentRuntime 缺省现已是 dsh）；dsh 见 src/main/services/dsh/__tests__
        agentRuntime: 'dsh',
      },
      general: { agentTimeoutMins: mocks.agentTimeoutMins },
      chat: {
        thinkingLevel: 'medium',
        steeringMode: 'all',
        followUpMode: 'all',
        showImages: true,
        compaction: { enabled: false, reserveTokens: 8000, keepRecentTokens: 16000 },
      },
    })),
  },
}))

import { agentService } from '../../src/main/services/agent-service'
import { agentEvents } from '../../src/main/services/agent/agent-events'
import type { AgentStatusPayload } from '@shared/types'

const tmpRoot = path.join(
  os.tmpdir(),
  `agent-source-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

/** 注入测试 agent 配置(复用 finally-abort 测试的注入方式) */
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

/** 轮询等待某 agent 进入 runningAgents(执行真正开始) */
async function waitRunning(id: string, timeoutMs = 5000): Promise<void> {
  const map = (agentService as unknown as { runningAgents: Map<string, unknown> }).runningAgents
  const deadline = Date.now() + timeoutMs
  while (!map.has(id)) {
    if (Date.now() > deadline) throw new Error(`agent ${id} not running within ${timeoutMs}ms`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** 收集指定 agent 的进程内状态事件(返回 {payloads, stop}) */
function collectEvents(agentId: string): { payloads: AgentStatusPayload[]; stop: () => void } {
  const payloads: AgentStatusPayload[] = []
  const listener = (p: AgentStatusPayload) => {
    if (p.agentId === agentId) payloads.push(p)
  }
  agentEvents.on('status', listener)
  return { payloads, stop: () => agentEvents.off('status', listener) }
}

/** 可控 prompt:第一次调用挂起(测试中途 resolve 模拟长任务),续跑等后续调用立即 resolve */
function holdablePrompt(): { release: () => void } {
  let release!: () => void
  let firstServed = false
  agentMockState.promptImpl = () => {
    if (firstServed) return Promise.resolve()
    firstServed = true
    return new Promise<void>((res) => (release = res))
  }
  return { release: () => release() }
}

describe('M0: abort 来源隔离', () => {
  it("source='channel' 的在途运行不受 UI abortAgent 影响,照常跑完记 success", async () => {
    mocks.abortCallCount = 0
    const id = 'test-channel-guard'
    const cleanup = injectTestAgent(id)
    const fakeWin = makeFakeWindow()
    const events = collectEvents(id)

    const prompt = holdablePrompt()
    agentMockState.waitForIdleImpl = () => Promise.resolve()

    const runPromise = agentService.runAgent(id, '飞书指令', fakeWin as never, undefined, 'channel')
    await waitRunning(id)

    // UI 侧 abort(无 force):不得中止 channel 运行
    const aborted = await agentService.abortAgent(id)
    expect(aborted).toBe(false)
    expect(mocks.abortCallCount).toBe(0)

    // 运行照常完成
    prompt.release()
    const exec = await runPromise
    expect(exec?.status).toBe('success')

    // 状态事件负载带 source='channel'(渲染层据此过滤,不写入聊天会话)
    expect(events.payloads.filter((p) => p.source === 'channel').length).toBeGreaterThan(0)
    events.stop()
    cleanup()
  })

  it("source='ui' 的运行 abort 后执行记录记 aborted(不再伪装 success),DB 同步 aborted", async () => {
    mocks.abortCallCount = 0
    const id = 'test-ui-abort'
    const cleanup = injectTestAgent(id)
    const fakeWin = makeFakeWindow()

    const prompt = holdablePrompt()
    agentMockState.waitForIdleImpl = () => Promise.resolve()

    const runPromise = agentService.runAgent(id, '界面指令', fakeWin as never)
    await waitRunning(id)

    const aborted = await agentService.abortAgent(id)
    expect(aborted).toBe(true)
    expect(mocks.abortCallCount).toBeGreaterThanOrEqual(1)

    // pi-agent-core 语义: abort 后 prompt() 正常 resolve(走到成功路径)
    prompt.release()
    const exec = await runPromise
    expect(exec?.status).toBe('aborted')

    const { dbService } = await import('../../src/main/services/db-service')
    const updateExecutionMock = dbService.updateExecution as unknown as ReturnType<typeof vi.fn>
    const dbCall = updateExecutionMock.mock.calls.at(-1)?.[1] as { status?: string }
    expect(dbCall?.status).toBe('aborted')

    cleanup()
  })

  it("force=true 可中止 channel 运行(shutdown 场景)", async () => {
    mocks.abortCallCount = 0
    const id = 'test-force-abort'
    const cleanup = injectTestAgent(id)
    const fakeWin = makeFakeWindow()

    const prompt = holdablePrompt()
    agentMockState.waitForIdleImpl = () => Promise.resolve()

    const runPromise = agentService.runAgent(id, '飞书指令', fakeWin as never, undefined, 'channel')
    await waitRunning(id)

    const aborted = await agentService.abortAgent(id, undefined, { force: true })
    expect(aborted).toBe(true)
    expect(mocks.abortCallCount).toBeGreaterThanOrEqual(1)

    prompt.release()
    const exec = await runPromise
    expect(exec?.status).toBe('aborted')
    cleanup()
  })
})
