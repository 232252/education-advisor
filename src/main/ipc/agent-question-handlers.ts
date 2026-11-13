// =============================================================
// 智能体提问 — 主进程把 dsh 运行时的提问接到当前窗口
// =============================================================

import type { AgentQuestionAnswer, AgentQuestionRequest } from '@shared/api/agent-question'
import * as IPC from '@shared/ipc-channels'
import type { BrowserWindow } from 'electron'
import { resolveAgentQuestion, setAgentQuestionSender } from '../services/dsh/agent-question'
import { sendToRenderer } from './broadcast'
import { handleIpc } from './handle'

export function registerAgentQuestionHandlers(win: BrowserWindow): void {
  setAgentQuestionSender((req: AgentQuestionRequest) => {
    if (!win || win.isDestroyed()) {
      throw new Error('提问窗口不可用')
    }
    sendToRenderer(win, IPC.IPC_AGENT_QUESTION_REQUEST, req)
  })

  handleIpc(IPC.IPC_AGENT_QUESTION_RESPOND, async (_e, requestId: unknown, result: unknown) => {
    if (typeof requestId !== 'string' || requestId.length === 0) {
      throw new Error('missing question requestId')
    }
    // 只受理「整组作答」或「显式取消」两种形状，其余按取消处理
    const payload =
      result && typeof result === 'object' && (result as { cancelled?: unknown }).cancelled === true
        ? ({ cancelled: true } as const)
        : normalizeAnswer(result)
    const ok = resolveAgentQuestion(requestId, payload)
    return { success: ok }
  })
}

function normalizeAnswer(result: unknown): AgentQuestionAnswer | { cancelled: true } {
  if (!result || typeof result !== 'object') return { cancelled: true }
  const answers = (result as { answers?: unknown }).answers
  if (!Array.isArray(answers)) return { cancelled: true }
  const items = answers
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : '',
      selected: Array.isArray(a.selected)
        ? a.selected.filter((s): s is string => typeof s === 'string')
        : [],
      ...(typeof a.custom === 'string' ? { custom: a.custom } : {}),
    }))
    .filter((a) => a.id.length > 0)
  return { answers: items }
}
