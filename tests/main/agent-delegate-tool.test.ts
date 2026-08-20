// =============================================================
// M32: delegate_to 轻量路由工具测试
// 覆盖: (a) 工具 schema 校验
//       (b) 正常委托: runQueue 桥接被调用、结果作为 tool_result 回传
//       (c) 目标 agent 不存在时的错误返回
//       (d) 递归/自委托拦截(防递归风暴)
//       (e) 超时/错误/取消状态的回传
//       (f) abort 传播: main 被中止时取消委托任务
//       (g) 注入门控: delegate_to 只注入 main
//       (h) agentService 集成: main → academic 全链路(真实 runQueue + 状态推送)
// mock 模式参考 tests/main/agent-service-finally-abort.test.ts
// =============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Check } from 'typebox/value'
import type { AgentExecution } from '../../src/shared/types'
import type { DelegateToolDeps } from '../../src/main/services/agent/delegate-tool'

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
  }
})

vi.mock('electron', () => ({ app: { getPath: mocks.getPath, isPackaged: false } }))

// Agent mock: 按 state.tools 中是否含 delegate_to 区分 main/专家两种运行行为。
// main → 执行一次委托并把工具结果汇入输出;专家 → 输出分析结论(≥200 字符避免触发续跑)。
const agentMock = {
  mainPrompts: [] as string[],
  specialistPrompts: [] as string[],
  delegateResults: [] as string[],
}

vi.mock('@earendil-works/pi-agent-core', () => ({
  Agent: class {
    state = { messages: [], tools: [], systemPrompt: '', model: {}, thinkingLevel: 'medium' }
    private subscribers: Array<(e: unknown) => void> = []
    subscribe(fn: (e: unknown) => void) {
      this.subscribers.push(fn)
      return () => {}
    }
    private emit(text: string) {
      for (const fn of this.subscribers) {
        fn({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
      }
    }
    async prompt(text?: unknown) {
      const promptText = typeof text === 'string' ? text : ''
      const delegateTool = (
        this.state.tools as Array<{
          name: string
          execute: (
            id: string,
            p: { target_agent_id: string; task: string },
          ) => Promise<{ content: Array<{ type: string; text?: string }> }>
        }>
      ).find((t) => t.name === 'delegate_to')
      if (delegateTool) {
        // main 运行: 调 delegate_to 委托 academic,再汇总输出
        agentMock.mainPrompts.push(promptText)
        const result = await delegateTool.execute('call-delegate', {
          target_agent_id: 'academic',
          task: '分析张三近三次数学成绩趋势',
        })
        const first = result.content[0]
        agentMock.delegateResults.push(first?.type === 'text' ? (first.text ?? '') : '')
        this.emit(`[main 汇总] 已结合专家结论回复教师。${'详'.repeat(220)}`)
      } else {
        // 专家运行(academic): 输出分析结论
        agentMock.specialistPrompts.push(promptText)
        this.emit(`academic 分析结论: 张三数学成绩呈上升趋势。${'详'.repeat(220)}`)
      }
    }
    waitForIdle() {
      return Promise.resolve()
    }
    async abort() {
      /* no-op */
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

vi.mock('../../src/main/services/cron-service', () => ({
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
vi.mock('../../src/main/services/eaa-tools', () => ({ getToolsByCapability: vi.fn(() => []) }))
vi.mock('../../src/main/services/file-tools', () => ({ allFileTools: [] }))
vi.mock('../../src/main/services/keystore-service', () => ({
  keystoreService: {
    getApiKey: vi.fn(() => 'test-key'),
    getSecret: vi.fn(() => ''),
  },
}))
vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: {
    getSettings: vi.fn(() => ({
      models: {
        defaultProvider: 'test-provider',
        defaultModel: 'test-model',
        customModels: {},
      },
      general: { agentTimeoutMins: 5 },
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
vi.mock('../../src/main/services/skill-service', () => ({
  skillService: { listSkills: vi.fn(() => []) },
}))
vi.mock('../../src/main/services/utility-tools', () => ({ allUtilityTools: [] }))
vi.mock('../../src/main/services/mcp-management/tools/aggregate', () => ({
  getMcpToolsForAgent: vi.fn(async () => []),
}))

import { agentService } from '../../src/main/services/agent-service'
import { createDelegateToTool } from '../../src/main/services/agent/delegate-tool'
import { buildAgentTools } from '../../src/main/services/agent/tools'

const tmpRoot = path.join(
  os.tmpdir(),
  `agent-delegate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

// =============================================================
// 测试辅助
// =============================================================

const fakeWin = {
  isDestroyed: () => false,
  webContents: { send: vi.fn() },
}

function fakeExecution(
  status: AgentExecution['status'],
  output = '张三数学成绩呈上升趋势',
): AgentExecution {
  return {
    id: `exec_${Date.now()}`,
    agentId: 'academic',
    prompt: '分析张三近三次数学成绩趋势',
    output,
    startedAt: Date.now(),
    durationMs: 1200,
    tokenUsage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    cost: 0,
    status,
  }
}

/** 构造 mock 桥接依赖(代表 agentService 注入的 runQueue 桥接) */
function makeDeps(overrides: Partial<DelegateToolDeps> = {}): DelegateToolDeps {
  return {
    validateTarget: () => null,
    isDelegationInProgress: () => false,
    runDelegatedTask: vi.fn(async () => fakeExecution('success')),
    abortDelegatedAgent: vi.fn(async () => true),
    ...overrides,
  }
}

/** 提取 tool_result 的文本内容 */
function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0]
  return first?.type === 'text' ? (first.text ?? '') : ''
}

const DELEGATE_PARAMS = { target_agent_id: 'academic', task: '分析张三近三次数学成绩趋势' }

// =============================================================
// (a) 工具 schema 校验
// =============================================================

describe('M32: delegate_to 工具 schema', () => {
  const tool = createDelegateToTool(makeDeps(), { sourceAgentId: 'main' })

  it('工具元数据完整(name/label/description/execute)', () => {
    expect(tool.name).toBe('delegate_to')
    expect(tool.label).toBe('委托专家 Agent')
    expect(tool.description.length).toBeGreaterThan(10)
    expect(typeof tool.execute).toBe('function')
  })

  it('schema: target_agent_id 与 task 均为必填 string', () => {
    const schema = tool.parameters as unknown as {
      properties: Record<string, { type: string }>
      required: string[]
    }
    expect(schema.properties.target_agent_id.type).toBe('string')
    expect(schema.properties.task.type).toBe('string')
    expect(schema.required).toEqual(expect.arrayContaining(['target_agent_id', 'task']))
  })

  it('schema 校验: 合法参数通过,缺字段/错类型被拒绝', () => {
    expect(Check(tool.parameters, DELEGATE_PARAMS)).toBe(true)
    expect(Check(tool.parameters, { target_agent_id: 'academic' })).toBe(false)
    expect(Check(tool.parameters, { task: 'x' })).toBe(false)
    expect(Check(tool.parameters, { target_agent_id: 123, task: 'x' })).toBe(false)
    expect(Check(tool.parameters, {})).toBe(false)
  })
})

// =============================================================
// (b) 正常委托 + (c) 目标不存在 + (d) 递归拦截 + (e) 状态回传
// =============================================================

describe('M32: delegate_to 执行语义', () => {
  it('(b) 正常委托: 桥接以目标与任务调用,结果文本作为 tool_result 回传', async () => {
    const runDelegatedTask = vi.fn(async () => fakeExecution('success', '张三数学成绩呈上升趋势'))
    const deps = makeDeps({ runDelegatedTask })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', DELEGATE_PARAMS)

    expect(runDelegatedTask).toHaveBeenCalledTimes(1)
    expect(runDelegatedTask).toHaveBeenCalledWith('academic', '分析张三近三次数学成绩趋势', undefined)
    const text = textOf(result)
    expect(text).toContain('academic')
    expect(text).toContain('张三数学成绩呈上升趋势')
  })

  it('(b) win 透传: 桥接收到 context 捕获的窗口(状态推送复用)', async () => {
    const runDelegatedTask = vi.fn(async () => fakeExecution('success'))
    const deps = makeDeps({ runDelegatedTask })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main', win: fakeWin as never })

    await tool.execute('call-1', DELEGATE_PARAMS)
    expect(runDelegatedTask).toHaveBeenCalledWith('academic', '分析张三近三次数学成绩趋势', fakeWin)
  })

  it('(c) 目标 agent 不存在: 返回错误文本,不发起委托', async () => {
    const runDelegatedTask = vi.fn(async () => fakeExecution('success'))
    const deps = makeDeps({
      validateTarget: () => '目标 Agent 不存在: ghost',
      runDelegatedTask,
    })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', { target_agent_id: 'ghost', task: 'x' })

    expect(textOf(result)).toContain('目标 Agent 不存在: ghost')
    expect(runDelegatedTask).not.toHaveBeenCalled()
  })

  it('(d) 自委托拦截: 目标为 main 自身时拒绝(串行队列循环等待会死锁)', async () => {
    const runDelegatedTask = vi.fn(async () => fakeExecution('success'))
    const deps = makeDeps({ runDelegatedTask })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', { target_agent_id: 'main', task: '自己分析' })

    expect(textOf(result)).toContain('拒绝')
    expect(textOf(result)).toContain('循环等待')
    expect(runDelegatedTask).not.toHaveBeenCalled()
  })

  it('(d) 嵌套委托拦截: 已有委托在途时拒绝', async () => {
    const runDelegatedTask = vi.fn(async () => fakeExecution('success'))
    const deps = makeDeps({ isDelegationInProgress: () => true, runDelegatedTask })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', DELEGATE_PARAMS)

    expect(textOf(result)).toContain('拒绝')
    expect(textOf(result)).toContain('委托任务在执行中')
    expect(runDelegatedTask).not.toHaveBeenCalled()
  })

  it('(e) 目标超时: timeout 状态的执行记录以超时文本回传', async () => {
    const deps = makeDeps({
      runDelegatedTask: vi.fn(
        async () => fakeExecution('timeout', 'Agent waitForIdle(academic) timed out after 300000ms'),
      ),
    })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', DELEGATE_PARAMS)

    expect(textOf(result)).toContain('执行超时')
    expect(textOf(result)).toContain('timed out')
  })

  it('(e) 目标失败: error 状态的执行记录以失败文本回传', async () => {
    const deps = makeDeps({
      runDelegatedTask: vi.fn(async () => fakeExecution('error', '[LLM 错误] 429')),
    })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', DELEGATE_PARAMS)

    expect(textOf(result)).toContain('执行失败')
    expect(textOf(result)).toContain('429')
  })

  it('(e) 委托被放弃(undefined): 返回取消说明', async () => {
    const deps = makeDeps({ runDelegatedTask: vi.fn(async () => undefined) })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', DELEGATE_PARAMS)

    expect(textOf(result)).toContain('被取消')
  })

  it('(e) 桥接抛错(如目标排队已满): 错误作为 tool_result 返回而非抛出', async () => {
    const deps = makeDeps({
      runDelegatedTask: vi.fn(async () => {
        throw new Error('Agent 正忙且排队已满,请稍后重试: academic')
      }),
    })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', DELEGATE_PARAMS)

    expect(textOf(result)).toContain('委托 academic 失败')
    expect(textOf(result)).toContain('排队已满')
  })
})

// =============================================================
// (f) abort 传播
// =============================================================

describe('M32: delegate_to abort 传播', () => {
  it('main 被 abort(signal 触发): 取消委托任务并立即返回取消说明', async () => {
    const controller = new AbortController()
    let settleRun: (v: AgentExecution | undefined) => void = () => {}
    const runDelegatedTask = vi.fn(
      () =>
        new Promise<AgentExecution | undefined>((resolve) => {
          settleRun = resolve
        }),
    )
    const abortDelegatedAgent = vi.fn(async () => true)
    const deps = makeDeps({ runDelegatedTask, abortDelegatedAgent })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main', win: fakeWin as never })

    const resultPromise = tool.execute('call-1', DELEGATE_PARAMS, controller.signal)
    await new Promise((r) => setTimeout(r, 10))

    controller.abort() // main 的运行被中止
    const result = await resultPromise

    expect(abortDelegatedAgent).toHaveBeenCalledWith('academic', fakeWin)
    expect(textOf(result)).toContain('被取消')
    // 悬挂的委托 promise 之后 settle 不影响工具已返回
    settleRun(undefined)
    await new Promise((r) => setTimeout(r, 10))
  })

  it('signal 已中止时进入工具: 直接取消委托并返回,不发起等待', async () => {
    const controller = new AbortController()
    controller.abort()
    const runDelegatedTask = vi.fn(async () => fakeExecution('success'))
    const abortDelegatedAgent = vi.fn(async () => true)
    const deps = makeDeps({ runDelegatedTask, abortDelegatedAgent })
    const tool = createDelegateToTool(deps, { sourceAgentId: 'main' })

    const result = await tool.execute('call-1', DELEGATE_PARAMS, controller.signal)

    expect(abortDelegatedAgent).toHaveBeenCalledWith('academic', undefined)
    expect(textOf(result)).toContain('被取消')
  })
})

// =============================================================
// (g) 注入门控: delegate_to 只注入 main
// =============================================================

describe('M32: buildAgentTools 注入门控', () => {
  const baseConfig = {
    name: 'Test',
    role: 'test',
    description: 'test',
    enabled: true,
    modelTier: 'low_cost',
    schedule: [],
    capabilities: [],
    riskThresholds: undefined,
  }

  it('main + 委托桥接: 工具集包含 delegate_to', async () => {
    const tools = await buildAgentTools(
      baseConfig as never,
      'main',
      fakeWin as never,
      makeDeps(),
    )
    expect(tools.map((t) => t.name)).toContain('delegate_to')
  })

  it('其他角色(如 academic)即使提供桥接也不注入 delegate_to', async () => {
    const tools = await buildAgentTools(
      baseConfig as never,
      'academic',
      fakeWin as never,
      makeDeps(),
    )
    expect(tools.map((t) => t.name)).not.toContain('delegate_to')
  })

  it('main 未提供桥接(旧行为): 不注入 delegate_to', async () => {
    const tools = await buildAgentTools(baseConfig as never, 'main')
    expect(tools.map((t) => t.name)).not.toContain('delegate_to')
  })
})

// =============================================================
// (h) agentService 集成: main → academic 全链路(真实 runQueue)
// =============================================================

describe('M32: agentService 委托集成(main → academic)', () => {
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

  it('main 委托 academic: 任务经真实 runQueue 到达 academic,结果回传 main 汇总', async () => {
    const cleanupMain = injectTestAgent('main')
    const cleanupAcademic = injectTestAgent('academic')
    agentMock.mainPrompts = []
    agentMock.specialistPrompts = []
    agentMock.delegateResults = []
    vi.mocked(fakeWin.webContents.send).mockClear()

    const exec = await agentService.runAgent(
      'main',
      '帮我让学业分析师看看张三的成绩趋势',
      fakeWin as never,
    )

    // main 收到用户消息
    expect(agentMock.mainPrompts).toEqual(['帮我让学业分析师看看张三的成绩趋势'])
    // 委托任务经真实 runQueue 到达 academic(executeAgentRun 完整跑通)
    expect(agentMock.specialistPrompts).toEqual(['分析张三近三次数学成绩趋势'])
    // 工具结果包含 academic 的执行输出(结果回传)
    expect(agentMock.delegateResults).toHaveLength(1)
    expect(agentMock.delegateResults[0]).toContain('academic 分析结论: 张三数学成绩呈上升趋势')
    // main 的最终输出为汇总文本,状态成功
    expect(exec?.status).toBe('success')
    expect(exec?.output).toContain('[main 汇总]')
    // 委托完成后在途计数归零(下一次委托不被误拒)
    const activeDelegations = (
      agentService as unknown as { activeDelegations: number }
    ).activeDelegations
    expect(activeDelegations).toBe(0)
    // 委托运行复用状态推送: academic 的 running 状态已发往渲染进程
    const sendCalls = vi.mocked(fakeWin.webContents.send).mock.calls as unknown as Array<
      [string, { agentId?: string; status?: string }]
    >
    expect(
      sendCalls.some(([, payload]) => payload?.agentId === 'academic' && payload?.status === 'running'),
    ).toBe(true)

    cleanupMain()
    cleanupAcademic()
  })

  it('main 运行中委托 academic: 同一时刻第二次委托被在途计数拒绝(防递归风暴)', async () => {
    // 直接验证 agentService 桥接的计数语义: 模拟一次在途委托期间调用工具
    const cleanupMain = injectTestAgent('main')
    const cleanupAcademic = injectTestAgent('academic')

    const bridge = (
      agentService as unknown as { delegateBridge: DelegateToolDeps }
    ).delegateBridge
    // 场景: academic 自己若发起委托(假设其获得工具),在途计数应拦截
    const runAgentSpy = vi
      .spyOn(agentService, 'runAgent' as never)
      .mockResolvedValue(undefined as never)
    try {
      const duringResult = await bridge.runDelegatedTask(
        'academic',
        '第一层委托任务',
        undefined,
      )
      expect(duringResult).toBeUndefined()
      // 在途期间,工具层检查应返回 true(嵌套委托被拒)
      expect(bridge.isDelegationInProgress()).toBe(false) // runDelegatedTask 已返回,计数归零
    } finally {
      runAgentSpy.mockRestore()
    }

    // 在途计数在 runDelegatedTask 执行期间确实 > 0: 用慢 resolve 验证
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((r) => {
      releaseGate = r
    })
    const slowSpy = vi
      .spyOn(agentService, 'runAgent' as never)
      .mockImplementation((() => gate.then(() => undefined)) as never)
    let inFlightSeen = false
    const pending = bridge.runDelegatedTask('academic', '慢任务', undefined).then((v) => {
      expect(v).toBeUndefined()
      return v
    })
    // 等待同步计数自增被观察到
    await new Promise((r) => setTimeout(r, 10))
    inFlightSeen = bridge.isDelegationInProgress()
    releaseGate()
    await pending
    expect(inFlightSeen).toBe(true)
    expect(bridge.isDelegationInProgress()).toBe(false)
    slowSpy.mockRestore()

    cleanupMain()
    cleanupAcademic()
  })
})
