// =============================================================
// useDebounce hook 测试（P2-5 + P2-3 示例 spec）
// - 不依赖 @testing-library/react
// - 用 createRoot + act 写一个 minimal renderHook helper
// =============================================================

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebounce } from '../useDebounce'

interface HookHandle<T> {
  result: { current: T | undefined }
  rerender: (hook: () => T) => void
  unmount: () => void
}

function renderHook<T>(hook: () => T): HookHandle<T> {
  const ref: { current: T | undefined } = { current: undefined }
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null
  let currentHook = hook
  function Probe() {
    ref.current = currentHook()
    return null
  }
  act(() => {
    root = createRoot(container)
    root.render(createElement(Probe))
  })
  return {
    result: ref,
    rerender: (next: () => T) => {
      currentHook = next
      act(() => {
        root?.render(createElement(Probe))
      })
    },
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
  }
}

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始值立即返回', () => {
    const h = renderHook(() => useDebounce('hello', 300))
    expect(h.result.current).toBe('hello')
    h.unmount()
  })

  it('delayMs 内变化不更新', () => {
    const h = renderHook(() => useDebounce('a', 300))
    expect(h.result.current).toBe('a')
    h.rerender(() => useDebounce('b', 300))
    // 还没到延迟
    expect(h.result.current).toBe('a')
    h.unmount()
  })

  it('延迟结束后更新到最新值', () => {
    const h = renderHook(() => useDebounce('a', 300))
    h.rerender(() => useDebounce('b', 300))
    h.rerender(() => useDebounce('c', 300))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(h.result.current).toBe('c')
    h.unmount()
  })

  it('快速连续变化只触发一次更新', () => {
    const h = renderHook(() => useDebounce('a', 200))
    h.rerender(() => useDebounce('x', 200))
    act(() => {
      vi.advanceTimersByTime(50)
    })
    h.rerender(() => useDebounce('y', 200))
    act(() => {
      vi.advanceTimersByTime(50)
    })
    h.rerender(() => useDebounce('z', 200))
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(h.result.current).toBe('z')
    h.unmount()
  })

  it('unmount 时清理 timer(无 warning)', () => {
    const h = renderHook(() => useDebounce('a', 300))
    h.rerender(() => useDebounce('b', 300))
    // 直接 unmount 不会触发 act warning
    h.unmount()
    // 推进时间不应报错
    act(() => {
      vi.advanceTimersByTime(1000)
    })
  })
})
