// =============================================================
// Chat Store — Agent 桥接状态机测试(agent-bridge-slice)
// 覆盖: 串台守卫(streamSessionId≠sessionId)、agentId 不匹配缓存与终止
//       清理(L-10/R-1)、新流初始化 vs 切回复用(R-1/CONCERN)、
//       工具调用追加与结果回填(preview 优先)、idle 保存与空气泡守卫、
//       error 两分支(H-6)、compacted 提示、自动起名
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSaveMessage = vi.fn().mockResolvedValue({ success: true, id: 1 })
const mockRenameSession = vi.fn().mockResolvedValue({ success: true })

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    chat: {
      saveMessage: mockSaveMessage,
      renameSession: mockRenameSession,
      deleteSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue({ success: true, sessions: [] }),
      loadMessages: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    },
    settings: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
    ai: { listModels: vi.fn().mockResolvedValue([]), setApiKey: vi.fn() },
  }),
}))

vi.mock('../../../src/renderer/stores/toastStore', () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import { flushStreamDeltas } from '../../../src/renderer/stores/chat/delta-batch'
import { pendingAgentOutputs } from '../../../src/renderer/stores/chat/agent-pending'
import { useChatStore } from '../../../src/renderer/stores/chat/store'
import { toast } from '../../../src/renderer/stores/toastStore'

const store = () => useChatStore.getState()

/** 造一条 running 事件 */
const ev = (over: Record<string, unknown>) =>
  ({
    agentId: 'ag1',
    status: 'running',
    ...over,
  }) as never

/** 确定性落地 50ms 批缓冲(生产由定时器触发,测试中显式调用) */
const flush = () => flushStreamDeltas()

beforeEach(() => {
  vi.clearAllMocks()
  pendingAgentOutputs.clear()
  flush() // 清掉上一个用例可能残留的批缓冲
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    isThinking: false,
    sessionId: 's1',
    sessions: [{ id: 's1', title: '新对话', createdAt: 0, updatedAt: 0 }],
    selectedAgentId: 'ag1',
    streamingAgentId: null,
    streamSessionId: null,
    lastUsage: null,
    lastCost: 0,
    historyLoaded: true,
  } as never)
})

describe('串台守卫与会话切换', () => {
  it('流属于旧会话: running 事件被丢弃,不写入当前会话', () => {
    useChatStore.setState({ streamSessionId: 'old', sessionId: 's1' })
    store().handleAgentEvent(ev({ output: 'x' }))
    expect(store().messages).toHaveLength(0)
    expect(store().isStreaming).toBe(false)
  })

  it('流属于旧会话: idle 仅清理流状态', () => {
    useChatStore.setState({ streamSessionId: 'old', sessionId: 's1', isStreaming: true })
    store().handleAgentEvent(ev({ status: 'idle' }))
    expect(store().isStreaming).toBe(false)
    expect(store().streamSessionId).toBeNull()
    expect(mockSaveMessage).not.toHaveBeenCalled()
  })
})

describe('agentId 不匹配分支', () => {
  it('切走期间 running 输出进缓存(切回可合并)', () => {
    useChatStore.setState({ selectedAgentId: 'other' })
    store().handleAgentEvent(ev({ agentId: 'ag1', output: '后台输出' }))
    expect(pendingAgentOutputs.get('ag1')).toEqual(['后台输出'])
    expect(store().isStreaming).toBe(false)
  })

  it('切走期间终止事件: 仅当 streamingAgentId 匹配才清理', () => {
    useChatStore.setState({ selectedAgentId: 'other', streamingAgentId: 'ag1', isStreaming: true })
    store().handleAgentEvent(ev({ agentId: 'ag1', status: 'idle' }))
    expect(store().isStreaming).toBe(false)
    expect(store().streamingAgentId).toBeNull()
    expect(pendingAgentOutputs.has('ag1')).toBe(false)
  })

  it('切走期间终止事件: streamingAgentId 不匹配则不动流状态', () => {
    useChatStore.setState({ selectedAgentId: 'other', streamingAgentId: 'ag2', isStreaming: true })
    store().handleAgentEvent(ev({ agentId: 'ag1', status: 'idle' }))
    expect(store().isStreaming).toBe(true)
    expect(store().streamingAgentId).toBe('ag2')
  })
})

describe('running 状态机', () => {
  it('新流: 记录 streaming 身份并新建 assistant 气泡,清理其他 agent 残留缓存', () => {
    pendingAgentOutputs.set('stale', ['垃圾'])
    store().handleAgentEvent(ev({ output: '你好' }))
    flush()
    expect(store().isStreaming).toBe(true)
    expect(store().streamingAgentId).toBe('ag1')
    expect(store().streamSessionId).toBe('s1')
    expect(store().messages).toHaveLength(1)
    expect(store().messages[0]).toMatchObject({ role: 'assistant', content: '你好' })
    expect(pendingAgentOutputs.has('stale')).toBe(false)
  })

  it('切回复用(R-1): streamingAgentId 仍指向当前 agent → 不新建气泡,合并缓存输出', () => {
    useChatStore.setState({
      isStreaming: false,
      streamingAgentId: 'ag1',
      messages: [{ role: 'assistant', content: '已有开头', timestamp: 1 }],
    } as never)
    pendingAgentOutputs.set('ag1', ['切走期间', '的输出'])
    store().handleAgentEvent(ev({ output: '' }))
    flush()
    expect(store().messages).toHaveLength(1) // 复用,无新气泡
    expect(store().messages[0].content).toBe('已有开头切走期间的输出')
    expect(store().isStreaming).toBe(true)
  })

  it('compacted 标记触发用户提示', () => {
    store().handleAgentEvent(ev({ compacted: true }))
    expect(toast.info).toHaveBeenCalled()
  })

  it('toolCall 追加到最后一条 assistant;toolResult 回填最后一个同名未回填项', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: '', timestamp: 1 }],
    } as never)
    store().handleAgentEvent(ev({ toolCall: { name: 'search', args: { q: 1 } } }))
    store().handleAgentEvent(ev({ toolCall: { name: 'read', args: {} } }))
    store().handleAgentEvent(ev({ toolCall: { name: 'search', args: { q: 2 } } }))
    store().handleAgentEvent(ev({ toolResult: { name: 'search', preview: '命中', isError: false } }))
    const tcs = store().messages[0].toolCalls ?? []
    expect(tcs).toHaveLength(3)
    // 最后一个同名 search 被回填,前面的不动
    expect(tcs[2]).toMatchObject({ name: 'search', result: '命中', isError: false })
    expect(tcs[0].result).toBeUndefined()
    // 无预览时 isError → 'error'
    store().handleAgentEvent(ev({ toolResult: { name: 'read', isError: true } }))
    expect((store().messages[0].toolCalls ?? [])[1]).toMatchObject({ result: 'error', isError: true })
  })
})

describe('idle 终止', () => {
  it('非空内容保存消息(provider=agent:ID)并更新 usage/cost;空气泡不落库', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: '', timestamp: 1 }],
    } as never)
    store().handleAgentEvent(ev({ status: 'idle' })) // 空气泡 → 不保存
    expect(mockSaveMessage).not.toHaveBeenCalled()

    store().handleAgentEvent(
      ev({
        status: 'running',
        output: '最终回答',
      }),
    )
    store().handleAgentEvent(
      ev({
        status: 'idle',
        result: { tokenUsage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0 }, cost: 0.1, model: 'm1' },
      }),
    )
    expect(mockSaveMessage).toHaveBeenCalledTimes(1)
    expect(mockSaveMessage.mock.calls[0][0]).toMatchObject({
      role: 'assistant',
      content: '最终回答',
      provider: 'agent:ag1',
    })
    expect(store().lastUsage).toMatchObject({ inputTokens: 5, outputTokens: 6 })
    expect(store().lastCost).toBe(0.1)
    expect(store().isStreaming).toBe(false)
  })

  it('默认标题会话自动起名(首条用户消息前 20 字)', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [
        { role: 'user', content: '帮我分析三年级二班的月考成绩趋势', timestamp: 1 },
        { role: 'assistant', content: '好的', timestamp: 2 },
      ],
    } as never)
    store().handleAgentEvent(ev({ status: 'idle' }))
    expect(mockRenameSession).toHaveBeenCalledWith('s1', '帮我分析三年级二班的月考成绩趋势')
    expect(store().sessions[0].title).toBe('帮我分析三年级二班的月考成绩趋势')
  })

  it('非默认标题不重命名', () => {
    useChatStore.setState({
      sessions: [{ id: 's1', title: '自定义标题', createdAt: 0, updatedAt: 0 }],
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: 'x', timestamp: 1 }],
    } as never)
    store().handleAgentEvent(ev({ status: 'idle' }))
    expect(mockRenameSession).not.toHaveBeenCalled()
  })
})

describe('error 终止', () => {
  it('流式未开始或最后消息非 assistant → 新建错误气泡(H-6)', () => {
    store().handleAgentEvent(ev({ status: 'error', error: '连接超时' }))
    const msgs = store().messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('assistant')
    expect(msgs[0].content).toContain('错误')
    expect(store().isStreaming).toBe(false)
    expect(store().streamingAgentId).toBeNull()
  })

  it('流式中最后消息是 assistant → 追加错误文本', () => {
    useChatStore.setState({
      isStreaming: true,
      streamingAgentId: 'ag1',
      streamSessionId: 's1',
      messages: [{ role: 'assistant', content: '部分输出', timestamp: 1 }],
    } as never)
    store().handleAgentEvent(ev({ status: 'error', error: '中途断开' }))
    expect(store().messages).toHaveLength(1)
    expect(store().messages[0].content).toContain('部分输出')
    expect(store().messages[0].content).toContain('中途断开')
  })
})
