// =============================================================
// Agent 事件收集器 — 聚合与转发单元测试
// 覆盖: text_delta 累计与攒批 flush 合并、工具事件计数与预览截断
//       (args 300字符/数组8项/深度2层;result 文本 200 字符)、
//       turn_end 错误捕获与非 error turn 清除 stale error(回归)、
//       agent_end usage 聚合(input/output/cost)
// =============================================================

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@earendil-works/pi-agent-core'
import { createEventCollector } from '../../src/main/services/agent/event-collector'

const mocks = vi.hoisted(() => ({
  sendAgentStatus: vi.fn(),
  log: vi.fn(),
}))

vi.mock('../../src/main/services/agent/status-tracking', () => mocks)
vi.mock('../../src/main/utils/logger', () => ({ log: mocks.log }))

beforeEach(() => {
  mocks.sendAgentStatus.mockReset()
})

/** 取 sendAgentStatus 收到的 payload 列表 */
function payloads(): Array<Record<string, unknown>> {
  return mocks.sendAgentStatus.mock.calls.map((c) => c[3] as Record<string, unknown>)
}

const textDelta = (delta: string): AgentEvent =>
  ({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta },
  }) as unknown as AgentEvent

describe('输出聚合与攒批', () => {
  it('text_delta 累计进 stats.outputText,flush 合并一次性转发', () => {
    const { stats, handler, flushPendingOutput } = createEventCollector(undefined, 'a1')
    handler(textDelta('你'))
    handler(textDelta('好'))
    expect(stats.outputText).toBe('你好')
    // flush 前未发送(33ms 窗口未到)
    expect(mocks.sendAgentStatus).not.toHaveBeenCalled()
    flushPendingOutput()
    expect(mocks.sendAgentStatus).toHaveBeenCalledTimes(1)
    expect(mocks.sendAgentStatus).toHaveBeenCalledWith(undefined, 'a1', 'running', {
      output: '你好',
    })
  })

  it('flush 后缓冲清空,重复 flush 不重复发送', () => {
    const { handler, flushPendingOutput } = createEventCollector(undefined, 'a1')
    handler(textDelta('x'))
    flushPendingOutput()
    flushPendingOutput()
    expect(mocks.sendAgentStatus).toHaveBeenCalledTimes(1)
  })
})

describe('工具事件', () => {
  it('toolCallCount 计数,工具事件前先 flush 输出(事件顺序)', () => {
    const { stats, handler } = createEventCollector(undefined, 'a1')
    handler(textDelta('部分输出'))
    handler({
      type: 'tool_execution_start',
      toolName: 'search',
      args: { q: 'x' },
    } as unknown as AgentEvent)
    expect(stats.toolCallCount).toBe(1)
    const ps = payloads()
    // 第 1 条是 flush 出的输出,第 2 条才是 toolCall
    expect(ps[0]).toEqual({ output: '部分输出' })
    expect(ps[1]).toEqual({ toolCall: { name: 'search', args: { q: 'x' } } })
  })

  it('超长字符串 args 截 300 字符并附原长', () => {
    const { handler } = createEventCollector(undefined, 'a1')
    const long = 'x'.repeat(500)
    handler({
      type: 'tool_execution_start',
      toolName: 'write_note',
      args: { text: long },
    } as unknown as AgentEvent)
    const payload = payloads()[0] as { toolCall: { args: { text: string } } }
    expect(payload.toolCall.args.text.startsWith('x'.repeat(300))).toBe(true)
    expect(payload.toolCall.args.text).toContain('…(原长 500)')
  })

  it('超过 8 项的数组只留前 8 项加省略提示', () => {
    const { handler } = createEventCollector(undefined, 'a1')
    handler({
      type: 'tool_execution_start',
      toolName: 'batch',
      args: { items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    } as unknown as AgentEvent)
    const payload = payloads()[0] as { toolCall: { args: { items: unknown[] } } }
    expect(payload.toolCall.args.items).toHaveLength(9)
    expect(payload.toolCall.args.items[8]).toContain('共 10 项')
  })

  it('工具结果预览: 文本截 200 字符,isError 透传', () => {
    const { handler } = createEventCollector(undefined, 'a1')
    handler({
      type: 'tool_execution_end',
      toolName: 'read',
      isError: false,
      result: { content: [{ type: 'text', text: 'y'.repeat(300) }] },
    } as unknown as AgentEvent)
    const payload = payloads()[0] as {
      toolResult: { name: string; isError: boolean; preview: string }
    }
    expect(payload.toolResult.isError).toBe(false)
    expect(payload.toolResult.preview).toBe(`${'y'.repeat(200)}…`)
  })

  it('无文本内容时错误文本优先成为预览', () => {
    const { handler } = createEventCollector(undefined, 'a1')
    handler({
      type: 'tool_execution_end',
      toolName: 'del',
      isError: true,
      result: { error: '需要显式确认' },
    } as unknown as AgentEvent)
    const payload = payloads()[0] as { toolResult: { preview: string } }
    expect(payload.toolResult.preview).toBe('需要显式确认')
  })
})

describe('turn 聚合与错误生命周期', () => {
  const turnEnd = (stopReason: string, errorMessage?: string): AgentEvent =>
    ({
      type: 'turn_end',
      message: { stopReason, errorMessage, content: [] },
    }) as unknown as AgentEvent

  it('turnCount 计数;error turn 捕获 errorMessage', () => {
    const { stats, handler } = createEventCollector(undefined, 'a1')
    handler(turnEnd('error', 'LLM 超时'))
    expect(stats.turnCount).toBe(1)
    expect(stats.lastErrorMessage).toBe('LLM 超时')
  })

  it('后续非 error turn 清除旧错误(stale error 回归)', () => {
    const { stats, handler } = createEventCollector(undefined, 'a1')
    handler(turnEnd('error', '第一次失败'))
    handler(turnEnd('endTurn'))
    expect(stats.lastErrorMessage).toBe('')
  })

  it('stopReason 缺失时不清除已有错误(仅确认非 error 才清)', () => {
    const { stats, handler } = createEventCollector(undefined, 'a1')
    handler(turnEnd('error', '仍失败'))
    handler({ type: 'turn_end', message: { content: [] } } as unknown as AgentEvent)
    expect(stats.lastErrorMessage).toBe('仍失败')
  })
})

describe('agent_end usage 聚合', () => {
  it('跨多条 assistant 消息累计 input/output/cost', () => {
    const { stats, handler } = createEventCollector(undefined, 'a1')
    handler({
      type: 'agent_end',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', usage: { input: 100, output: 50, cost: { total: 0.01 } } },
        { role: 'assistant', usage: { input: 30, output: 20, cost: { total: 0.02 } } },
        { role: 'assistant' },
      ],
    } as unknown as AgentEvent)
    expect(stats.inputTokens).toBe(130)
    expect(stats.outputTokens).toBe(70)
    expect(stats.totalCost).toBeCloseTo(0.03, 10)
  })
})
