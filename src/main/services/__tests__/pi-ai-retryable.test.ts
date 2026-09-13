// =============================================================
// isRetryableError / mapEvent retryable 口径测试
// P0-2(09-13 深查): 扩口径 — 'Request was aborted' 与 "timed out" 变体
// P2-9: mapEvent retryable 与 isRetryableError 统一
// =============================================================

import { describe, expect, it } from 'vitest'
import { isRetryableError, mapEvent } from '../pi-ai-helpers'

describe('isRetryableError — P0-2 扩口径', () => {
  it('历史口径保持: 网络类错误仍可重试', () => {
    expect(isRetryableError('Request timeout')).toBe(true)
    expect(isRetryableError('network error')).toBe(true)
    expect(isRetryableError('429 Too Many Requests')).toBe(true)
    expect(isRetryableError('502 Bad Gateway')).toBe(true)
    expect(isRetryableError('ECONNRESET')).toBe(true)
    expect(isRetryableError('ECONNREFUSED')).toBe(true)
  })

  it('历史口径保持: 不可重试错误仍不可重试', () => {
    expect(isRetryableError('401 Unauthorized')).toBe(false)
    expect(isRetryableError('Invalid API key')).toBe(false)
    expect(isRetryableError('model not found')).toBe(false)
  })

  it('P0-2: "Request was aborted" 可重试(首字节超时 abort 的 reason 在部分 SDK 路径下被替换为该文案)', () => {
    expect(isRetryableError('Request was aborted')).toBe(true)
  })

  it('P0-2: openai SDK 超时文案 "Request timed out." 可重试(历史 includes("timeout") 匹配不到含空格变体)', () => {
    expect(isRetryableError('Request timed out.')).toBe(true)
    expect(isRetryableError('Request timed out after 3 retries')).toBe(true)
    expect(isRetryableError('Provider connection timeout (60000ms 无响应, 已触发自动重试)')).toBe(
      true,
    )
  })
})

describe('mapEvent — P2-9 retryable 口径统一', () => {
  const baseError = (errorMessage: string, reason = 'error') =>
    ({
      type: 'error',
      reason,
      error: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'zai-coding-cn',
        model: 'glm-5.3-flash',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'error',
        errorMessage,
        timestamp: Date.now(),
      },
    }) as Parameters<typeof mapEvent>[0]

  it('流内网络类错误 retryable=true(此前仅 reason=aborted 才为 true)', () => {
    const evt = mapEvent(baseError('429 Too Many Requests'))
    expect(evt).toMatchObject({ type: 'error', retryable: true })
  })

  it('流内非网络错误 retryable=false', () => {
    const evt = mapEvent(baseError('401 Unauthorized'))
    expect(evt).toMatchObject({ type: 'error', retryable: false })
  })

  it('reason=aborted 保持 retryable=true(历史行为)', () => {
    const evt = mapEvent(baseError('Request was aborted', 'aborted'))
    expect(evt).toMatchObject({ type: 'error', retryable: true })
  })
})
