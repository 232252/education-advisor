// =============================================================
// useChatAgentBridge — App 级对话事件桥
// 覆盖: 挂载后 running 事件写入 chatStore;卸载 ChatPage 不影响订阅;
//       卸载 hook 才退订(离开对话页不得再丢流)
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    chat: {
      saveMessage: vi.fn(async () => ({ success: true })),
      renameSession: vi.fn(async () => ({ success: true })),
      loadMessages: vi.fn(async () => ({ success: true, messages: [] })),
      listSessions: vi.fn(async () => ({ success: true, sessions: [] })),
      deleteSession: vi.fn(),
    },
    agent: { abort: vi.fn(), onStatusUpdate: vi.fn(() => () => {}) },
    settings: { get: vi.fn(async () => ({})), set: vi.fn() },
    ai: { listModels: vi.fn(async () => []) },
  }),
}))

vi.mock('../../../src/renderer/stores/toastStore', async () =>
  (await import('../helpers/mock-toast')).mockToastStore,
)

import { useChatAgentBridge } from '../../../src/renderer/hooks/useChatAgentBridge'
import { useAgentStore } from '../../../src/renderer/stores/agent/store'
import { flushStreamDeltas } from '../../../src/renderer/stores/chat/delta-batch'
import { useChatStore } from '../../../src/renderer/stores/chat/store'

beforeEach(() => {
  flushStreamDeltas()
  useAgentStore.setState({ _statusListeners: new Set() } as never)
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    isThinking: false,
    sessionId: 's1',
    historyLoaded: true,
    selectedAgentId: 'ag1',
    streamingAgentId: null,
    streamSessionId: null,
  } as never)
})

describe('useChatAgentBridge', () => {
  it('经 subscribeStatus 转发:离开对话页(hook 仍挂着)流式输出不丢', () => {
    const { unmount } = renderHook(() => useChatAgentBridge())
    act(() => {
      useAgentStore.getState()._handleStatusUpdate({
        agentId: 'ag1',
        status: 'running',
        output: '已创建 4班',
      })
    })
    flushStreamDeltas()
    const msgs = useChatStore.getState().messages
    const last = msgs[msgs.length - 1]
    expect(last?.role).toBe('assistant')
    expect(last?.content).toContain('已创建 4班')
    expect(useChatStore.getState().isStreaming).toBe(true)

    // 模拟 ChatPage 卸载:本 hook 仍在,后续 idle 仍落库/结束流
    act(() => {
      useAgentStore.getState()._handleStatusUpdate({
        agentId: 'ag1',
        status: 'running',
        output: '，54 名学生已导入',
      })
      useAgentStore.getState()._handleStatusUpdate({
        agentId: 'ag1',
        status: 'idle',
        result: {
          id: 'e1',
          agentId: 'ag1',
          prompt: '',
          output: '',
          startedAt: 1,
          durationMs: 1,
          tokenUsage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          cost: 0,
          status: 'success',
        },
      })
    })
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(useChatStore.getState().messages.at(-1)?.content).toContain('54 名学生已导入')
    unmount()
  })

  it('卸载 hook 后不再写入 chatStore', () => {
    const { unmount } = renderHook(() => useChatAgentBridge())
    unmount()
    useChatStore.setState({ messages: [], isStreaming: false, streamingAgentId: null } as never)
    act(() => {
      useAgentStore.getState()._handleStatusUpdate({
        agentId: 'ag1',
        status: 'running',
        output: '不该出现',
      })
    })
    flushStreamDeltas()
    expect(useChatStore.getState().messages).toHaveLength(0)
  })
})
