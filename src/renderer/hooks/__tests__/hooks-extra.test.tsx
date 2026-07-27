// =============================================================
// 渲染进程 hooks 测试: useThrottle / usePrevious / useInterval / useAsync
// 这些 hook 此前零覆盖
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAsync } from '../useAsync'
import { useInterval } from '../useInterval'
import { usePrevious } from '../usePrevious'
import { useThrottle } from '../useThrottle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useThrottle', () => {
  it('首次渲染应立即返回当前值(leading edge)', () => {
    const { result } = renderHook(({ val }) => useThrottle(val, 300), {
      initialProps: { val: 'first' },
    })
    expect(result.current).toBe('first')
  })

  it('窗口内变化不更新,窗口结束后更新到最新值', () => {
    const { result, rerender } = renderHook(({ val }) => useThrottle(val, 300), {
      initialProps: { val: 0 },
    })
    expect(result.current).toBe(0)

    // 窗口内连续变化
    rerender({ val: 1 })
    rerender({ val: 2 })
    rerender({ val: 3 })
    expect(result.current).toBe(0) // 仍未更新

    // 推进时间到窗口结束
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe(3) // 更新到最新
  })

  it('窗口结束后下一次变化应立即更新', () => {
    const { result, rerender } = renderHook(({ val }) => useThrottle(val, 100), {
      initialProps: { val: 'a' },
    })
    // 推进超过窗口(初始 effect 会在 100ms 时触发 timer 更新 lastUpdated)
    act(() => vi.advanceTimersByTime(200))

    rerender({ val: 'b' })
    expect(result.current).toBe('b') // remaining<=0 → 立即更新
  })

  it('卸载时清理 timer(无 warning)', () => {
    const { result, rerender, unmount } = renderHook(({ val }) => useThrottle(val, 500), {
      initialProps: { val: 1 },
    })
    rerender({ val: 2 })
    expect(() => unmount()).not.toThrow()
    void result
  })

  it('不变化的值不应触发更新', () => {
    const { result, rerender } = renderHook(({ val }) => useThrottle(val, 100), {
      initialProps: { val: 'same' },
    })
    act(() => vi.advanceTimersByTime(200))
    rerender({ val: 'same' })
    expect(result.current).toBe('same')
  })
})

describe('usePrevious', () => {
  it('首次渲染返回 undefined', () => {
    const { result } = renderHook(({ val }) => usePrevious(val), { initialProps: { val: 10 } })
    expect(result.current).toBeUndefined()
  })

  it('值变化后返回上一次的值', () => {
    const { result, rerender } = renderHook(({ val }) => usePrevious(val), {
      initialProps: { val: 'a' },
    })
    expect(result.current).toBeUndefined()
    rerender({ val: 'b' })
    expect(result.current).toBe('a')
    rerender({ val: 'c' })
    expect(result.current).toBe('b')
  })

  it('对象引用变化也生效', () => {
    const { result, rerender } = renderHook(({ val }) => usePrevious(val), {
      initialProps: { val: { n: 1 } },
    })
    rerender({ val: { n: 2 } })
    expect(result.current).toEqual({ n: 1 })
  })

  it('保持相同原始值不变更时, prev === 当前值', () => {
    const { result, rerender } = renderHook(({ val }) => usePrevious(val), {
      initialProps: { val: 5 },
    })
    rerender({ val: 5 })
    // 第二次渲染后,prev 应为上一次值 5
    expect(result.current).toBe(5)
  })
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
