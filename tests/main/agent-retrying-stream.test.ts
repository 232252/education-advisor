// =============================================================
// agent/retrying-stream — 事件级重试包装流测试 (2026-08-28 智能轮)
//
// 覆盖用例矩阵:
//   1. 内容事件前的可重试 error(429) → 静默换流,消费方只看到一个 start
//   2. 不可重试 error(401) → 原样转发,不重试
//   3. 已转发内容事件后的 error → 不重试(避免重复输出)
//   4. 建流同步抛错(鉴权) → 合成 error 事件收尾,消费方不悬空
//   5. 重试耗尽 → 最后一次的 error 透出
//   6. 正常流 → start/delta/done 原样转发
//
// 背景: pi-ai 的错误以 {type:'error'} 事件进流而非抛异常,
// 旧版只 try/catch 建流同步异常,对主流错误从不触发(死代码)。
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssistantMessageEvent, AssistantMessageEventStream } from '@earendil-works/pi-ai/compat'

const mocks = vi.hoisted(() => ({
  streamSimple: vi.fn(),
  settingsGet: vi.fn(),
}))

// AssistantMessageEventStream 需要真实类(wrapper 依赖其 push/result 语义),
// 仅 mock streamSimple
vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai/compat')>()
  return { ...actual, streamSimple: mocks.streamSimple }
})

vi.mock('../../src/main/services/settings-service', () => ({
  settingsService: { getSettings: mocks.settingsGet },
}))

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { createRetryingStreamFn } from '../../src/main/services/agent/retrying-stream'

/** 构造一个按事件序列推送并结束的 fake 底层流 */
function fakeStream(events: AssistantMessageEvent[]): AssistantMessageEventStream {
  const s = createAssistantMessageEventStream()
  // EventStream.push 遇 done/error 自动完成,无需手动 end
  void (async () => {
    for (const evt of events) s.push(evt)
    s.end()
  })()
  return s
}

const startEvt = { type: 'start', partial: { role: 'assistant', content: [] } }
const deltaEvt = { type: 'text_delta', delta: '你好' }
const doneEvt = {
  type: 'done',
  reason: 'stop',
  message: { role: 'assistant', content: [{ type: 'text', text: '你好' }], stopReason: 'stop' },
}
const errorEvt = (msg: string) => ({
  type: 'error',
  reason: 'error',
  error: { role: 'assistant', content: [], stopReason: 'error', errorMessage: msg },
})

async function collect(stream: AssistantMessageEventStream): Promise<AssistantMessageEvent[]> {
  const out: AssistantMessageEvent[] = []
  for await (const evt of stream) out.push(evt)
  return out
}

beforeEach(() => {
  mocks.streamSimple.mockReset()
  // baseDelayMs=1 避免真实退避等待; maxRetries=2
  mocks.settingsGet.mockReturnValue({
    models: { retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createRetryingStreamFn — 事件级重试', () => {
  it('内容事件前的可重试 error(429) 应静默换流,消费方只看到一个 start', async () => {
    mocks.streamSimple
      .mockReturnValueOnce(fakeStream([startEvt, errorEvt('429 rate limit exceeded')]))
      .mockReturnValueOnce(fakeStream([startEvt, deltaEvt, doneEvt]))

    const fn = createRetryingStreamFn()
    const wrapper = await fn({} as never, {} as never, { signal: new AbortController().signal })
    const events = await collect(wrapper as AssistantMessageEventStream)

    expect(mocks.streamSimple).toHaveBeenCalledTimes(2)
    const starts = events.filter((e) => e.type === 'start')
    expect(starts).toHaveLength(1) // 重试对消费方完全不可见
    expect(events.map((e) => e.type)).toEqual(['start', 'text_delta', 'done'])
  })

  it('不可重试 error(401) 应原样转发,不重试', async () => {
    mocks.streamSimple.mockReturnValueOnce(fakeStream([startEvt, errorEvt('401 unauthorized')]))

    const fn = createRetryingStreamFn()
    const wrapper = await fn({} as never, {} as never, {})
    const events = await collect(wrapper as AssistantMessageEventStream)

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(events.map((e) => e.type)).toEqual(['start', 'error'])
    const final = (await (wrapper as AssistantMessageEventStream).result()) as {
      errorMessage?: string
    }
    expect(final.errorMessage).toContain('401')
  })

  it('已转发内容事件后的 error 不应重试(避免重复输出)', async () => {
    mocks.streamSimple.mockReturnValueOnce(
      fakeStream([startEvt, deltaEvt, errorEvt('500 internal server error')]),
    )

    const fn = createRetryingStreamFn()
    const wrapper = await fn({} as never, {} as never, {})
    const events = await collect(wrapper as AssistantMessageEventStream)

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(events.map((e) => e.type)).toEqual(['start', 'text_delta', 'error'])
  })

  it('建流同步抛错(鉴权) 应以合成 error 事件收尾', async () => {
    mocks.streamSimple.mockImplementation(() => {
      throw new Error('Invalid API key for provider')
    })

    const fn = createRetryingStreamFn()
    const wrapper = await fn({} as never, {} as never, {})
    const events = await collect(wrapper as AssistantMessageEventStream)

    // 鉴权错误不可重试,只尝试一次
    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(events.map((e) => e.type)).toEqual(['error'])
    const final = (await (wrapper as AssistantMessageEventStream).result()) as {
      errorMessage?: string
    }
    expect(final.errorMessage).toContain('Invalid API key')
  })

  it('重试耗尽后最后一次的 error 应透出', async () => {
    mocks.streamSimple.mockImplementation(() =>
      fakeStream([startEvt, errorEvt('503 service unavailable')]),
    )

    const fn = createRetryingStreamFn()
    const wrapper = await fn({} as never, {} as never, {})
    const events = await collect(wrapper as AssistantMessageEventStream)

    // maxRetries=2 → 共 3 次尝试
    expect(mocks.streamSimple).toHaveBeenCalledTimes(3)
    expect(events[events.length - 1].type).toBe('error')
  })

  it('正常流应原样转发 start/delta/done', async () => {
    mocks.streamSimple.mockReturnValueOnce(fakeStream([startEvt, deltaEvt, doneEvt]))

    const fn = createRetryingStreamFn()
    const wrapper = await fn({} as never, {} as never, {})
    const events = await collect(wrapper as AssistantMessageEventStream)

    expect(mocks.streamSimple).toHaveBeenCalledTimes(1)
    expect(events.map((e) => e.type)).toEqual(['start', 'text_delta', 'done'])
    const final = await (wrapper as AssistantMessageEventStream).result()
    expect((final as { stopReason?: string }).stopReason).toBe('stop')
  })
})
