// =============================================================
// 智能体提问桥 — dsh 运行时向教师提问，主进程停下等界面作答
//
// 仅接「提问」（user-question/ask，澄清类），不接「审批」（approval/request，
// 危险工具授权）——教师机危险工具已被加固层关闭，审批保持关闭以守住最小权限。
// 无窗口/中断/超时一律按「取消」安全收尾，绝不把取消当成同意。
// =============================================================

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cancelAgentQuestion,
  requestAgentQuestion,
  resetAgentQuestionForTests,
  resolveAgentQuestion,
  setAgentQuestionSender,
} from '../agent-question'

const QUESTIONS = [
  { id: 'q1', question: '要统计哪个班？', options: [{ label: '一班' }, { label: '二班' }] },
]

afterEach(() => {
  resetAgentQuestionForTests()
})

describe('智能体提问桥', () => {
  it('教师作答后 resolve 答案，答案按问题 id 回传', async () => {
    const sent: unknown[] = []
    setAgentQuestionSender((req) => sent.push(req))
    const pending = requestAgentQuestion({ sessionId: 's1', questions: QUESTIONS })
    expect(sent.length).toBe(1)
    const req = sent[0] as { requestId: string }
    const ok = resolveAgentQuestion(req.requestId, {
      answers: [{ id: 'q1', selected: ['一班'] }],
    })
    expect(ok).toBe(true)
    await expect(pending).resolves.toEqual({ answers: [{ id: 'q1', selected: ['一班'] }] })
  })

  it('没有窗口时安全取消，不抛给模型', async () => {
    setAgentQuestionSender(null)
    await expect(requestAgentQuestion({ sessionId: 's1', questions: QUESTIONS })).resolves.toEqual({
      cancelled: true,
    })
  })

  it('运行时取消（abort）时按取消收尾', async () => {
    setAgentQuestionSender(() => {})
    const controller = new AbortController()
    const pending = requestAgentQuestion(
      { sessionId: 's1', questions: QUESTIONS },
      controller.signal,
    )
    controller.abort()
    await expect(pending).resolves.toEqual({ cancelled: true })
  })

  it('cancelAgentQuestion 按 requestId 取消等待中的提问', async () => {
    const sent: unknown[] = []
    setAgentQuestionSender((req) => sent.push(req))
    const pending = requestAgentQuestion({ sessionId: 's1', questions: QUESTIONS })
    const req = sent[0] as { requestId: string }
    expect(cancelAgentQuestion(req.requestId)).toBe(true)
    await expect(pending).resolves.toEqual({ cancelled: true })
  })

  it('未知 requestId 的作答返回 false，不抛', () => {
    expect(resolveAgentQuestion('nope', { answers: [] })).toBe(false)
    expect(cancelAgentQuestion('nope')).toBe(false)
  })

  it('超时未作答按取消收尾，不无限挂起', async () => {
    vi.useFakeTimers()
    try {
      setAgentQuestionSender(() => {})
      const pending = requestAgentQuestion({ sessionId: 's1', questions: QUESTIONS })
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
      await expect(pending).resolves.toEqual({ cancelled: true })
    } finally {
      vi.useRealTimers()
    }
  })
})
