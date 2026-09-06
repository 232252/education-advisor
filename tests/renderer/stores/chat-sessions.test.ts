// =============================================================
// Chat Store — 会话切换契约测试(sessions-slice switchSession)
// 覆盖: 切换前 flush 批缓冲 + 在途流部分输出落库旧会话(串台修复)、
//       streamSessionId 保留指向旧会话 → 晚到 running 事件被守卫丢弃、
//       同会话 no-op、无在途流不落库、空气泡不落库但仍 abort
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSaveMessage = vi.fn().mockResolvedValue({ success: true, id: 1 })
const mockAbort = vi.fn()
const mockLoadMessages = vi.fn().mockResolvedValue({ success: true, messages: [] })

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    chat: {
      saveMessage: mockSaveMessage,
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue({ success: true, sessions: [] }),
      loadMessages: mockLoadMessages,
    },
    agent: { abort: mockAbort },
    settings: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
    ai: { listModels: vi.fn().mockResolvedValue([]), setApiKey: vi.fn() },
  }),
}))

vi.mock('../../../src/renderer/stores/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import { flushStreamDeltas } from '../../../src/renderer/stores/chat/delta-batch'
import { useChatStore } from '../../../src/renderer/stores/chat/store'

const store = () => useChatStore.getState()

const ev = (over: Record<string, unknown>) =>
  ({ agentId: 'ag1', status: 'running', ...over }) as never

beforeEach(() => {
  vi.clearAllMocks()
  flushStreamDeltas()
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    isThinking: false,
    sessionId: 's1',
    historyLoaded: true,
    sessions: [
      { id: 's1', title: '会话一', createdAt: 0, updatedAt: 0 },
      { id: 's2', title: '会话二', createdAt: 0, updatedAt: 0 },
    ],
    selectedAgentId: 'ag1',
    streamingAgentId: null,
    streamSessionId: null,
    lastUsage: null,
    lastCost: 0,
  } as never)
})

describe('switchSession 在途流处理', () => {
  it('切换前 flush + 部分输出落库到旧会话(含缓冲中的尾部)', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: '部分开头', timestamp: 1 }],
    } as never)
    // 尾部 delta 仍在 50ms 批缓冲中(未 flush)
    store().handleAgentEvent(ev({ output: '缓冲尾部' }))
    store().switchSession('s2')

    expect(mockSaveMessage).toHaveBeenCalledTimes(1)
    expect(mockSaveMessage.mock.calls[0][0]).toMatchObject({
      sessionId: 's1',
      role: 'assistant',
      content: '部分开头缓冲尾部',
      provider: 'agent:ag1',
    })
    expect(mockAbort).toHaveBeenCalledWith('ag1')
    expect(store().sessionId).toBe('s2')
    expect(store().isStreaming).toBe(false)
    // streamSessionId 保留指向旧会话,供晚到事件守卫使用
    expect(store().streamSessionId).toBe('s1')
  })

  it('晚到 running 事件被 streamSessionId 守卫丢弃,不污染新会话', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: 'x', timestamp: 1 }],
    } as never)
    store().switchSession('s2')
    // abort 生效前已入队的晚到事件
    store().handleAgentEvent(ev({ output: '迟到的输出' }))
    expect(store().messages).toHaveLength(0) // 新会话无新增气泡
    expect(store().streamSessionId).toBe('s1')
  })

  it('无在途流: 不落库不 abort,仅视图重置', () => {
    store().switchSession('s2')
    expect(mockSaveMessage).not.toHaveBeenCalled()
    expect(mockAbort).not.toHaveBeenCalled()
    expect(store().sessionId).toBe('s2')
  })

  it('在途流但空气泡: 不落库,仍 abort 并保留流会话指针', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: '', timestamp: 1 }],
    } as never)
    store().switchSession('s2')
    expect(mockSaveMessage).not.toHaveBeenCalled()
    expect(mockAbort).toHaveBeenCalledWith('ag1')
    expect(store().streamSessionId).toBe('s1')
  })

  it('切到同一会话为 no-op', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: 'x', timestamp: 1 }],
    } as never)
    store().switchSession('s1')
    expect(mockSaveMessage).not.toHaveBeenCalled()
    expect(mockAbort).not.toHaveBeenCalled()
    expect(store().sessionId).toBe('s1')
  })
})
