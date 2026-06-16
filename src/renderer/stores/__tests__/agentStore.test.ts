// =============================================================
// agentStore status listener 测试
// 验证双重订阅修复后的不变量：
//   1. initStatusListener 是 IPC_AGENT_STATUS_UPDATE 的唯一主订阅入口
//   2. 多次调用 initStatusListener 不会创建多个 IPC 监听器
//   3. 每个 IPC 事件正确更新 store 内部状态（agents[].status 等）
//   4. subscribeStatus 注册的派生订阅者同步收到每个事件
//   5. 多个派生订阅者互不干扰，unsubscribe 正确
//   6. 同一事件不会被主流程处理两次（不变量）
// =============================================================

import type { AgentListItem } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAgentStore } from '../agentStore'

// v0.2.0 起渲染端统一通过 getAPI() 访问后端, 不再有 window.api 后备。
// 这里用 vi.hoisted 提前准备桩实例, 让下面的 vi.mock factory 引用,
// 避免动态 vi.mock 替换不了已加载模块的问题。
const ipcRef = vi.hoisted(() => {
  const activeListeners = new Set<(data: unknown) => void>()
  return {
    activeListeners,
    getMockOnStatusUpdate:
      () =>
      (cb: (data: unknown) => void): (() => void) => {
        activeListeners.add(cb)
        return () => {
          activeListeners.delete(cb)
        }
      },
  }
})

// 注意: vi.mock 路径相对本测试文件解析。本文件在 stores/__tests__/, 比被测
// 模块 stores/agentStore.ts 多一层目录, 因此 ipc-client 的路径是 ../../lib
// (不是 agentStore.ts 内部的 ../lib)。路径写错时 mock 静默不生效, store
// 会落到真实 getAPI(), 触发 window.__TAURI_INTERNALS__ 缺失错误。
vi.mock('../../lib/ipc-client', () => ({
  getAPI: () => {
    // 重新指向最新 ipcRef (每个 beforeEach 会替换 activeListeners)
    const mockOn = ipcRef.getMockOnStatusUpdate()
    return {
      agent: {
        onStatusUpdate: mockOn,
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        toggle: vi.fn().mockResolvedValue({ success: true }),
        update: vi.fn().mockResolvedValue({ success: true }),
        getSoul: vi.fn().mockResolvedValue(''),
        setSoul: vi.fn().mockResolvedValue({ success: true }),
        getRules: vi.fn().mockResolvedValue(''),
        setRules: vi.fn().mockResolvedValue({ success: true }),
        runManual: vi.fn().mockResolvedValue({ success: true }),
        getHistory: vi.fn().mockResolvedValue([]),
        abort: vi.fn().mockResolvedValue({ success: true }),
      },
      settings: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue({ success: true }),
        reset: vi.fn().mockResolvedValue({ success: true }),
      },
      chat: {
        saveMessage: vi.fn().mockResolvedValue({ success: true, id: 1 }),
        loadMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
        deleteSession: vi.fn().mockResolvedValue({ success: true }),
        listSessions: vi.fn().mockResolvedValue({ success: true, sessions: [] }),
      },
      sys: {
        openDialog: vi.fn().mockResolvedValue({ canceled: true }),
      },
    }
  },
}))

// --- 桩：构造一个最小的 AgentListItem ---
function makeAgent(overrides: Partial<AgentListItem> = {}): AgentListItem {
  return {
    id: 'a1',
    name: 'A1',
    role: 'tester',
    description: 'unit test agent',
    enabled: true,
    modelTier: 'low_cost',
    schedule: [],
    capabilities: [],
    status: 'idle',
    ...overrides,
  }
}

describe('agentStore status listener (fix double-subscription invariant)', () => {
  beforeEach(() => {
    // 重置桩状态,确保每个 test 独立
    ipcRef.activeListeners.clear()

    // 重置 store 状态,避免上一次测试残留
    useAgentStore.setState({
      agents: [],
      liveOutput: '',
      liveToolCalls: [],
      isRunning: false,
      lastExecution: null,
      lastError: null,
      selectedAgentId: null,
      selectedDetail: null,
      detailLoading: false,
      _unsubscribeStatus: null,
    })
    // 清空派生订阅者集合
    useAgentStore.getState()._statusListeners.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ---- 1) 主订阅入口幂等性 ----
  it('initStatusListener 多次调用只保留一个活跃 IPC 监听器', () => {
    const store = useAgentStore.getState()
    store.initStatusListener()
    store.initStatusListener()
    store.initStatusListener()

    // 不变量:无论调用多少次,IPC 层只有 1 个活跃 listener
    expect(ipcRef.activeListeners.size).toBe(1)
  })

  // ---- 2) IPC 事件触发后 store 状态正确更新 ----
  it('IPC 事件到达后 agents[].status 字段被正确更新', () => {
    const store = useAgentStore.getState()
    store.initStatusListener()
    useAgentStore.setState({
      agents: [
        makeAgent({ id: 'a1', name: 'A1', status: 'idle' }),
        makeAgent({ id: 'a2', name: 'A2', status: 'idle' }),
      ],
    })

    // 模拟主进程向 a1 推送 running 状态
    const [listener] = [...ipcRef.activeListeners]
    listener({ agentId: 'a1', status: 'running' })

    const after = useAgentStore.getState()
    expect(after.agents.find((a) => a.id === 'a1')?.status).toBe('running')
    // 不变量:其他 agent 不被影响
    expect(after.agents.find((a) => a.id === 'a2')?.status).toBe('idle')
  })

  // ---- 3) 同一个事件不会被 store 重复处理（不变量） ----
  it('同一事件只更新一次 agents[].status(主流程处理 1 次,不是 2 次)', () => {
    const store = useAgentStore.getState()
    store.initStatusListener()
    useAgentStore.setState({
      selectedAgentId: 'a1',
      agents: [makeAgent({ id: 'a1', status: 'idle' })],
    })

    const [listener] = [...ipcRef.activeListeners]
    listener({ agentId: 'a1', status: 'running' })

    // 不变量:status 被设为 'running'(不是被覆盖成 'idle' 之类的中间态)
    const after = useAgentStore.getState()
    expect(after.agents[0].status).toBe('running')

    // 不变量:isRunning 应该是 true(running 状态后)
    expect(after.isRunning).toBe(true)
  })

  // ---- 4) subscribeStatus 派生订阅者收到每个事件(无丢失) ----
  it('subscribeStatus 注册的回调在每个 IPC 事件触发时同步收到(流式事件不丢)', () => {
    const store = useAgentStore.getState()
    store.initStatusListener()

    const received: unknown[] = []
    const unsub = store.subscribeStatus((data) => received.push(data))

    const [listener] = [...ipcRef.activeListeners]
    // 模拟流式场景:3 个事件在 React 渲染前全部到达
    listener({ agentId: 'a1', status: 'running', output: 'hello' })
    listener({ agentId: 'a1', status: 'running', output: ' world' })
    listener({ agentId: 'a1', status: 'idle' })

    // 不变量:派生订阅者收到全部 3 个事件(不是 1 个合并后的)
    expect(received).toEqual([
      { agentId: 'a1', status: 'running', output: 'hello' },
      { agentId: 'a1', status: 'running', output: ' world' },
      { agentId: 'a1', status: 'idle' },
    ])

    unsub()
    listener({ agentId: 'a1', status: 'running', output: 'discarded' })
    // 取消订阅后不再收到
    expect(received.length).toBe(3)
  })

  // ---- 5) 多个派生订阅者互不干扰 ----
  it('多个 subscribeStatus 订阅者同时存在时,每个都收到事件', () => {
    const store = useAgentStore.getState()
    store.initStatusListener()

    const recv1: unknown[] = []
    const recv2: unknown[] = []
    const u1 = store.subscribeStatus((d) => recv1.push(d))
    const u2 = store.subscribeStatus((d) => recv2.push(d))

    const [listener] = [...ipcRef.activeListeners]
    listener({ agentId: 'a1', status: 'running' })

    expect(recv1.length).toBe(1)
    expect(recv2.length).toBe(1)

    u1()
    listener({ agentId: 'a1', status: 'idle' })

    // 第一个被取消后,只有第二个继续收到
    expect(recv1.length).toBe(1)
    expect(recv2.length).toBe(2)
    u2()
  })

  // ---- 6) 订阅者抛错不影响主流程 ----
  it('subscribeStatus 回调抛错被捕获,不影响其他订阅者和 store 更新', () => {
    const store = useAgentStore.getState()
    store.initStatusListener()
    useAgentStore.setState({
      agents: [makeAgent({ id: 'a1', status: 'idle' })],
    })

    const recv: unknown[] = []
    // 第一个订阅者故意抛错
    const uBad = store.subscribeStatus(() => {
      throw new Error('subscriber-boom')
    })
    const uGood = store.subscribeStatus((d) => recv.push(d))

    const [listener] = [...ipcRef.activeListeners]
    listener({ agentId: 'a1', status: 'running' })

    // 不变量:store 仍然正常更新
    expect(useAgentStore.getState().agents[0].status).toBe('running')
    // 不变量:后续订阅者也收到事件
    expect(recv.length).toBe(1)
    uBad()
    uGood()
  })

  // ---- 7) 派生订阅者集合内部一致性:unsub 不应留下残影 ----
  it('unsub 之后 _statusListeners 集合被替换为新 Set(避免迭代中变更)', () => {
    const store = useAgentStore.getState()
    store.initStatusListener()
    expect(store._statusListeners.size).toBe(0)

    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const u1 = store.subscribeStatus(cb1)
    store.subscribeStatus(cb2)
    expect(useAgentStore.getState()._statusListeners.size).toBe(2)

    u1()
    expect(useAgentStore.getState()._statusListeners.size).toBe(1)
    // 不变量:剩下的订阅者仍然是 cb2
    const remaining = useAgentStore.getState()._statusListeners
    expect(remaining.has(cb1)).toBe(false)
    expect(remaining.has(cb2)).toBe(true)
  })
})
