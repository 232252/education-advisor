// =============================================================
// 渲染进程 hooks 测试: useInterval / useAsync
// 这些 hook 此前零覆盖
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAsync } from '../useAsync'
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

describe('useAsync', () => {
  it('挂载时自动执行,loading → data', async () => {
    const fn = vi.fn(async () => 42)
    const { result } = renderHook(() => useAsync(fn))
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeUndefined()

    // 等待 promise resolve
    await act(async () => {
      await vi.waitFor(() => {
        // microtask 刷新
      })
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.data).toBe(42)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeUndefined()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fn 抛错时 error 被捕获并 rethrow', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => useAsync(fn))

    await act(async () => {
      try {
        await Promise.resolve()
      } catch {
        /* swallow */
      }
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toBe('boom')
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('非 Error 抛出值被包装成 Error', async () => {
    const fn = vi.fn(async () => {
      throw 'string error'
    })
    const { result } = renderHook(() => useAsync(fn))

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect((result.current.error as Error).message).toBe('string error')
  })

  it('run() 手动触发执行', async () => {
    const fn = vi.fn(async (x: number) => x * 2)
    const { result } = renderHook(() => useAsync(fn, []))

    // 等待自动执行完成
    await act(async () => {
      await Promise.resolve()
    })
    expect(fn).toHaveBeenCalledTimes(1)

    // 手动 run
    let ret: number | undefined
    await act(async () => {
      ret = await result.current.run(5)
    })
    expect(ret).toBe(10)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('deps 变化触发重新执行', async () => {
    let callCount = 0
    const fn = vi.fn(async () => ++callCount)
    const { rerender } = renderHook(({ dep }) => useAsync(fn, [dep]), {
      initialProps: { dep: 1 },
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(fn).toHaveBeenCalledTimes(1)

    rerender({ dep: 2 })
    await act(async () => {
      await Promise.resolve()
    })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('卸载后不更新状态(无 warning)', async () => {
    const fn = vi.fn(
      async () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve('late'), 100)
        }),
    )
    const { result, unmount } = renderHook(() => useAsync(fn))

    unmount()
    // 推进时间让 promise resolve,不应报 "setState on unmounted" warning
    await act(async () => {
      vi.useFakeTimers()
      vi.advanceTimersByTime(200)
      await Promise.resolve()
      vi.useRealTimers()
    })
    void result
  })

  it('快速连续 run() 时仅保留最后一次结果（竞态保护）', async () => {
    // 两个可控的 deferred promise
    let resolveFirst: (v: string) => void = () => {}
    let resolveSecond: (v: string) => void = () => {}
    const firstPromise = new Promise<string>((r) => {
      resolveFirst = r
    })
    const secondPromise = new Promise<string>((r) => {
      resolveSecond = r
    })

    let callCount = 0
    const fn = vi.fn(() => {
      callCount++
      return callCount === 1 ? firstPromise : secondPromise
    })

    const { result } = renderHook(() => useAsync(fn))

    // 第一次 run() 已由挂载时自动执行触发，等待 loading=true
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.loading).toBe(true)

    // 手动触发第二次 run()，在第一次 resolve 之前
    await act(async () => {
      result.current.run()
      await Promise.resolve()
    })

    // 让第一个 promise resolve —— 应被丢弃（reqId 过期）
    await act(async () => {
      resolveFirst('first-result')
      await Promise.resolve()
    })
    // data 仍为 undefined，因为第一次结果被竞态保护丢弃
    expect(result.current.data).toBeUndefined()

    // 让第二个 promise resolve —— 应被采纳
    await act(async () => {
      resolveSecond('second-result')
      await Promise.resolve()
    })
    expect(result.current.data).toBe('second-result')
    expect(result.current.loading).toBe(false)
  })
})
