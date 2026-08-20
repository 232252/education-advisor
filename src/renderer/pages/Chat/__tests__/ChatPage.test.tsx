// =============================================================
// ChatPage — 助手消息头像 + 复制按钮渲染测试
// 验证: 助手消息渲染 AI 头像、复制按钮; 用户消息无头像
// =============================================================

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.hoisted 保证 mock 工厂(hoisted)能访问这些变量
const { chatState, setStateMock } = vi.hoisted(() => {
  // 已知标量/数组字段；其余任何属性访问（loadSessions 等 action）经 Proxy 返回 no-op
  const base: Record<string, unknown> = {
    messages: [
      { role: 'user', content: '你好', id: 'u1', timestamp: 1 },
      { role: 'assistant', content: '# 标题\n\n这是回复', id: 'a1', timestamp: 2 },
    ],
    isStreaming: false,
    currentProvider: 'test',
    currentModel: 'm',
    currentModelContext: 8000,
    currentModelMaxOutput: 1000,
    lastUsage: null,
    lastCost: null,
    thinkingLevel: 'medium',
    sessionId: 's1',
    sessions: [{ id: 's1', title: 't', updatedAt: 1, messageCount: 2 }],
    selectedAgentId: 'main',
    handleAgentEvent: vi.fn(),
  }
  const proxied = new Proxy(base, {
    get(t, p) {
      if (typeof p === 'string' && p in t) return t[p]
      // 未显式定义的字段（各种 action）→ no-op async 函数，避免 mount 副作用崩溃
      return () => Promise.resolve()
    },
  })
  return { chatState: proxied, setStateMock: vi.fn() }
})

vi.mock('../../../stores/chat/store', () => ({
  useChatStore: Object.assign((sel: (s: unknown) => unknown) => sel(chatState), {
    setState: setStateMock,
    getState: () => chatState,
  }),
}))

vi.mock('../../../stores/agent/store', () => ({
  useAgentStore: Object.assign(
    (sel: (s: unknown) => unknown) =>
      sel({
        agents: [{ id: 'main', name: '教育参谋', enabled: true, status: 'idle' }],
        fetchAgents: () => Promise.resolve(),
      }),
    { getState: () => ({ subscribeStatus: () => () => {} }) },
  ),
}))

vi.mock('../../../stores/toastStore', () => ({ toast: vi.fn() }))

vi.mock('../../../lib/ipc-client', () => ({
  getAPI: () => ({
    agent: { runManual: vi.fn(), abort: vi.fn() },
    settings: { set: vi.fn(), get: vi.fn(() => Promise.resolve({})) },
    sys: { openDialog: vi.fn(), readFile: vi.fn() },
    chat: {
      saveMessage: vi.fn(),
      loadMessages: vi.fn(() => Promise.resolve([])),
      deleteSession: vi.fn(),
      listSessions: vi.fn(() => Promise.resolve([])),
    },
  }),
}))

vi.mock('../../../components/ModelSelector', () => ({
  ModelSelector: () => <div data-testid="model-sel" />,
}))

import { ChatPage } from '../ChatPage'

function renderPage() {
  return render(
    <HashRouter>
      <ChatPage />
    </HashRouter>,
  )
}

describe('ChatPage — 助手消息头像与复制按钮', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    // jsdom 未实现 scrollIntoView，ChatPage 自动滚动用到
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => cleanup())

  it('助手消息渲染 AI 头像', () => {
    renderPage()
    expect(screen.getByText('标题')).toBeTruthy()
    // 头像容器(蓝靛渐变)
    const avatar = document.querySelector('.from-blue-500')
    expect(avatar).toBeTruthy()
  })

  it('助手消息渲染复制按钮，aria-label 为"复制"', () => {
    renderPage()
    const copyBtns = screen.getAllByLabelText('复制')
    expect(copyBtns.length).toBeGreaterThanOrEqual(1)
  })

  it('点击复制按钮调用 clipboard.writeText 传入助手内容', () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('复制'))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# 标题\n\n这是回复')
  })

  it('用户消息无 AI 头像（头像数量 = 助手消息数）', () => {
    renderPage()
    expect(screen.getByText('你好')).toBeTruthy()
    expect(document.querySelectorAll('.from-blue-500').length).toBe(1)
  })
})
