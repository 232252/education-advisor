import { describe, expect, it } from 'vitest'
import { mapDshSessionEvent } from '../stream-mapper'
import type { DshSessionEvent } from '../wire-types'

const ev = (e: DshSessionEvent) => mapDshSessionEvent(e)

describe('mapDshSessionEvent', () => {
  it('assistant/message 把压缩分片展开为带 start/end 包裹的增量，并以 done 收尾', () => {
    const out = ev({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        stream: [
          { type: 'reasoning-chunks', texts: ['想一想', '继续'] },
          { type: 'text-chunks', texts: ['你好', '世界'] },
          { type: 'tool-call-chunks', id: 'ignored', args: ['{}'] },
        ],
        usage: {
          inputTokens: 11,
          outputTokens: 22,
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
        },
      },
    })

    expect(out.map((e) => e.type)).toEqual([
      'thinking_start',
      'thinking_delta',
      'thinking_delta',
      'thinking_end',
      'text_start',
      'text_delta',
      'text_delta',
      'text_end',
      'done',
    ])
    expect(out[5]).toEqual({ type: 'text_delta', delta: '你好' })
    // dsh usage 无 cost 字段 → 固定 0
    expect(out[8]).toEqual({
      type: 'done',
      cost: 0,
      usage: { inputTokens: 11, outputTokens: 22, cacheReadTokens: 3, cacheWriteTokens: 4 },
    })
  })

  it('缺 usage 时按全 0（与 pi 链路 ?? 0 口径一致）', () => {
    const out = ev({ type: 'assistant/message', data: { turn: 1, step: 1, stream: [] } })
    expect(out).toEqual([
      {
        type: 'done',
        cost: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
    ])
  })

  it('被中断的 turn 也发 done，渲染端不会停在 streaming 态', () => {
    const out = ev({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        stream: [{ type: 'text-chunks', texts: ['半句'] }],
        interrupted: true,
      },
    })
    expect(out.at(-1)?.type).toBe('done')
  })

  it('tool/call 用同一 callId 发 start/delta/end，arguments 原样作为 argsDelta', () => {
    const out = ev({
      type: 'tool/call',
      data: { callId: 'call_1', name: 'class_create', arguments: '{"name":"高一4班"}' },
    })
    expect(out).toEqual([
      { type: 'toolcall_start', id: 'call_1', name: 'class_create' },
      { type: 'toolcall_delta', id: 'call_1', argsDelta: '{"name":"高一4班"}' },
      { type: 'toolcall_end', id: 'call_1' },
    ])
  })

  it('turn/end 的 aborted/error 视为可重试，completed/interrupted 不发事件', () => {
    expect(ev({ type: 'turn/end', data: { turn: 1, reason: 'aborted' } })).toEqual([
      { type: 'error', message: 'dsh turn aborted', retryable: true },
    ])
    expect(ev({ type: 'turn/end', data: { turn: 1, reason: 'error' } })[0]).toMatchObject({
      type: 'error',
      retryable: true,
    })
    expect(ev({ type: 'turn/end', data: { turn: 1, reason: 'completed' } })).toEqual([])
    expect(ev({ type: 'turn/end', data: { turn: 1, reason: 'interrupted' } })).toEqual([])
  })

  it('tool/result 的 error 走不可重试分支，成功结果不产生事件', () => {
    expect(
      ev({ type: 'tool/result', data: { error: { name: 'E', code: 'c', reason: '磁盘已满' } } }),
    ).toEqual([{ type: 'error', message: '磁盘已满', retryable: false }])
    expect(ev({ type: 'tool/result', data: {} })).toEqual([])
  })

  it('chunk 记录里的增量直接透传', () => {
    const out = ev({
      type: 'assistant/message',
      data: {
        turn: 1,
        step: 1,
        stream: [
          { type: 'chunk', chunk: { type: 'text-delta', text: '即时' } },
          { type: 'chunk', chunk: { type: 'reasoning-delta', text: '嗯' } },
          { type: 'chunk', chunk: { type: 'finish' } },
        ],
      },
    })
    expect(out.map((e) => e.type)).toEqual(['text_delta', 'thinking_delta', 'done'])
  })

  it('未知事件类型返回空（SessionEventMap 可被插件合并扩展）', () => {
    // 闭合联合不含这些成员，接入层在跨进程边界 cast 后交给映射
    expect(ev({ type: 'compaction/start' } as unknown as DshSessionEvent)).toEqual([])
    expect(ev({ type: 'request/header' } as unknown as DshSessionEvent)).toEqual([])
  })
})
