import type { StreamEvent } from '@shared/types/ai'
import { describe, expect, it } from 'vitest'
import type { DshStreamSource } from '../one-shot'
import { completeSimpleViaDsh, isDshSupportedImage, toDshPromptBlocks } from '../one-shot'
import type { DshChatStreamParams } from '../runtime'
import { DSH_TURN_ABORTED, DSH_TURN_ERROR } from '../stream-mapper'

function fakeStream(events: StreamEvent[]) {
  const seen: DshChatStreamParams[] = []
  const stream: DshStreamSource = {
    async *chatStream(params) {
      seen.push(params)
      for (const e of events) yield e
    },
  }
  return { stream, seen }
}

const done: StreamEvent = {
  type: 'done',
  cost: 0,
  usage: { inputTokens: 5, outputTokens: 9, cacheReadTokens: 1, cacheWriteTokens: 2 },
}

describe('toDshPromptBlocks', () => {
  it('文本块原样映射', () => {
    expect(toDshPromptBlocks([{ type: 'text', text: '题干' }])).toEqual([
      { type: 'text', text: '题干' },
    ])
  })

  it('受支持图片收窄成 dsh 的四种 mime', () => {
    expect(toDshPromptBlocks([{ type: 'image', data: 'ABCD', mimeType: 'image/jpeg' }])).toEqual([
      { type: 'image', data: 'ABCD', mimeType: 'image/jpeg' },
    ])
    expect(isDshSupportedImage('image/png')).toBe(true)
    expect(isDshSupportedImage('image/svg+xml')).toBe(false)
  })

  it('不受支持的图片格式抛错而非静默丢图', () => {
    expect(() => toDshPromptBlocks([{ type: 'image', data: 'X', mimeType: 'image/tiff' }])).toThrow(
      /image\/tiff/,
    )
  })
})

describe('completeSimpleViaDsh', () => {
  it('拼接文本增量并带回 usage', async () => {
    const { stream } = fakeStream([
      { type: 'start', model: 'm', provider: 'p' },
      { type: 'text_start' },
      { type: 'text_delta', delta: '{"q' },
      { type: 'text_delta', delta: 'uiz":[]}' },
      { type: 'text_end' },
      done,
    ])
    const res = await completeSimpleViaDsh({
      stream,
      providerId: 'p',
      modelId: 'm',
      content: [{ type: 'text', text: '请提取题目' }],
    })
    expect(res.text).toBe('{"quiz":[]}')
    expect(res.usage).toEqual({
      inputTokens: 5,
      outputTokens: 9,
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
    })
  })

  it('systemPrompt 与 maxTokens 透传给 chatStream，blocks 取代 messages 文本', async () => {
    const { stream, seen } = fakeStream([{ type: 'text_delta', delta: 'ok' }, done])
    await completeSimpleViaDsh({
      stream,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      systemPrompt: '你是批改助手',
      maxTokens: 4096,
      content: [
        { type: 'image', data: 'PNGDATA', mimeType: 'image/png' },
        { type: 'text', text: '按此量规批改' },
      ],
    })
    expect(seen).toHaveLength(1)
    const p = seen[0]
    expect(p.providerId).toBe('deepseek')
    expect(p.modelId).toBe('deepseek-v4-flash')
    expect(p.systemPrompt).toBe('你是批改助手')
    expect(p.maxTokens).toBe(4096)
    expect(p.messages).toEqual([])
    // one-shot 只负责 content blocks 的映射；系统提示由 DshRuntime 前置，
    // 见 runtime.test 的 blocks 组装顺序
    expect(p.blocks).toEqual([
      { type: 'image', data: 'PNGDATA', mimeType: 'image/png' },
      { type: 'text', text: '按此量规批改' },
    ])
  })

  it('没有任何文本时返回空串与零 usage（不臆造 done）', async () => {
    const { stream } = fakeStream([{ type: 'start', model: 'm', provider: 'p' }])
    const res = await completeSimpleViaDsh({
      stream,
      providerId: 'p',
      modelId: 'm',
      content: [],
    })
    expect(res).toEqual({
      text: '',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
  })

  it('图片格式不受支持时，在发起请求前就失败', async () => {
    const { stream, seen } = fakeStream([done])
    await expect(
      completeSimpleViaDsh({
        stream,
        providerId: 'p',
        modelId: 'm',
        content: [{ type: 'image', data: 'X', mimeType: 'image/bmp' }],
      }),
    ).rejects.toThrow(/image\/bmp/)
    expect(seen).toHaveLength(0)
  })

  it('aborted 归一化成 stopReason（管线据此抛「已中止」），其余 error 抛出', async () => {
    const { stream } = fakeStream([
      { type: 'text_delta', delta: '半句' },
      { type: 'error', message: DSH_TURN_ABORTED, retryable: true },
    ])
    const res = await completeSimpleViaDsh({
      stream,
      providerId: 'p',
      modelId: 'm',
      content: [{ type: 'text', text: 'x' }],
    })
    expect(res).toEqual({
      text: '半句',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: 'aborted',
    })

    const { stream: failed } = fakeStream([
      { type: 'error', message: DSH_TURN_ERROR, retryable: true },
    ])
    await expect(
      completeSimpleViaDsh({ stream: failed, providerId: 'p', modelId: 'm', content: [] }),
    ).rejects.toThrow('dsh turn error')
  })
})
