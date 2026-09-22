// =============================================================
// 批改「停止」按钮在 dsh 后端的语义
//
// SDK 没有「取消这一轮」的入口，只有整体 shutdown，所以 app 侧的等价动作是
// 关停子进程 —— 表现为流的 transport 抛错。这里要固定两件事：
//   · 被取消导致的抛错必须收敛成 stopReason='aborted'（pi 同形，管线据此抛「已中止」）
//   · 真正的失败不能被同一段 catch 伪装成正常中止
// =============================================================

import type { StreamEvent } from '@shared/types/ai'
import { describe, expect, it, vi } from 'vitest'
import type { DshStreamSource } from '../one-shot'
import { completeSimpleViaDsh } from '../one-shot'
import type { DshChatStreamParams } from '../runtime'
import { DSH_TURN_ABORTED, DSH_TURN_ERROR } from '../stream-mapper'

const TEXT = [{ type: 'text' as const, text: '题干' }]
const USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

function call(params: Partial<Parameters<typeof completeSimpleViaDsh>[0]> = {}) {
  return completeSimpleViaDsh({
    stream: { async *chatStream() {} },
    providerId: 'p',
    modelId: 'm',
    content: TEXT,
    ...params,
  } as Parameters<typeof completeSimpleViaDsh>[0])
}

/** 取流即抛错的替身（不写成生成器：没有 yield 的生成器会触发 lint） */
function throwingStream(message: string, onFirstPull?: () => void): DshStreamSource {
  let pulled = false
  const iterator = {
    next: () => {
      if (!pulled) {
        pulled = true
        onFirstPull?.()
      }
      return Promise.reject(new Error(message))
    },
    return: () => Promise.resolve({ done: true as const, value: undefined }),
    throw: () => Promise.resolve({ done: true as const, value: undefined }),
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return { chatStream: () => iterator as unknown as AsyncGenerator<StreamEvent> }
}

describe('completeSimpleViaDsh 的取消', () => {
  it('signal 已中止时一次都不发起调用', async () => {
    const chatStream = vi.fn(async function* (): AsyncGenerator<StreamEvent> {})
    const stream: DshStreamSource = { chatStream }
    const controller = new AbortController()
    controller.abort()
    const cancel = vi.fn()

    const result = await call({ stream, signal: controller.signal, cancel })

    expect(result).toEqual({ text: '', usage: USAGE, stopReason: 'aborted' })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(chatStream).not.toHaveBeenCalled()
  })

  it('流式中途取消：保留已收到的增量，关停动作只触发一次', async () => {
    const controller = new AbortController()
    const cancel = vi.fn()
    let rejectPending: ((err: Error) => void) | null = null
    const stream: DshStreamSource = {
      async *chatStream(_params: DshChatStreamParams) {
        yield { type: 'text_delta', delta: '已收到的' }
        const pending = new Promise<void>((_resolve, reject) => {
          rejectPending = reject
        })
        // 取消是在消费者处理完上一个事件之后发生的，所以这里同步触发一次 abort
        controller.abort()
        await pending
        yield { type: 'done', cost: 0, usage: { ...USAGE, inputTokens: 1, outputTokens: 2 } }
      },
    }
    // cancel 的契约就是「子进程没了」，因此流以下面这个抛错收尾
    cancel.mockImplementation(() => {
      rejectPending?.(new Error('transport closed'))
    })

    const result = await call({ stream, signal: controller.signal, cancel })

    expect(result.stopReason).toBe('aborted')
    expect(result.text).toBe('已收到的')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('dsh 自己报的 aborted 事件仍按 aborted 返回（不经 signal）', async () => {
    const stream: DshStreamSource = {
      async *chatStream() {
        yield { type: 'text_delta', delta: '半句' }
        yield { type: 'error', message: DSH_TURN_ABORTED, retryable: true }
      },
    }
    expect(await call({ stream })).toEqual({ text: '半句', usage: USAGE, stopReason: 'aborted' })
  })

  it('非取消的失败照原样抛出，不被伪装成 aborted', async () => {
    const stream: DshStreamSource = {
      async *chatStream() {
        yield { type: 'error', message: DSH_TURN_ERROR, retryable: false }
      },
    }
    await expect(call({ stream })).rejects.toThrow(DSH_TURN_ERROR)
  })

  it('取消之后流才抛出的真实失败也按 aborted 收尾（用户就是按了停止）', async () => {
    const controller = new AbortController()
    const stream = throwingStream('transport closed', () => controller.abort())
    const result = await call({ stream, signal: controller.signal })
    expect(result.stopReason).toBe('aborted')
  })

  it('未取消时抛错一定外抛（同一 catch 不能吞掉真失败）', async () => {
    const controller = new AbortController()
    await expect(
      call({ stream: throwingStream('provider 500'), signal: controller.signal }),
    ).rejects.toThrow('provider 500')
  })
})
