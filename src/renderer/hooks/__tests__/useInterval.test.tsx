// =============================================================
// 渲染进程 hooks 测试: useInterval
// (useAsync 已于 M23 删除 — 0 消费者的死代码)
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInterval } from '../useInterval'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useInterval', () => {
  it('按 delayMs 间隔执行 callback', () => {
    const cb = vi.fn()
    renderHook(() => useInterval(cb, 1000))
    expect(cb).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1000))
    expect(cb).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(1000))
    expect(cb).toHaveBeenCalledTimes(2)
    act(() => vi.advanceTimersByTime(3000))
    expect(cb).toHaveBeenCalledTimes(5)
  })

  it('delayMs=null 暂停(不执行)', () => {
    const cb = vi.fn()
    renderHook(() => useInterval(cb, null))
    act(() => vi.advanceTimersByTime(10000))
    expect(cb).not.toHaveBeenCalled()
  })

  it('负 delay 不执行', () => {
    const cb = vi.fn()
    renderHook(() => useInterval(cb, -100))
    act(() => vi.advanceTimersByTime(5000))
    expect(cb).not.toHaveBeenCalled()
  })

  it('callback 变化不影响计时,但用最新 callback', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const { rerender } = renderHook(({ cb }) => useInterval(cb, 500), {
      initialProps: { cb: cb1 },
    })
    act(() => vi.advanceTimersByTime(500))
    expect(cb1).toHaveBeenCalledTimes(1)

    rerender({ cb: cb2 })
    act(() => vi.advanceTimersByTime(500))
    expect(cb1).toHaveBeenCalledTimes(1) // 旧 callback 不再调
    expect(cb2).toHaveBeenCalledTimes(1) // 新 callback 被调
  })

  it('delayMs 变化应重新设置间隔', () => {
    const cb = vi.fn()
    const { rerender } = renderHook(({ delay }) => useInterval(cb, delay), {
      initialProps: { delay: 1000 },
    })
    rerender({ delay: 200 })
    act(() => vi.advanceTimersByTime(200))
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('卸载时清理 interval', () => {
    const cb = vi.fn()
    const { unmount } = renderHook(() => useInterval(cb, 500))
    unmount()
    act(() => vi.advanceTimersByTime(5000))
    expect(cb).not.toHaveBeenCalled()
  })
})
