// =============================================================
// retrying-stream 测试 — P0-2 首字节超时 + 重试门控
// 场景:
//   A. 首字节超时(providerTimeoutMs 无事件)→ abort 本次尝试 → 自动换流重试成功
//   B. 外层(运行级)signal 已 abort(用户停止) → 任何错误都不重试
//   C. 流内 "Request was aborted"(无外层 abort)→ 可重试(P0-2 扩口径)
// =============================================================

import { describe, expect, it, vi } from 'vitest'

// mock settings 读取链(retry-settings → settings-service → electron)
vi.mock('../../pi-ai/retry-settings', () => ({
  readRetrySettings: () => ({
    enabled: true,
    maxRetries: 3,
    baseDelayMs: 1,
    providerTimeoutMs: 60, // 测试用极短首字节超时
  }),
}))

// 事件流工厂: push 记录事件,donePromise 在收到 done/error 后 resolve
const pushEvents: Array<Record<string, unknown>> = []
let doneResolve: (() => void) | null = null
const donePromise = () => {
  return new Promise<void>((r) => (doneResolve = r))
}

vi.mock('@earendil-works/pi-ai', () => ({
  createAssistantMessageEventStream: () => ({
    push(evt: Record<string, unknown>) {
      pushEvents.push(evt)
      if (evt.type === 'done' || evt.type === 'error') doneResolve?.()
    },
  }),
}))

// streamSimple 由各用例定制(契约: 同步函数,返回异步可迭代)
const streamSimpleMock = vi.fn()
vi.mock('@earendil-works/pi-ai/compat', () => ({
  streamSimple: (...args: unknown[]) => streamSimpleMock(...args),
}))

const fakeModel = { id: 'glm-5.3-flash', provider: 'zai-coding-cn', api: 'openai-completions' }

async function runStreamFn(opts?: { signal?: AbortSignal }) {
  pushEvents.length = 0
  doneResolve = null
  const p = donePromise()
  const { createRetryingStreamFn } = await import('../retrying-stream')
  const fn = createRetryingStreamFn()
  // biome-ignore lint/suspicious/noExplicitAny: 测试桩签名
  await fn(fakeModel as any, {} as any, { signal: opts?.signal } as any)
  return p
}

/** 一次性异步生成器: 逐个 yield 给定事件 */
// biome-ignore lint/suspicious/noExplicitAny: 测试桩
function onceStream(events: any[]) {
  return (async function* () {
    for (const e of events) yield e
  })()
}

describe('createRetryingStreamFn — P0-2 首字节超时与重试', () => {
  it('A. 首字节超时 → abort 本次尝试 → 换流重试成功(事件按序转发)', async () => {
    let calls = 0
    streamSimpleMock.mockReset()
    streamSimpleMock.mockImplementation(
      (_model: unknown, _ctx: unknown, o: { signal: AbortSignal }) => {
        calls++
        if (calls === 1) {
          // 挂死: 什么都不产出,直到首字节超时 abort(模拟 provider 无响应)
          return (async function* () {
            await new Promise((_resolve, reject) => {
              if (o.signal.aborted) {
                reject(new Error('Request was aborted'))
                return
              }
              o.signal.addEventListener('abort', () => reject(new Error('Request was aborted')), {
                once: true,
              })
            })
          })()
        }
        // 第二次尝试: 正常产出
        return onceStream([
          { type: 'start', partial: {} },
          { type: 'text_delta', delta: '恢复后的回复' },
          { type: 'done', message: {} },
        ])
      },
    )

    await runStreamFn()
    // 重试发生了(两次建流)
    expect(calls).toBe(2)
    // 事件按序转发(start 缓冲到首个内容事件后一并转发)
    expect(pushEvents.map((e) => e.type)).toEqual(['start', 'text_delta', 'done'])
  }, 10_000)

  it('B. 外层 signal 已 abort(用户停止) → 不重试,直接合成 error 收尾', async () => {
    const controller = new AbortController()
    controller.abort()
    streamSimpleMock.mockReset()
    streamSimpleMock.mockImplementation(() => {
      throw new Error('Request was aborted')
    })

    await runStreamFn({ signal: controller.signal })
    expect(streamSimpleMock).toHaveBeenCalledTimes(1)
    const errEvt = pushEvents.find((e) => e.type === 'error') as {
      error?: { errorMessage?: string }
    }
    expect(errEvt?.error?.errorMessage).toBe('Request was aborted')
  }, 10_000)

  it('C. 流内 error "Request was aborted"(无外层 abort,尚未转发内容) → 可重试', async () => {
    let calls = 0
    streamSimpleMock.mockReset()
    streamSimpleMock.mockImplementation(() => {
      calls++
      return calls === 1
        ? onceStream([
            { type: 'error', reason: 'error', error: { errorMessage: 'Request was aborted' } },
          ])
        : onceStream([
            { type: 'start', partial: {} },
            { type: 'text_delta', delta: 'ok' },
            { type: 'done', message: {} },
          ])
    })

    await runStreamFn()
    expect(calls).toBe(2)
    expect(pushEvents.map((e) => e.type)).toEqual(['start', 'text_delta', 'done'])
  }, 10_000)
})
