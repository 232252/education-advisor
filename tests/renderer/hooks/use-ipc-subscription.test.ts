// =============================================================
// useIpcSubscription 测试 — 挂载期订阅一次 / handler 始终最新闭包 / 卸载退订
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useIpcSubscription } from '../../../src/renderer/hooks/useIpcSubscription'

describe('useIpcSubscription', () => {
  it('挂载时订阅、重渲染不重订、handler 始终最新闭包、卸载退订', () => {
    const captured: number[] = []
    let emit: ((d: number) => void) | null = null
    const unsub = vi.fn()
    const subscribe = vi.fn((cb: (d: number) => void) => {
      emit = cb
      return unsub
    })

    const { unmount, rerender } = renderHook(
      ({ handler }) => useIpcSubscription(subscribe, handler),
      { initialProps: { handler: (d: number) => captured.push(d) } },
    )

    expect(subscribe).toHaveBeenCalledTimes(1)
    rerender({ handler: (d: number) => captured.push(d * 100) })
    expect(subscribe).toHaveBeenCalledTimes(1) // 重渲染不退订重订

    act(() => emit?.(7))
    expect(captured).toEqual([700]) // handler 始终走最新闭包

    unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })
})
