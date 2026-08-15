// =============================================================
// useAutoDismiss 测试
// 此前零覆盖
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoDismiss } from '../useAutoDismiss'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAutoDismiss', () => {
  it('设置值后 delay 到期自动清空', () => {
    let value: string = ''
    const setValue = (v: string) => {
      value = v
    }
    const { result } = renderHook(() => useAutoDismiss<string>(setValue, '', 3000))
    act(() => result.current('hello'))
    expect(value).toBe('hello')
    act(() => vi.advanceTimersByTime(3000))
    expect(value).toBe('') // 自动清空
  })

  it('快速连续设置应重置 timer(只有最后一次计时)', () => {
    let value: string = ''
    const setValue = (v: string) => {
      value = v
    }
    const { result } = renderHook(() => useAutoDismiss<string>(setValue, '', 3000))
    act(() => result.current('a'))
    act(() => vi.advanceTimersByTime(2000))
    act(() => result.current('b')) // 重置 timer
    act(() => vi.advanceTimersByTime(2000)) // 距上次设置 2s
    expect(value).toBe('b') // 还没清空
    act(() => vi.advanceTimersByTime(1000)) // 总共 3s
    expect(value).toBe('')
  })

  it('delayMsOverride 单次覆盖延迟', () => {
    let value: string = ''
    const { result } = renderHook(() =>
      useAutoDismiss<string>((v: string) => (value = v), '', 3000),
    )
    act(() => result.current('x', 1000)) // 覆盖为 1s
    act(() => vi.advanceTimersByTime(1000))
    expect(value).toBe('')
  })

  it('卸载时清理 timer(无 warning)', () => {
    let value: string = ''
    const { result, unmount } = renderHook(() =>
      useAutoDismiss<string>((v: string) => (value = v), '', 5000),
    )
    act(() => result.current('x'))
    expect(() => unmount()).not.toThrow()
    act(() => vi.advanceTimersByTime(5000))
    // 卸载后 setValue 不应被调用
    expect(value).toBe('x')
  })

  it('clearTo 可为非空值', () => {
    let value: string = ''
    const { result } = renderHook(() =>
      useAutoDismiss<string>((v: string) => (value = v), 'default', 1000),
    )
    act(() => result.current('custom'))
    act(() => vi.advanceTimersByTime(1000))
    expect(value).toBe('default')
  })

  it('delayMsOverride=0 或负数应使用默认 delay', () => {
    let value: string = ''
    const { result } = renderHook(() =>
      useAutoDismiss<string>((v: string) => (value = v), '', 2000),
    )
    act(() => result.current('x', 0)) // 0 → 用默认 2000
    act(() => vi.advanceTimersByTime(100))
    expect(value).toBe('x') // 还在
    act(() => vi.advanceTimersByTime(2000))
    expect(value).toBe('')
  })
})
