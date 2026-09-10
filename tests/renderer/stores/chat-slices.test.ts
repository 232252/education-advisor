// =============================================================
// Chat Store — model/messages slice 分支测试
// 覆盖: setModel 触发信息拉取、fetchModelInfo 空参跳过/匹配/未命中/异常、
//       initFromSettings 三态(完整/空/异常)与 thinkingLevel 恢复、
//       addMessage 仅持久化非 assistant、clearMessages 重置与缓存清理、
//       loadHistory 幂等/运行时校验/空占位过滤/切换丢弃/异常兜底
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSaveMessage = vi.fn().mockResolvedValue({ success: true, id: 1 })
const mockLoadMessages = vi.fn().mockResolvedValue({ success: true, messages: [] })
const mockListModels = vi.fn().mockResolvedValue([])
const mockSettingsGet = vi.fn()

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    chat: {
      saveMessage: mockSaveMessage,
      loadMessages: mockLoadMessages,
      deleteSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue({ success: true, sessions: [] }),
      renameSession: vi.fn(),
    },
    agent: { abort: vi.fn() },
    settings: { get: mockSettingsGet, set: vi.fn() },
    ai: { listModels: mockListModels, setApiKey: vi.fn() },
  }),
}))

vi.mock('../../../src/renderer/stores/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import { flushStreamDeltas } from '../../../src/renderer/stores/chat/delta-batch'
import { pendingAgentOutputs } from '../../../src/renderer/stores/chat/agent-pending'
import { useChatStore } from '../../../src/renderer/stores/chat/store'

const store = () => useChatStore.getState()

beforeEach(() => {
  vi.clearAllMocks()
  flushStreamDeltas()
  pendingAgentOutputs.clear()
  mockSettingsGet.mockResolvedValue({ models: {}, chat: {} })
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    isThinking: false,
    sessionId: 's1',
    historyLoaded: false,
    sessions: [{ id: 's1', title: '一', createdAt: 0, updatedAt: 0 }],
    selectedAgentId: '',
    streamingAgentId: null,
    streamSessionId: null,
    currentModel: '',
    currentProvider: '',
    currentModelContext: 0,
    currentModelMaxOutput: 0,
    thinkingLevel: 'off',
    lastUsage: null,
    lastCost: 0,
  } as never)
})

describe('model-slice', () => {
  it('setModel 更新 provider/model 并异步拉取模型信息', async () => {
    mockListModels.mockResolvedValue([{ id: 'm1', contextWindow: 8192, maxOutputTokens: 2048 }])
    store().setModel('prov1', 'm1')
    expect(store().currentProvider).toBe('prov1')
    expect(store().currentModel).toBe('m1')
    await vi.waitFor(() => expect(mockListModels).toHaveBeenCalledWith('prov1'))
    await vi.waitFor(() => {
      expect(store().currentModelContext).toBe(8192)
      expect(store().currentModelMaxOutput).toBe(2048)
    })
  })

  it('fetchModelInfo 缺 provider/model 时跳过', async () => {
    await store().fetchModelInfo('', 'm1')
    expect(mockListModels).not.toHaveBeenCalled()
  })

  it('fetchModelInfo 未命中模型时仅告警不改状态', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockListModels.mockResolvedValue([{ id: 'other', contextWindow: 99, maxOutputTokens: 9 }])
    try {
      await store().fetchModelInfo('prov1', 'm1')
      expect(warn).toHaveBeenCalled()
      expect(store().currentModelContext).toBe(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('fetchModelInfo 异常被吞(不阻塞调用方)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockListModels.mockRejectedValue(new Error('net down'))
    try {
      await expect(store().fetchModelInfo('prov1', 'm1')).resolves.toBeUndefined()
      expect(store().currentModelContext).toBe(0)
    } finally {
      warn.mockRestore()
    }
  })

  it('initFromSettings: 完整设置恢复模型与 thinkingLevel', async () => {
    mockSettingsGet.mockResolvedValue({
      models: { defaultProvider: 'p', defaultModel: 'm' },
      chat: { thinkingLevel: 'high' },
    })
    mockListModels.mockResolvedValue([{ id: 'm', contextWindow: 4096, maxOutputTokens: 1024 }])
    await store().initFromSettings()
    expect(store().currentProvider).toBe('p')
    expect(store().currentModel).toBe('m')
    expect(store().thinkingLevel).toBe('high')
    await vi.waitFor(() => expect(store().currentModelContext).toBe(4096))
  })

  it('initFromSettings: 空设置不改状态', async () => {
    mockSettingsGet.mockResolvedValue({ models: {}, chat: {} })
    await store().initFromSettings()
    expect(store().currentProvider).toBe('')
    expect(mockListModels).not.toHaveBeenCalled()
  })

  it('initFromSettings: settings 读取异常被捕获', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockSettingsGet.mockRejectedValue(new Error('boom'))
    try {
      await expect(store().initFromSettings()).resolves.toBeUndefined()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('messages-slice', () => {
  it('addMessage: user 消息立即持久化,assistant 不持久化', () => {
    store().addMessage({ role: 'user', content: '问', timestamp: 1 })
    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', role: 'user', content: '问' }),
    )
    store().addMessage({ role: 'assistant', content: '', toolCalls: [], timestamp: 2 })
    expect(mockSaveMessage).toHaveBeenCalledTimes(1)
    expect(store().messages).toHaveLength(2)
  })

  it('clearMessages: 重置消息/用量并清空 pending agent 缓存', () => {
    pendingAgentOutputs.set('ag9', ['残留'])
    useChatStore.setState({ messages: [{ role: 'user', content: 'x', timestamp: 1 }], lastCost: 3 } as never)
    store().clearMessages()
    expect(store().messages).toHaveLength(0)
    expect(store().lastUsage).toBeNull()
    expect(store().lastCost).toBe(0)
    expect(pendingAgentOutputs.size).toBe(0)
  })

  it('loadHistory: 已加载过则直接返回', async () => {
    useChatStore.setState({ historyLoaded: true } as never)
    await store().loadHistory()
    expect(mockLoadMessages).not.toHaveBeenCalled()
  })

  it('loadHistory: 流式进行中跳过,避免 DB 覆盖内存稿', async () => {
    useChatStore.setState({
      historyLoaded: false,
      isStreaming: true,
      messages: [
        { role: 'user', content: '是', timestamp: 1 },
        { role: 'assistant', content: '正在导入…', timestamp: 2 },
      ],
    } as never)
    await store().loadHistory()
    expect(mockLoadMessages).not.toHaveBeenCalled()
    expect(store().messages[0]?.content).toBe('是')
    expect(store().messages[1]?.content).toBe('正在导入…')
    expect(store().historyLoaded).toBe(false)
  })

  it('loadHistory: 运行时校验过滤畸形行与空 system 占位', async () => {
    mockLoadMessages.mockResolvedValue({
      success: true,
      messages: [
        { role: 'user', content: '正常', timestamp: 1 },
        { role: 123, content: '坏行', timestamp: 2 }, // role 非字符串
        { role: 'assistant', content: null, timestamp: 3 }, // content 非字符串
        { role: 'system', content: '', timestamp: 4 }, // 空占位
        { role: 'assistant', content: '好回答', thinking: '思考', timestamp: 5 },
      ],
    })
    await store().loadHistory()
    expect(store().messages).toHaveLength(2)
    expect(store().messages[0]).toMatchObject({ role: 'user', content: '正常' })
    expect(store().messages[1]).toMatchObject({ role: 'assistant', content: '好回答', thinking: '思考' })
    expect(store().historyLoaded).toBe(true)
  })

  it('loadHistory: 空历史仅置 historyLoaded', async () => {
    useChatStore.setState({ messages: [{ role: 'user', content: '旧', timestamp: 9 }] } as never)
    mockLoadMessages.mockResolvedValue({ success: true, messages: [] })
    await store().loadHistory()
    expect(store().historyLoaded).toBe(true)
    expect(store().messages).toHaveLength(1) // 空结果不清空现有显示
  })

  it('loadHistory: await 期间切换会话则丢弃结果(RISK 防串台)', async () => {
    let resolveLoad: (v: unknown) => void
    mockLoadMessages.mockImplementation(
      () => new Promise((res) => {
        resolveLoad = res
      }),
    )
    const p = store().loadHistory()
    useChatStore.setState({ sessionId: 's2' })
    resolveLoad!({ success: true, messages: [{ role: 'user', content: '旧会话内容', timestamp: 1 }] })
    await p
    expect(store().messages).toHaveLength(0)
    expect(store().historyLoaded).toBe(false)
  })

  it('loadHistory: 异常时兜底置 historyLoaded(同会话)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockLoadMessages.mockRejectedValue(new Error('db locked'))
    try {
      await store().loadHistory()
      expect(store().historyLoaded).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })
})
