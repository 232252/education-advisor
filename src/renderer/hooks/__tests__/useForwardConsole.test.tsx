// =============================================================
// useForwardConsole — console 劫持 hook 测试
// =============================================================

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useForwardConsole } from '../../hooks/useForwardConsole'

describe('useForwardConsole — 基本行为', () => {
  let forwardMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    forwardMock = vi.fn()
    window.api = {
      log: { forward: forwardMock },
    } as unknown as typeof window.api
    // Silence console during tests
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('安装后 console.info 被劫持', () => {
    renderHook(() => useForwardConsole())
    console.info('test message')
    // forward should be called at least once (installation info log + our call)
    expect(forwardMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('console.debug 被劫持', () => {
    renderHook(() => useForwardConsole())
    console.debug('debug msg')
    expect(forwardMock).toHaveBeenCalledWith('debug', 'debug msg')
  })

  it('console.warn 被劫持', () => {
    renderHook(() => useForwardConsole())
    console.warn('warn msg')
    expect(forwardMock).toHaveBeenCalledWith('warn', 'warn msg')
  })

  it('console.error 被劫持', () => {
    renderHook(() => useForwardConsole())
    console.error('error msg')
    expect(forwardMock).toHaveBeenCalledWith('error', 'error msg')
  })
})

describe('useForwardConsole — 卸载恢复', () => {
  it('卸载后 console 恢复原样', () => {
    const forwardMock = vi.fn()
    window.api = { log: { forward: forwardMock } } as unknown as typeof window.api

    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { unmount } = renderHook(() => useForwardConsole())

    // Console is hijacked
    console.info('while mounted')
    expect(forwardMock).toHaveBeenCalled()

    // Clear and unmount
    forwardMock.mockClear()
    unmount()

    // Console should no longer forward
    console.info('after unmount')
    expect(forwardMock).not.toHaveBeenCalled()
  })
})

describe('useForwardConsole — stringify 逻辑', () => {
  // Inline test of the stringify logic
  function stringify(v: unknown): string {
    if (typeof v === 'string') return v
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }

  it('字符串直接返回', () => {
    expect(stringify('hello')).toBe('hello')
  })

  it('数字 JSON 序列化', () => {
    expect(stringify(42)).toBe('42')
  })

  it('布尔 JSON 序列化', () => {
    expect(stringify(true)).toBe('true')
  })

  it('对象 JSON 序列化', () => {
    expect(stringify({ a: 1 })).toBe('{"a":1}')
  })

  it('数组 JSON 序列化', () => {
    expect(stringify([1, 2, 3])).toBe('[1,2,3]')
  })

  it('null JSON 序列化', () => {
    expect(stringify(null)).toBe('null')
  })

  it('undefined JSON 序列化', () => {
    expect(stringify(undefined)).toBeUndefined()
  })

  it('循环引用 → String() fallback', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular
    // JSON.stringify throws on circular → String() fallback
    const result = stringify(circular)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('useForwardConsole — 多参数拼接', () => {
  it('多个参数用空格拼接', () => {
    const forwardMock = vi.fn()
    window.api = { log: { forward: forwardMock } } as unknown as typeof window.api

    vi.spyOn(console, 'info').mockImplementation(() => {})

    renderHook(() => useForwardConsole())
    forwardMock.mockClear() // Clear installation log

    console.info('a', 'b', 'c')
    expect(forwardMock).toHaveBeenCalledWith('info', 'a b c')
  })

  it('混合类型参数拼接', () => {
    const forwardMock = vi.fn()
    window.api = { log: { forward: forwardMock } } as unknown as typeof window.api

    vi.spyOn(console, 'warn').mockImplementation(() => {})

    renderHook(() => useForwardConsole())
    forwardMock.mockClear()

    console.warn('text', 123, { key: 'val' }, true)
    expect(forwardMock).toHaveBeenCalledWith('warn', 'text 123 {"key":"val"} true')
  })
})

describe('useForwardConsole — window.api 缺失', () => {
  it('getAPI 抛错时不崩溃(try/catch)', () => {
    // Remove window.api to trigger error
    ;(window as unknown as Record<string, unknown>).api = undefined

    // Should not throw
    expect(() => {
      const { unmount } = renderHook(() => useForwardConsole())
      // console.info after mount will try getAPI() which will throw
      // but the try/catch should swallow it
      expect(() => console.info('safe')).not.toThrow()
      unmount()
    }).not.toThrow()
  })
})
