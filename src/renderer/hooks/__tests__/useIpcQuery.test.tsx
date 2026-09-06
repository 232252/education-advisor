// =============================================================
// useIpcQuery 单元测试 — 单源加载收口 hook 的关键不变量
// 覆盖: 挂载加载 / 默认失败 toast / keepDataOnError / onError 接管 /
//       stale guard / reload 可 await / loadingMode initial / onData 级联失败
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIpcQuery } from '../useIpcQuery'

const toastMocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('../../stores/toastStore', () => ({
  toast: { error: toastMocks.error, success: toastMocks.success },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useIpcQuery', () => {
  it('挂载即加载,成功后 data 就位、loading 复位', async () => {
    const { result } = renderHook(() => useIpcQuery(async () => 'ok', { initialLoading: false }))
    await waitFor(() => expect(result.current.data).toBe('ok'))
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('失败走默认 toast+console,默认保留旧数据', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = false
    const { result } = renderHook(() =>
      useIpcQuery<string>(
        async () => {
          if (fail) throw new Error('boom')
          return 'v1'
        },
        { initialLoading: false, scope: 'T' },
      ),
    )
    await waitFor(() => expect(result.current.data).toBe('v1'))
    await act(async () => {
      fail = true
      await result.current.reload()
    })
    expect(result.current.data).toBe('v1') // keepDataOnError 默认 true
    expect(result.current.error).toBeInstanceOf(Error)
    expect(consoleSpy).toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('keepDataOnError=false 时失败清空数据', async () => {
    let fail = false
    const { result } = renderHook(() =>
      useIpcQuery<string>(
        async () => {
          if (fail) throw new Error('boom')
          return 'v1'
        },
        { initialLoading: false, keepDataOnError: false },
      ),
    )
    await waitFor(() => expect(result.current.data).toBe('v1'))
    await act(async () => {
      fail = true
      await result.current.reload()
    })
    expect(result.current.data).toBeNull()
  })

  it('onError 接管后不再 toast', async () => {
    const onError = vi.fn()
    renderHook(() =>
      useIpcQuery<string>(
        async () => {
          throw new Error('x')
        },
        { initialLoading: false, onError },
      ),
    )
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('stale guard: 慢的旧请求不覆盖新数据', async () => {
    let resolveSlow: (v: string) => void = () => {}
    const slow = new Promise<string>((r) => {
      resolveSlow = r
    })
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) =>
        useIpcQuery<string>(() => (key === 'slow' ? slow : Promise.resolve('fast')), {
          deps: [key],
          initialLoading: false,
        }),
      { initialProps: { key: 'slow' } },
    )
    rerender({ key: 'fast' })
    await waitFor(() => expect(result.current.data).toBe('fast'))
    await act(async () => {
      resolveSlow('stale')
      await slow
    })
    expect(result.current.data).toBe('fast') // 旧请求被令牌丢弃
  })

  it('loadingMode initial: 重载不闪 loading', async () => {
    let n = 0
    const { result } = renderHook(() =>
      useIpcQuery(async () => ++n, { loadingMode: 'initial', initialLoading: false }),
    )
    await waitFor(() => expect(result.current.data).toBe(1))
    expect(result.current.loading).toBe(false)
    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.data).toBe(2)
    expect(result.current.loading).toBe(false) // 重载未置 loading
  })

  it('onData 抛错走失败路径', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useIpcQuery<string>(async () => 'ok', {
        initialLoading: false,
        onData: async () => {
          throw new Error('cascade fail')
        },
        onError,
      }),
    )
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(result.current.data).toBe('ok') // 数据已写入,级联失败不影响已到数据
  })
})
