// =============================================================
// useMultiLoader 测试 — 逐 key 就绪(渐进渲染)语义
// 覆盖: readyKeys 随各源 settle 递增 / data 增量合并 / 全 settle 后 loading 关闭
// =============================================================

import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useMultiLoader } from '../../../src/renderer/hooks/useMultiLoader'

describe('useMultiLoader — readyKeys 渐进就绪', () => {
  it('快源先 settle 时即可用,无需等慢源全屏障', async () => {
    // 慢源用手动 resolve 的 deferred promise,避免测试自身时序竞态
    let resolveSlow: (v: string) => void = () => {}
    const slowPromise = new Promise<string>((resolve) => {
      resolveSlow = resolve
    })
    const { result } = renderHook(() =>
      useMultiLoader({
        fast: () => Promise.resolve('A'),
        slow: () => slowPromise,
      }),
    )
    // fast 已 settle: readyKeys 含 fast,且 data 已可用
    await waitFor(() => expect(result.current.readyKeys.has('fast')).toBe(true))
    expect(result.current.data.fast).toBe('A')
    // slow 未 settle: 不在 readyKeys,loading 仍为 true
    expect(result.current.readyKeys.has('slow')).toBe(false)
    expect(result.current.loading).toBe(true)
    // slow settle 后全屏障解除
    resolveSlow('B')
    await waitFor(() => expect(result.current.readyKeys.has('slow')).toBe(true))
    expect(result.current.loading).toBe(false)
    expect(result.current.data.slow).toBe('B')
  })

  it('失败的 key 也算已就绪(进 readyKeys + errors)', async () => {
    const { result } = renderHook(() =>
      useMultiLoader({
        ok: () => Promise.resolve(1),
        bad: () => Promise.reject(new Error('boom')),
      }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.readyKeys.has('ok')).toBe(true)
    expect(result.current.readyKeys.has('bad')).toBe(true)
    expect(result.current.errors.bad?.message).toBe('boom')
    expect(result.current.data.ok).toBe(1)
  })

  it('reload 时 readyKeys 清空后重新累积', async () => {
    let attempt = 0
    const { result, rerender } = renderHook(() =>
      useMultiLoader(
        { k: () => Promise.resolve(++attempt) },
        { deps: [attempt === -1] }, // 仅挂载加载一次;reload 用返回的 reload()
      ),
    )
    await waitFor(() => expect(result.current.readyKeys.has('k')).toBe(true))
    expect(result.current.data.k).toBe(1)
    result.current.reload()
    rerender()
    await waitFor(() => expect(result.current.data.k).toBe(2))
    expect(result.current.readyKeys.has('k')).toBe(true)
  })
})

describe('useMultiLoader — fallbacks 归一化模式', () => {
  const FALLBACKS = { a: [] as string[], b: null as number | null }

  it('未加载/失败的 key 落到兜底值,成功 key 用真实值', async () => {
    const { result } = renderHook(() =>
      useMultiLoader(
        {
          a: () => Promise.resolve(['x']),
          b: () => Promise.reject(new Error('boom')),
        },
        { fallbacks: FALLBACKS },
      ),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ a: ['x'], b: null })
    expect(result.current.errors.b?.message).toBe('boom')
  })

  it('reload 失败后保留旧值而非回退兜底(与原 ?? 样板语义一致)', async () => {
    let fail = false
    const { result } = renderHook(() =>
      useMultiLoader({ a: () => (fail ? Promise.reject(new Error('x')) : Promise.resolve(['v'])) }, {
        fallbacks: FALLBACKS,
      }),
    )
    await waitFor(() => expect(result.current.data.a).toEqual(['v']))
    fail = true
    result.current.reload()
    await waitFor(() => expect(result.current.errors.a?.message).toBe('x'))
    // 失败不清空旧值({...data} 基线),兜底只补 undefined
    expect(result.current.data.a).toEqual(['v'])
  })
})
