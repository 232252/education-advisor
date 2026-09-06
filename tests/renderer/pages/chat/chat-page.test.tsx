// =============================================================
// ChatPage — 页面级冒烟 + 发送/回滚契约
// 覆盖: 页面骨架渲染、未选 Agent 警告、发送乐观更新(用户消息+
//       空气泡+流式态+runManual 携带历史)、runManual success:false
//       与 reject 的回滚(移除空气泡+复位流态+错误提示)
// =============================================================

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runManual: vi.fn(),
  abort: vi.fn(),
  pickFile: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    agent: { runManual: mocks.runManual, abort: mocks.abort },
    chat: {
      saveMessage: vi.fn(async () => ({ success: true })),
      renameSession: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      listSessions: vi.fn(async () => ({ success: true, sessions: [] })),
      loadMessages: vi.fn(async () => ({ success: true, messages: [] })),
    },
    settings: { get: vi.fn(async () => ({})), set: vi.fn() },
    ai: { listModels: vi.fn(async () => []), setApiKey: vi.fn(), listProviders: vi.fn(async () => []) },
  }),
  errText: (e: unknown) => String(e),
}))

vi.mock('../../../../src/renderer/lib/dialog', () => ({
  pickFile: mocks.pickFile,
  saveAs: vi.fn(),
}))

vi.mock('../../../../src/renderer/stores/toastStore', async () => (await import('../../helpers/mock-toast')).mockToastStore)

const i18nMocks = vi.hoisted(() => {
  const t = (key: string, fallback?: unknown) =>
    typeof fallback === 'string' ? fallback : key
  return { t, setLang: vi.fn(() => Promise.resolve()) }
})
vi.mock('../../../../src/renderer/i18n', () => ({
  useT: () => ({ t: i18nMocks.t, lang: 'zh' }),
  tr: (key: string) => key,
  setLang: i18nMocks.setLang,
}))

import { toastMocks } from '../../helpers/mock-toast'
import { useAgentStore } from '../../../../src/renderer/stores/agent/store'
import { useChatStore } from '../../../../src/renderer/stores/chat/store'
import { flushStreamDeltas } from '../../../../src/renderer/stores/chat/delta-batch'
import { ChatPage } from '../../../../src/renderer/pages/Chat/ChatPage'

const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement

/** 回车发送(与 handleKeyDown 的 Enter 分支一致) */
const send = () => fireEvent.keyDown(textarea(), { key: 'Enter', shiftKey: false })

beforeEach(() => {
  vi.clearAllMocks()
  flushStreamDeltas()
  useAgentStore.setState({ agents: [{ id: 'ag1', name: '参谋', enabled: true }] } as never)
  useChatStore.setState({
    messages: [],
    isStreaming: false,
    isThinking: false,
    sessionId: 's1',
    historyLoaded: true,
    sessions: [{ id: 's1', title: '会话', createdAt: 0, updatedAt: 0 }],
    selectedAgentId: 'ag1',
    streamingAgentId: null,
    streamSessionId: null,
    currentProvider: 'p',
    currentModel: 'm',
    lastUsage: null,
    lastCost: 0,
  } as never)
})

describe('ChatPage 骨架', () => {
  it('渲染输入框与会话面板', () => {
    render(createElement(ChatPage))
    expect(textarea()).toBeTruthy()
    expect(screen.getByText('会话')).toBeTruthy()
  })
})

describe('发送流程', () => {
  it('未选 Agent → 警告且不调用 runManual', async () => {
    // 清空启用列表,否则 ChatPage 挂载 effect 会自动回填第一个 Agent
    useAgentStore.setState({ agents: [] } as never)
    useChatStore.setState({ selectedAgentId: '' } as never)
    render(createElement(ChatPage))
    // canSend=false 时 textarea 被禁用,但 fireEvent 为程序化派发不受限制
    fireEvent.change(textarea(), { target: { value: '你好' } })
    await act(async () => {
      send()
    })
    expect(toastMocks.warning).toHaveBeenCalled()
    expect(mocks.runManual).not.toHaveBeenCalled()
  })

  it('发送 → 乐观写入用户+空气泡、置流态、runManual 携带历史', async () => {
    mocks.runManual.mockResolvedValue({ success: true })
    render(createElement(ChatPage))
    fireEvent.change(textarea(), { target: { value: '帮我查数据' } })
    await act(async () => {
      send()
    })
    const s = useChatStore.getState()
    expect(s.messages[0]).toMatchObject({ role: 'user', content: '帮我查数据' })
    expect(s.messages[1]).toMatchObject({ role: 'assistant', content: '' })
    expect(s.isStreaming).toBe(true)
    expect(s.streamingAgentId).toBe('ag1')
    expect(mocks.runManual).toHaveBeenCalledTimes(1)
    const [, finalText, history] = mocks.runManual.mock.calls[0] as [string, string, unknown[]]
    expect(finalText).toBe('帮我查数据')
    expect(Array.isArray(history)).toBe(true)
    // 输入框已清空
    expect(textarea().value).toBe('')
  })

  it('runManual success:false → 回滚空气泡并复位流态+错误提示', async () => {
    mocks.runManual.mockResolvedValue({ success: false, message: 'Agent 已停用' })
    render(createElement(ChatPage))
    fireEvent.change(textarea(), { target: { value: 'x' } })
    await act(async () => {
      send()
    })
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    const s = useChatStore.getState()
    expect(s.messages).toHaveLength(1) // 仅剩用户消息,空气泡被移除
    expect(s.messages[0].role).toBe('user')
    expect(s.isStreaming).toBe(false)
    expect(s.streamingAgentId).toBeNull()
  })

  it('runManual reject → 同样回滚', async () => {
    mocks.runManual.mockRejectedValue(new Error('ipc down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(createElement(ChatPage))
    fireEvent.change(textarea(), { target: { value: 'x' } })
    await act(async () => {
      send()
    })
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    const s = useChatStore.getState()
    expect(s.messages).toHaveLength(1)
    expect(s.isStreaming).toBe(false)
    spy.mockRestore()
  })

  it('流式中再按发送 → 直接忽略', async () => {
    let resolveRun!: (v: unknown) => void
    mocks.runManual.mockImplementation(() => new Promise((res) => { resolveRun = res }))
    render(createElement(ChatPage))
    fireEvent.change(textarea(), { target: { value: '第一条' } })
    await act(async () => {
      send()
    })
    fireEvent.change(textarea(), { target: { value: '第二条' } })
    await act(async () => {
      send()
    })
    expect(mocks.runManual).toHaveBeenCalledTimes(1)
    resolveRun({ success: true })
  })
})
