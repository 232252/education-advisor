// =============================================================
// M0: 聊天桥接来源过滤 — channel/cron 运行不写入聊天会话
// 此前飞书触发的 main 运行会把聊天页置为 streaming:
//   ① 输出串台写入当前会话并落库 ② 切换会话时 switchSession 的
//   abort 误杀飞书侧运行(只回半截话)。
// handleAgentEvent 现在对 source!=='ui' 的事件直接忽略。
// =============================================================

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    chat: { saveMessage: vi.fn(), renameSession: vi.fn() },
  }),
}))

import { createAgentBridgeSlice } from '../../../../src/renderer/stores/chat/agent-bridge-slice'
import type { ChatGet, ChatSet } from '../../../../src/renderer/stores/chat/types'
import type { AgentStatusPayload } from '@shared/types'

function makeSlice() {
  const set = vi.fn()
  const get = vi.fn(() => ({
    sessionId: 'session_test',
    streamSessionId: null,
    selectedAgentId: 'main',
    isStreaming: false,
    isThinking: false,
    streamingAgentId: null,
    messages: [],
    sessions: [{ id: 'session_test', title: '测试会话', createdAt: Date.now(), messageCount: 0 }],
    addMessage: vi.fn(),
    appendStreamDelta: vi.fn(),
    flushDeltas: vi.fn(),
  })) as unknown as ChatGet
  const slice = createAgentBridgeSlice(set as unknown as ChatSet, get)
  return { slice, set, get }
}

describe('M0: 聊天桥接来源过滤', () => {
  it("source='channel' 的运行事件被完全忽略(不读状态、不写消息)", () => {
    const { slice, set, get } = makeSlice()
    const event = {
      agentId: 'main',
      status: 'running',
      output: '飞书运行的部分输出',
      source: 'channel',
    } as AgentStatusPayload
    slice.handleAgentEvent(event)
    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it("source='cron' 的运行事件同样被忽略", () => {
    const { slice, set, get } = makeSlice()
    slice.handleAgentEvent({
      agentId: 'main',
      status: 'running',
      output: '定时任务输出',
      source: 'cron',
    } as AgentStatusPayload)
    expect(get).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it("缺省 source(向后兼容)与 'ui' 事件照常进入处理", () => {
    const { slice, get } = makeSlice()
    slice.handleAgentEvent({ agentId: 'main', status: 'running' } as AgentStatusPayload)
    expect(get).toHaveBeenCalled()
    const { slice: slice2, get: get2 } = makeSlice()
    slice2.handleAgentEvent({
      agentId: 'main',
      status: 'running',
      source: 'ui',
    } as AgentStatusPayload)
    expect(get2).toHaveBeenCalled()
  })
})
