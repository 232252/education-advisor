import type {
  AgentEvent,
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Model,
} from '@main/services/llm-contracts'
import { describe, expect, it } from 'vitest'

import { DshAgentEventProjector, type DshAgentTurnInit } from '../agent-events'
import type { DshSessionEvent } from '../wire-types'

const model = {
  id: 'deepseek-v4-flash',
  api: 'openai-completions' as unknown as Api,
  provider: 'deepseek',
  maxTokens: 8192,
} as Model<Api>

function projector(init?: Partial<DshAgentTurnInit>): DshAgentEventProjector {
  return new DshAgentEventProjector({
    model,
    systemPrompt: '你是班主任助手',
    userPrompt: '统计三班人数',
    ...init,
  })
}

const assistantMessage = (
  texts: string[],
  usage?: { inputTokens: number; outputTokens: number },
): DshSessionEvent =>
  ({
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      stream: [{ type: 'text-chunks', texts }],
      usage,
    },
  }) as unknown as DshSessionEvent

/** 判别式联合要显式收窄后才好取成员字段（避免测试里散落 as any） */
type TextDelta = Extract<AssistantMessageEvent, { type: 'text_delta' }>

function textDelta(event: AgentEvent): TextDelta {
  const update = event as Extract<AgentEvent, { type: 'message_update' }>
  if (update.assistantMessageEvent.type !== 'text_delta') {
    throw new Error(`expected text_delta, got ${update.assistantMessageEvent.type}`)
  }
  return update.assistantMessageEvent
}

function archived(p: DshAgentEventProjector): AssistantMessage[] {
  return p.result.messages as AssistantMessage[]
}
describe('DshAgentEventProjector', () => {
  it('assistant/message 展开为 message_update，contentIndex 递增且 delta 原文', () => {
    const out = projector().project(assistantMessage(['三班', '共 42 人']))

    expect(out.map((e) => e.type)).toEqual(['message_update', 'message_update'])
    const first = out[0] as Extract<AgentEvent, { type: 'message_update' }>
    const second = out[1] as Extract<AgentEvent, { type: 'message_update' }>
    expect(textDelta(first).contentIndex).toBe(0)
    expect(textDelta(second).contentIndex).toBe(1)
    expect(textDelta(first).delta).toBe('三班')
    expect(textDelta(second).delta).toBe('共 42 人')
  })

  it('partial 带累计文本与模型身份（collector 诊断与非 delta 分支依赖它）', () => {
    const p = projector()
    p.project(assistantMessage(['一半']))
    const out = p.project(assistantMessage(['另一半'])) as Extract<
      AgentEvent,
      { type: 'message_update' }
    >[]
    const partial = textDelta(out[0]).partial
    expect(partial.role).toBe('assistant')
    expect(partial.model).toBe('deepseek-v4-flash')
    expect(partial.provider).toBe('deepseek')
    expect(partial.api).toBe('openai-completions')
  })

  it('usage 跨多个 assistant/message 累加，且不含 cost（dsh 无该字段）', () => {
    const p = projector()
    p.project(assistantMessage(['a'], { inputTokens: 10, outputTokens: 2 }))
    p.project(assistantMessage(['b'], { inputTokens: 7, outputTokens: 4 }))
    expect(p.result.usage).toEqual({
      inputTokens: 17,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('每个 step 归档一条 assistant 消息，agent_end 汇总全部', () => {
    const p = projector()
    p.project(assistantMessage(['第一段']))
    p.project(assistantMessage(['第二段']))
    const end = p.project({ type: 'turn/end', data: { turn: 1, reason: 'completed' } })

    expect(end.map((e) => e.type)).toEqual(['turn_end', 'agent_end'])
    const agentEnd = end[1] as Extract<AgentEvent, { type: 'agent_end' }>
    expect(agentEnd.messages).toHaveLength(2)
    const archivedMessages = agentEnd.messages as AssistantMessage[]
    expect(archivedMessages[0].content).toEqual([{ type: 'text', text: '第一段' }])
    expect(archivedMessages[1].content).toEqual([{ type: 'text', text: '第二段' }])
    expect(p.result.messages).toBe(agentEnd.messages)
  })

  it('tool/call → tool_execution_start，arguments 尽量按 JSON 解析', () => {
    const out = projector().project({
      type: 'tool/call',
      data: { callId: 'c1', name: 'class_list', arguments: '{"grade":"高三"}' },
    })
    expect(out).toEqual([
      {
        type: 'tool_execution_start',
        toolCallId: 'c1',
        toolName: 'class_list',
        args: { grade: '高三' },
      },
    ])
  })

  it('arguments 不是合法 JSON 时保留原文而不抛错', () => {
    const out = projector().project({
      type: 'tool/call',
      data: { callId: 'c2', name: 'broken', arguments: '{oops' },
    })
    const event = out[0] as Extract<AgentEvent, { type: 'tool_execution_start' }>
    expect(event.args).toBe('{oops')
  })

  it('tool/result → tool_execution_end，isError 取 data.error', () => {
    const out = projector().project({
      type: 'tool/result',
      data: {
        message: {
          toolCallId: 'c1',
          toolName: 'class_list',
          content: [{ type: 'text', text: '[]' }],
          details: { n: 0 },
        },
        error: { name: 'E', code: 'forbidden', reason: '删除学生需要显式确认' },
      },
    })
    expect(out).toEqual([
      {
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'class_list',
        result: { content: [{ type: 'text', text: '[]' }], details: { n: 0 } },
        isError: true,
      },
    ])
  })

  it('缺 message 的 tool/result 不投影（无法对应到具体调用）', () => {
    expect(projector().project({ type: 'tool/result', data: {} })).toEqual([])
  })

  it('turn/end 的 aborted/error 记在 result 上，仍然发 agent_end 收尾', () => {
    const aborted = projector()
    aborted.project(assistantMessage(['半句']))
    const a = aborted.project({ type: 'turn/end', data: { turn: 1, reason: 'aborted' } })
    expect(a.map((e) => e.type)).toEqual(['turn_end', 'agent_end'])
    expect(aborted.result.aborted).toBe(true)
    expect(aborted.result.failed).toBe(false)

    const failed = projector()
    failed.project({ type: 'turn/end', data: { turn: 1, reason: 'error' } })
    expect(failed.result.failed).toBe(true)
    expect(failed.result.aborted).toBe(false)

    const blocked = projector()
    blocked.project({ type: 'turn/end', data: { turn: 1, reason: 'blocked' } })
    expect(blocked.result.aborted).toBe(false)
    expect(blocked.result.failed).toBe(false)
  })

  it('reasoning-chunks 与未知事件不产出（collector 只吃 text_delta）', () => {
    const p = projector()
    expect(
      p
        .project({
          type: 'assistant/message',
          data: { turn: 1, step: 1, stream: [{ type: 'reasoning-chunks', texts: ['想想'] }] },
        } as unknown as DshSessionEvent)
        .map((e) => e.type),
    ).toEqual([])
    expect(p.project({ type: 'step/start', data: {} } as unknown as DshSessionEvent)).toEqual([])
    // 即便没有文本，也要归档一条空消息，保证 turn 计数与 pi 路径一致
    expect(p.result.messages).toHaveLength(1)
    expect(archived(p)[0].content).toEqual([])
  })

  it('conversation 以 user 开头，后接已归档的 assistant 消息', () => {
    const p = projector({ userPrompt: '问题原文' })
    p.project(assistantMessage(['答']))
    const conv = p.conversation
    expect(conv).toHaveLength(2)
    expect(conv[0]).toMatchObject({ role: 'user', content: '问题原文' })
    expect(conv[1]).toMatchObject({ role: 'assistant' })
  })

  it('interrupted 的 assistant/message 归档为 stopReason=aborted', () => {
    const p = projector()
    p.project({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        stream: [{ type: 'text-chunks', texts: ['断句'] }],
        interrupted: true,
      },
    } as unknown as DshSessionEvent)
    expect(archived(p)[0].stopReason).toBe('aborted')
  })
})
