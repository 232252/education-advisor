// =============================================================
// AgentQuestionHost — dsh 运行时提问的结构化问答弹窗
// =============================================================

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentQuestionRequest } from '../../src/shared/api/agent-question'

const harness = vi.hoisted(() => {
  const listeners: Array<(req: AgentQuestionRequest) => void> = []
  return {
    listeners,
    respond: vi.fn(async () => ({ success: true })),
  }
})

vi.mock('../../src/renderer/lib/ipc-client', () => ({
  getAPI: () => ({
    agentQuestion: {
      onRequest: (cb: (req: AgentQuestionRequest) => void) => {
        harness.listeners.push(cb)
        return () => {
          const i = harness.listeners.indexOf(cb)
          if (i >= 0) harness.listeners.splice(i, 1)
        }
      },
      respond: harness.respond,
    },
  }),
}))

import { AgentQuestionHost } from '../../src/renderer/components/AgentQuestionHost'

const REQ: AgentQuestionRequest = {
  requestId: 'req-1',
  sessionId: 's1',
  questions: [
    {
      id: 'q1',
      question: '要统计哪个班？',
      options: [{ label: '一班' }, { label: '二班' }],
    },
  ],
}

describe('AgentQuestionHost', () => {
  it('渲染问题与选项，教师选择后按问题 id 回传', async () => {
    harness.respond.mockClear()
    render(<AgentQuestionHost />)
    harness.listeners[0]?.(REQ)
    expect(await screen.findByText('要统计哪个班？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '一班' }))
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() =>
      expect(harness.respond).toHaveBeenCalledWith('req-1', {
        answers: [{ id: 'q1', selected: ['一班'] }],
      }),
    )
  })

  it('取消回传 cancelled，绝不等于同意', async () => {
    harness.respond.mockClear()
    render(<AgentQuestionHost />)
    harness.listeners[0]?.(REQ)
    expect(await screen.findByText('要统计哪个班？')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() =>
      expect(harness.respond).toHaveBeenCalledWith('req-1', { cancelled: true }),
    )
  })

  it('无选项的问题用自由文本作答', async () => {
    harness.respond.mockClear()
    render(<AgentQuestionHost />)
    harness.listeners[0]?.({
      requestId: 'req-2',
      sessionId: 's1',
      questions: [{ id: 'q1', question: '补充说明？' }],
    })
    expect(await screen.findByText('补充说明？')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '按上次口径' } })
    fireEvent.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() =>
      expect(harness.respond).toHaveBeenCalledWith('req-2', {
        answers: [{ id: 'q1', selected: [], custom: '按上次口径' }],
      }),
    )
  })
})