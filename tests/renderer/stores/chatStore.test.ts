// =============================================================
// Chat Store 测试 — 流式事件处理、会话管理
// 覆盖：handleStreamEvent、createSession、switchSession、deleteSession
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock getAPI
const mockSaveMessage = vi.fn().mockResolvedValue({ success: true, id: 1 })
const mockDeleteSession = vi.fn().mockResolvedValue({ success: true })
const mockListSessions = vi.fn().mockResolvedValue({ success: true, sessions: [] })
const mockLoadMessages = vi.fn().mockResolvedValue({ success: true, messages: [] })
const mockSetApiKey = vi.fn()
const mockSettingsGet = vi.fn().mockResolvedValue({
  general: {},
  models: { defaultProvider: '', defaultModel: '', highQualityModel: '', lowCostModel: '' },
  chat: {},
  privacy: {},
  feishu: {},
  advanced: {},
  shortcuts: {},
})
const mockListModels = vi.fn().mockResolvedValue([])

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    chat: {
      saveMessage: mockSaveMessage,
      deleteSession: mockDeleteSession,
      listSessions: mockListSessions,
      loadMessages: mockLoadMessages,
    },
    settings: {
      get: mockSettingsGet,
      set: vi.fn().mockResolvedValue(undefined),
    },
    ai: {
      listModels: mockListModels,
      setApiKey: mockSetApiKey,
    },
  }),
}))

vi.mock('../../../src/renderer/stores/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

const { useChatStore } = await import('../../../src/renderer/stores/chatStore')

describe('chatStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 重置 store 状态
    useChatStore.setState({
      messages: [],
      isStreaming: false,
      isThinking: false,
      currentModel: '',
      currentProvider: '',
      currentModelContext: 0,
      currentModelMaxOutput: 0,
      thinkingLevel: 'off',
      lastUsage: null,
      lastCost: 0,
      sessionId: 'default',
      historyLoaded: false,
      sessions: [],
      chatMode: 'direct',
      selectedAgentId: '',
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('应有正确的初始值', () => {
      const s = useChatStore.getState()
      expect(s.messages).toEqual([])
      expect(s.isStreaming).toBe(false)
      expect(s.sessionId).toBe('default')
      expect(s.thinkingLevel).toBe('off')
    })
  })

  describe('addMessage', () => {
    it('应追加消息到列表', () => {
      useChatStore.getState().addMessage({
        role: 'user',
        content: 'hello',
        timestamp: Date.now(),
      })
      expect(useChatStore.getState().messages).toHaveLength(1)
      expect(useChatStore.getState().messages[0].content).toBe('hello')
    })

    it('应触发持久化（user 消息）', () => {
      useChatStore.getState().addMessage({
        role: 'user',
        content: 'persist-me',
        timestamp: Date.now(),
      })
      expect(mockSaveMessage).toHaveBeenCalled()
      const call = mockSaveMessage.mock.calls[0][0]
      expect(call.content).toBe('persist-me')
      expect(call.role).toBe('user')
    })
  })

  describe('handleStreamEvent', () => {
    it('start 事件应开始流式 + 添加空 assistant 消息', () => {
      useChatStore.getState().handleStreamEvent({ type: 'start', model: 'm', provider: 'p' })
      expect(useChatStore.getState().isStreaming).toBe(true)
      const msgs = useChatStore.getState().messages
      expect(msgs).toHaveLength(1)
      expect(msgs[0].role).toBe('assistant')
      expect(msgs[0].content).toBe('')
    })

    it('text_delta 应追加到最后的 assistant 消息', () => {
      useChatStore.getState().handleStreamEvent({ type: 'start', model: 'm', provider: 'p' })
      useChatStore.getState().handleStreamEvent({ type: 'text_delta', delta: 'Hello ' })
      useChatStore.getState().handleStreamEvent({ type: 'text_delta', delta: 'World' })
      const last = useChatStore.getState().messages[0]
      expect(last.content).toBe('Hello World')
    })

    it('done 事件应结束流式 + 记录 usage', () => {
      useChatStore.getState().handleStreamEvent({ type: 'start', model: 'm', provider: 'p' })
      useChatStore.getState().handleStreamEvent({ type: 'text_delta', delta: 'done content' })
      useChatStore.getState().handleStreamEvent({
        type: 'done',
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: 0.001,
      })
      const s = useChatStore.getState()
      expect(s.isStreaming).toBe(false)
      expect(s.lastUsage?.inputTokens).toBe(10)
      expect(s.lastCost).toBe(0.001)
    })

    it('error 事件应添加错误消息 + 结束流式', () => {
      useChatStore.getState().handleStreamEvent({ type: 'start', model: 'm', provider: 'p' })
      useChatStore.getState().handleStreamEvent({
        type: 'error',
        message: 'connection lost',
        retryable: false,
      })
      const s = useChatStore.getState()
      expect(s.isStreaming).toBe(false)
      const last = s.messages[s.messages.length - 1]
      expect(last.content).toMatch(/错误.*connection lost/)
    })

    it('thinking_delta 应追加到 thinking 字段', () => {
      useChatStore.getState().handleStreamEvent({ type: 'start', model: 'm', provider: 'p' })
      useChatStore.getState().handleStreamEvent({ type: 'thinking_start' })
      useChatStore.getState().handleStreamEvent({ type: 'thinking_delta', delta: 'thinking...' })
      const last = useChatStore.getState().messages[0]
      expect(last.thinking).toBe('thinking...')
    })
  })

  describe('session management', () => {
    it('createSession 应创建新会话并切换', () => {
      const initial = useChatStore.getState().sessionId
      useChatStore.getState().createSession('My Session')
      const s = useChatStore.getState()
      expect(s.sessionId).not.toBe(initial)
      expect(s.sessions).toHaveLength(1)
      expect(s.sessions[0].title).toBe('My Session')
      expect(s.messages).toEqual([])
    })

    it('createSession 不传 title 应自动生成', () => {
      useChatStore.getState().createSession()
      const s = useChatStore.getState()
      expect(s.sessions[0].title).toMatch(/新对话/)
    })

    it('switchSession 应切换并重置消息', () => {
      useChatStore.getState().createSession('A')
      useChatStore.getState().createSession('B')
      const a = useChatStore.getState().sessions[1].id
      useChatStore.getState().switchSession(a)
      expect(useChatStore.getState().sessionId).toBe(a)
    })

    it('deleteSession 应从列表移除 + 清理', () => {
      useChatStore.getState().createSession('A')
      const id = useChatStore.getState().sessions[0].id
      useChatStore.getState().deleteSession(id)
      expect(useChatStore.getState().sessions.find((s) => s.id === id)).toBeUndefined()
      expect(mockDeleteSession).toHaveBeenCalledWith(id)
    })

    it('deleteSession 当前会话应切换到其他会话', () => {
      useChatStore.getState().createSession('A')
      useChatStore.getState().createSession('B')
      const currentId = useChatStore.getState().sessionId
      useChatStore.getState().deleteSession(currentId)
      // 切换到剩下的会话
      expect(useChatStore.getState().sessionId).not.toBe(currentId)
    })

    it('deleteSession 最后一个会话应自动创建新会话', () => {
      useChatStore.getState().createSession('Only')
      const id = useChatStore.getState().sessions[0].id
      useChatStore.getState().deleteSession(id)
      expect(useChatStore.getState().sessions).toHaveLength(1)
      expect(useChatStore.getState().sessionId).not.toBe(id)
    })
  })

  describe('clearMessages', () => {
    it('应清空 messages 但保留 sessionId', () => {
      useChatStore.getState().addMessage({ role: 'user', content: 'x', timestamp: 1 })
      const sid = useChatStore.getState().sessionId
      useChatStore.getState().clearMessages()
      expect(useChatStore.getState().messages).toEqual([])
      expect(useChatStore.getState().sessionId).toBe(sid)
      // C-3 修复后: clearMessages 只清空当前显示,不删除会话数据(避免数据丢失)
      // 所以 mockDeleteSession 不应被调用
      expect(mockDeleteSession).not.toHaveBeenCalled()
    })
  })

  describe('setModel + fetchModelInfo', () => {
    it('setModel 应更新 provider/model 并触发 fetchModelInfo', async () => {
      useChatStore.getState().setModel('openai', 'gpt-4')
      // 等异步 fetch
      await new Promise((r) => setTimeout(r, 10))
      const s = useChatStore.getState()
      expect(s.currentProvider).toBe('openai')
      expect(s.currentModel).toBe('gpt-4')
    })

    it('fetchModelInfo 找不到模型时不应更新 context', async () => {
      mockListModels.mockResolvedValueOnce([])
      useChatStore.getState().setModel('test', 'missing-model')
      await new Promise((r) => setTimeout(r, 10))
      expect(useChatStore.getState().currentModelContext).toBe(0)
    })
  })

  describe('handleAgentEvent', () => {
    it('应忽略其他 agent 的事件', () => {
      useChatStore.setState({ selectedAgentId: 'agent-a' })
      useChatStore.getState().handleAgentEvent({
        agentId: 'agent-b',
        status: 'running',
        output: 'hi',
      })
      // 不应有任何消息
      expect(useChatStore.getState().messages).toEqual([])
    })

    it('应处理 selectedAgentId 的 running 事件', () => {
      useChatStore.setState({ selectedAgentId: 'agent-a' })
      useChatStore.getState().handleAgentEvent({
        agentId: 'agent-a',
        status: 'running',
        output: 'agent output',
      })
      const s = useChatStore.getState()
      expect(s.isStreaming).toBe(true)
      expect(s.messages).toHaveLength(1)
      expect(s.messages[0].content).toBe('agent output')
    })
  })
})
