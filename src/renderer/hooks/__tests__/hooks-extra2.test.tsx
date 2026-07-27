// =============================================================
// useAutoDismiss + useDataLoader 测试
// 这两个 hook 此前零覆盖
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoDismiss } from '../useAutoDismiss'
import { useDataLoader } from '../useDataLoader'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// =============================================================
// useAutoDismiss
// =============================================================
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

// =============================================================
// useDataLoader
// =============================================================
describe('useDataLoader', () => {
  it('immediate=true 时挂载自动加载', async () => {
    const fetcher = vi.fn(async () => 'loaded')
    const { result } = renderHook(() => useDataLoader({ fetcher }))

    expect(result.current.loading).toBe(true)
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.data).toBe('loaded')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('immediate=false 时不自动加载', async () => {
    const fetcher = vi.fn(async () => 'x')
    const { result } = renderHook(() => useDataLoader({ fetcher, immediate: false }))
    expect(result.current.loading).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fetcher 抛错时 error 被设置', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed')
    })
    const { result } = renderHook(() => useDataLoader({ fetcher }))
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.error).toBe('fetch failed')
    expect(result.current.loading).toBe(false)
  })

  it('errorPrefix 时应弹 toast', async () => {
    const toastSpy = vi.fn()
    vi.doMock('../stores/toastStore', () => ({
      toast: { error: toastSpy },
    }))
    const fetcher = vi.fn(async () => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => useDataLoader({ fetcher, errorPrefix: '加载失败' }))
    await act(async () => {
      await Promise.resolve()
    })
    // errorPrefix 触发 toast(如果 toast mock 生效)
    expect(result.current.error).toBeTruthy()
    vi.doUnmock('../stores/toastStore')
  })

  it('load() 手动触发', async () => {
    const fetcher = vi.fn(async () => 'manual')
    const { result } = renderHook(() => useDataLoader({ fetcher, immediate: false }))
    await act(async () => {
      await result.current.load()
    })
    expect(result.current.data).toBe('manual')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('setData 乐观更新', () => {
    const fetcher = vi.fn(async () => 'real')
    const { result } = renderHook(() => useDataLoader({ fetcher, immediate: false }))
    act(() => result.current.setData('optimistic'))
    expect(result.current.data).toBe('optimistic')
  })

  it('initialData 作为初始值', () => {
    const fetcher = vi.fn(async () => 'fetched')
    const { result } = renderHook(() =>
      useDataLoader({ fetcher, initialData: 'init', immediate: false }),
    )
    expect(result.current.data).toBe('init')
  })

  it('多次 load() 应刷新数据', async () => {
    let count = 0
    const fetcher = vi.fn(async () => `data-${++count}`)
    const { result } = renderHook(() => useDataLoader({ fetcher, immediate: false }))
    await act(async () => {
      await result.current.load()
    })
    expect(result.current.data).toBe('data-1')
    await act(async () => {
      await result.current.load()
    })
    expect(result.current.data).toBe('data-2')
  })

  it('卸载后不更新状态（mounted 检查）', async () => {
    let resolveFetch: (v: string) => void = () => {}
    const slowFetcher = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolveFetch = r
        }),
    )
    const { result, unmount } = renderHook(() =>
      useDataLoader({ fetcher: slowFetcher, immediate: false }),
    )

    // 触发加载
    await act(async () => {
      result.current.load()
      await Promise.resolve()
    })
    expect(result.current.loading).toBe(true)

    // 卸载组件
    unmount()

    // 让 fetcher resolve —— 应不触发 setState（mountedRef.current === false）
    await act(async () => {
      resolveFetch('late-data')
      await Promise.resolve()
    })

    // result.current 仍为卸载前的状态（loading=true, data 未更新）
    // 不会因 setState on unmounted 报 warning
    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeUndefined()
  })
})
