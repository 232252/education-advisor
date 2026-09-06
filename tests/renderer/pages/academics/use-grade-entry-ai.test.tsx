// =============================================================
// useGradeEntry — AI 智能录入流式链路测试
// 覆盖: 空输入/未配置模型的守卫、F1 sessionId 路由(串扰过滤)、
//       done 事件解析成功合并分数、格式/JSON 错误分支、error 事件、
//       ai.chat 调用失败、R95 30s 超时与 unsub 清理(R112)
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { toastMocks } from '../../helpers/mock-toast'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EAAStudent } from '@shared/types'

const mocks = vi.hoisted(() => ({
  onStream: vi.fn(),
  chat: vi.fn(),
}))

vi.mock('../../../../src/renderer/lib/ipc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/renderer/lib/ipc-client')>()),
  getAPI: () => ({
    ai: {
      onStream: mocks.onStream,
      chat: mocks.chat,
    },
    academic: { createExam: vi.fn() },
  }),
}))

vi.mock('../../../../src/renderer/stores/toastStore', async () => (await import('../../helpers/mock-toast')).mockToastStore)

import { useChatStore } from '../../../../src/renderer/stores/chat/store'
import { useGradeEntry } from '../../../../src/renderer/pages/Academics/hooks/useGradeEntry'

const student = (name: string): EAAStudent =>
  ({ name, class_id: 'c1', status: 'Active' }) as EAAStudent

function setup() {
  return renderHook(() =>
    useGradeEntry({
      studentName: '张三',
      students: [student('张三'), student('李四')],
      subjects: [],
      subjectMap: {},
      exams: [],
      currentGrades: [],
      onSaved: vi.fn(),
      onExamCreated: vi.fn(),
    }),
  )
}

/** 走到「已发起 AI 解析」的状态,返回捕获的流回调与 chat resolve 控制 */
async function startParsing() {
  const { result } = setup()
  act(() => {
    result.current.setAiInputText('请解析这些成绩')
    useChatStore.setState({ currentProvider: 'prov', currentModel: 'model1' })
  })
  let streamHandler!: (e: { type: string; delta?: string; message?: string; sessionId?: string }) => void
  mocks.onStream.mockImplementation((cb: typeof streamHandler) => {
    streamHandler = cb
    return () => {}
  })
  mocks.chat.mockResolvedValue({ sessionId: 'sess-1' })
  await act(async () => {
    await result.current.handleAIParse()
  })
  expect(streamHandler).toBeTruthy()
  return { result, streamHandler }
}

beforeEach(() => {
  vi.clearAllMocks()
  useChatStore.setState({ currentProvider: '', currentModel: '' })
})

describe('AI 解析守卫', () => {
  it('空输入报错且不发起请求', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(toastMocks.error).toHaveBeenCalled()
    expect(mocks.onStream).not.toHaveBeenCalled()
  })

  it('未配置模型报错且不发起请求', async () => {
    const { result } = setup()
    act(() => result.current.setAiInputText('文本'))
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(toastMocks.error).toHaveBeenCalled()
    expect(mocks.chat).not.toHaveBeenCalled()
  })
})

describe('F1 sessionId 路由', () => {
  it('done 事件解析成功: 分数合并 + 成功提示 + 结束解析态', async () => {
    const { result, streamHandler } = await startParsing()
    expect(result.current.aiParsing).toBe(true)
    act(() => {
      streamHandler({ type: 'text_delta', delta: '[{"name":"张三","score":88}]', sessionId: 'sess-1' })
      streamHandler({ type: 'done', sessionId: 'sess-1' })
    })
    await waitFor(() => expect(result.current.aiParsing).toBe(false))
    expect(result.current.singleScores['张三']).toMatchObject({ score: '88' })
    expect(toastMocks.success).toHaveBeenCalled()
  })

  it('异 sessionId 事件被过滤(串扰防护)', async () => {
    const { result, streamHandler } = await startParsing()
    act(() => {
      streamHandler({ type: 'text_delta', delta: '[{"name":"张三","score":1}]', sessionId: 'other-session' })
      streamHandler({ type: 'done', sessionId: 'other-session' })
    })
    expect(result.current.aiParsing).toBe(true) // done 被过滤,解析态保持
    expect(Object.keys(result.current.singleScores)).toHaveLength(0)
  })
})

describe('异常分支', () => {
  it('AI 返回格式异常 → 格式错误提示', async () => {
    const { result, streamHandler } = await startParsing()
    act(() => {
      streamHandler({ type: 'text_delta', delta: '没有 JSON', sessionId: 'sess-1' })
      streamHandler({ type: 'done', sessionId: 'sess-1' })
    })
    await waitFor(() => expect(result.current.aiParsing).toBe(false))
    expect(toastMocks.error).toHaveBeenCalled()
  })

  it('AI 返回坏 JSON → JSON 错误提示', async () => {
    const { result, streamHandler } = await startParsing()
    act(() => {
      streamHandler({ type: 'text_delta', delta: '[{bad}]', sessionId: 'sess-1' })
      streamHandler({ type: 'done', sessionId: 'sess-1' })
    })
    await waitFor(() => expect(result.current.aiParsing).toBe(false))
    expect(toastMocks.error).toHaveBeenCalled()
  })

  it('error 事件 → 错误提示并结束解析态', async () => {
    const { result, streamHandler } = await startParsing()
    act(() => {
      streamHandler({ type: 'error', message: '模型超载', sessionId: 'sess-1' })
    })
    await waitFor(() => expect(result.current.aiParsing).toBe(false))
    expect(toastMocks.error).toHaveBeenCalled()
  })

  it('ai.chat 调用失败 → 错误提示并结束解析态', async () => {
    const { result } = setup()
    act(() => {
      result.current.setAiInputText('文本')
      useChatStore.setState({ currentProvider: 'prov', currentModel: 'model1' })
    })
    mocks.onStream.mockReturnValue(() => {})
    mocks.chat.mockRejectedValue(new Error('网络断开'))
    await act(async () => {
      await result.current.handleAIParse()
    })
    expect(result.current.aiParsing).toBe(false)
    expect(toastMocks.error).toHaveBeenCalled()
  })
})

describe('R95 超时', () => {
  it('30s 无 done 事件 → 超时提示并退订流', async () => {
    vi.useFakeTimers()
    try {
      const unsub = vi.fn()
      const { result, streamHandler: _h } = await startParsingWith(unsub)
      expect(result.current.aiParsing).toBe(true)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(result.current.aiParsing).toBe(false)
      expect(unsub).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  /** fake timers 下手动推进 chat resolve 的 startParsing 变体 */
  async function startParsingWith(unsub: () => void) {
    const { result } = setup()
    act(() => {
      result.current.setAiInputText('文本')
      useChatStore.setState({ currentProvider: 'prov', currentModel: 'model1' })
    })
    let streamHandler!: (e: { type: string }) => void
    mocks.onStream.mockImplementation((cb: typeof streamHandler) => {
      streamHandler = cb
      return unsub
    })
    mocks.chat.mockResolvedValue({ sessionId: 'sess-1' })
    await act(async () => {
      await result.current.handleAIParse()
    })
    return { result, streamHandler }
  }
})
