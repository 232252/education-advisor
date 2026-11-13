// =============================================================
// 智能体提问桥 — dsh 运行时向教师提问，主进程停下等界面作答
//
// 只接「提问」（user-question/ask，澄清类）。危险工具的「审批」
// （approval/request）不接：教师机危险工具已被加固层关闭，审批保持
// 关闭以守住最小权限（DSH_CORE_RUNTIME.md）。
//
// 安全收尾：无窗口 / 运行时中断 / 超时未答，一律返回 { cancelled: true }。
// 取消绝不等于同意 —— 模型收到取消后应自行收敛，而不是获得任何授权。
// =============================================================

import { randomUUID } from 'node:crypto'
import type {
  AgentQuestionAnswer,
  AgentQuestionItem,
  AgentQuestionRequest,
} from '@shared/api/agent-question'

/** 提问等待上限：教师长时间未答按取消收尾，避免子进程无限挂起 */
const QUESTION_TIMEOUT_MS = 5 * 60 * 1000

export type AgentQuestionResult = AgentQuestionAnswer | { cancelled: true }

type Waiter = {
  resolve: (result: AgentQuestionResult) => void
  timer: ReturnType<typeof setTimeout>
}

const waiters = new Map<string, Waiter>()

export type AgentQuestionSender = (req: AgentQuestionRequest) => void

let sender: AgentQuestionSender | null = null

export function setAgentQuestionSender(next: AgentQuestionSender | null): void {
  sender = next
}

function settle(requestId: string, result: AgentQuestionResult): boolean {
  const waiter = waiters.get(requestId)
  if (!waiter) return false
  waiters.delete(requestId)
  clearTimeout(waiter.timer)
  waiter.resolve(result)
  return true
}

/** 渲染进程回传作答。未知 requestId 返回 false，不抛。 */
export function resolveAgentQuestion(requestId: string, result: AgentQuestionResult): boolean {
  return settle(requestId, result)
}

/** 运行时取消了提问（user-question.cancelled）。未知 id 返回 false。 */
export function cancelAgentQuestion(requestId: string): boolean {
  return settle(requestId, { cancelled: true })
}

export function resetAgentQuestionForTests(): void {
  for (const waiter of waiters.values()) {
    clearTimeout(waiter.timer)
    waiter.resolve({ cancelled: true })
  }
  waiters.clear()
  sender = null
}

/**
 * 弹出提问并等待教师作答。无窗口 / 中断 / 超时都返回 { cancelled: true }，
 * 不向模型抛错 —— 提问失败不应打断整轮对话。
 */
export function requestAgentQuestion(
  input: { sessionId: string; questions: AgentQuestionItem[] },
  signal?: AbortSignal,
): Promise<AgentQuestionResult> {
  const send = sender
  if (!send || signal?.aborted) {
    return Promise.resolve({ cancelled: true })
  }
  const req: AgentQuestionRequest = {
    requestId: randomUUID(),
    sessionId: input.sessionId,
    questions: input.questions,
  }
  return new Promise<AgentQuestionResult>((resolve) => {
    let settled = false
    // 唯一收尾点：清定时器、摘监听、resolve，幂等
    const done = (result: AgentQuestionResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      waiters.delete(req.requestId)
      resolve(result)
    }
    const onAbort = () => done({ cancelled: true })
    const timer = setTimeout(() => done({ cancelled: true }), QUESTION_TIMEOUT_MS)
    waiters.set(req.requestId, { resolve: done, timer })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      send(req)
    } catch {
      done({ cancelled: true })
    }
  })
}
