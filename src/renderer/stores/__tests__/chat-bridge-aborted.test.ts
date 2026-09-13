// =============================================================
// agent-bridge-slice 测试 — P0-1 停止可见化 + P1-5 错误落库
// 场景:
//   1. idle+aborted(用户停止) → 空气泡从界面移除 + toast 提示(此前纯沉默)
//   2. idle 正常完成 → 内容落库(回归保护)
//   3. error 且已有 [中断] 标注 → 不二次追加错误文本 + 落库(P1-5)
//   4. error 无既有气泡 → 新建错误气泡并落库
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chat/store'

// vi.hoisted: mock 工厂被提升到文件顶部,依赖的变量必须同样提升
const { saveMessageMock, renameSessionMock, toastSpies } = vi.hoisted(() => ({
  saveMessageMock: vi.fn(async () => undefined),
  renameSessionMock: vi.fn(async () => undefined),
  toastSpies: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('../../lib/ipc-client', () => ({
  getAPI: () => ({
    chat: { saveMessage: saveMessageMock, renameSession: renameSessionMock },
  }),
}))

vi.mock('../toastStore', () => ({ toast: toastSpies }))

function seedStore(messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
  useChatStore.setState({
    messages: messages.map((m, i) => ({
      role: m.role,
      content: m.content,
      toolCalls: [] as [],
      timestamp: 1000 + i,
      id: `m${i}`,
    })),
    sessionId: 's1',
    streamSessionId: 's1',
    selectedAgentId: 'main',
    streamingAgentId: 'main',
    isStreaming: true,
    isThinking: true,
    sessions: [{ id: 's1', title: '已有标题', createdAt: 1, messageCount: 0 }],
    queuedInputs: [],
  })
}

beforeEach(() => {
  saveMessageMock.mockClear()
  renameSessionMock.mockClear()
  toastSpies.info.mockClear()
})

afterEach(() => {
  useChatStore.setState({
    isStreaming: false,
    isThinking: false,
    streamingAgentId: null,
    streamSessionId: null,
    messages: [],
  })
})

describe('handleAgentEvent — P0-1 停止可见化', () => {
  it('idle+aborted: 空助手气泡被移除 + toast 确认(不再纯沉默)', () => {
    seedStore([
      { role: 'user', content: '模拟改卷' },
      { role: 'assistant', content: '' }, // 乐观空气泡
    ])
    useChatStore.getState().handleAgentEvent({
      agentId: 'main',
      status: 'idle',
      source: 'ui',
      aborted: true,
      abortReason: 'user',
    })
    const msgs = useChatStore.getState().messages
    // 空气泡被移除,只剩用户消息
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    // 停止确认 toast(P0-1 核心断言: 09-13 22:05 实锤的"零提示"已修复)
    expect(toastSpies.info).toHaveBeenCalled()
    // 空输出不落库
    expect(saveMessageMock).not.toHaveBeenCalled()
  })

  it('idle+aborted+timeout: toast 给出超时指引文案', () => {
    seedStore([
      { role: 'user', content: '跑个长任务' },
      { role: 'assistant', content: '部分输出' },
    ])
    useChatStore.getState().handleAgentEvent({
      agentId: 'main',
      status: 'idle',
      source: 'ui',
      aborted: true,
      abortReason: 'timeout',
    })
    // 部分输出保留并落库
    expect(saveMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: '部分输出' }),
    )
    const arg = toastSpies.info.mock.calls[0]?.[0] as string
    expect(arg).toContain('超时')
  })

  it('idle 正常完成: 内容落库(回归保护)', () => {
    seedStore([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '完整回复' },
    ])
    useChatStore.getState().handleAgentEvent({ agentId: 'main', status: 'idle', source: 'ui' })
    expect(saveMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: '完整回复', provider: 'agent:main' }),
    )
  })
})

describe('handleAgentEvent — P1-5 错误落库与去重', () => {
  it('error 且输出已含 [中断] 标注: 不重复追加错误文本,整条落库', () => {
    seedStore([
      { role: 'user', content: '查数据' },
      { role: 'assistant', content: '查到一半的结果\n\n[中断] 429 Too Many Requests' },
    ])
    useChatStore
      .getState()
      .handleAgentEvent({
        agentId: 'main',
        status: 'error',
        source: 'ui',
        error: '429 Too Many Requests',
      })
    const msgs = useChatStore.getState().messages
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('assistant')
    // 不二次追加 "**错误:**"
    expect(last.content).not.toContain('**错误:**')
    expect(last.content).toContain('[中断]')
    // P1-5: 错误终态的回复落库(此前只在内存,刷新即丢)
    expect(saveMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: expect.stringContaining('[中断]') }),
    )
  })

  it('error 无既有气泡: 新建错误消息并落库', () => {
    seedStore([{ role: 'user', content: '你好' }])
    useChatStore
      .getState()
      .handleAgentEvent({ agentId: 'main', status: 'error', source: 'ui', error: 'No API key' })
    const msgs = useChatStore.getState().messages
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('assistant')
    expect(last.content).toContain('**错误:**')
    expect(saveMessageMock).toHaveBeenCalled()
  })
})
