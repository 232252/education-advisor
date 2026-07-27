// =============================================================
// useDebounce / useToggle / useEventListener / useLocalStorage — hooks 测试
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebounce } from '../../hooks/useDebounce'
import { useEventListener } from '../../hooks/useEventListener'
import { useLocalStorage } from '../../hooks/useLocalStorage'
import { useToggle } from '../../hooks/useToggle'

// ===========================================================
// useDebounce
// ===========================================================

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('初始值立即返回', () => {
    const { result } = renderHook(() => useDebounce('initial', 300))
    expect(result.current).toBe('initial')
  })

  it('值变化后延迟更新', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    })
    rerender({ v: 'b' })
    // Not yet updated (within delay)
    expect(result.current).toBe('a')
    // Advance time
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe('b')
  })

  it('快速连续变化只取最后值', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    })
    rerender({ v: 'b' })
    rerender({ v: 'c' })
    rerender({ v: 'd' })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe('d')
  })

  it('值变化后未到延迟时间 → 仍为旧值', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 500), {
      initialProps: { v: 'a' },
    })
    rerender({ v: 'b' })
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(result.current).toBe('a')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('b')
  })

  it('卸载时清除 timer', () => {
    const { result, rerender, unmount } = renderHook(({ v }) => useDebounce(v, 300), {
      initialProps: { v: 'a' },
    })
    rerender({ v: 'b' })
    unmount()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // After unmount, result should still be 'a' (never updated)
    expect(result.current).toBe('a')
  })

  it('数字类型', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: 0 },
    })
    rerender({ v: 42 })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe(42)
  })

  it('对象类型', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: { x: 1 } },
    })
    rerender({ v: { x: 2 } })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toEqual({ x: 2 })
  })

  it('默认延迟 300ms', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v), {
      initialProps: { v: 'a' },
    })
    rerender({ v: 'b' })
    act(() => vi.advanceTimersByTime(299))
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe('b')
  })
})

// ===========================================================
// useToggle
// ===========================================================

describe('useToggle', () => {
  it('默认初始 false', () => {
    const { result } = renderHook(() => useToggle())
    expect(result.current[0]).toBe(false)
  })

  it('指定初始 true', () => {
    const { result } = renderHook(() => useToggle(true))
    expect(result.current[0]).toBe(true)
  })

  it('toggle() 切换 false→true', () => {
    const { result } = renderHook(() => useToggle(false))
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
  })

  it('toggle() 切换 true→false', () => {
    const { result } = renderHook(() => useToggle(true))
    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
  })

  it('多次 toggle', () => {
    const { result } = renderHook(() => useToggle(false))
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(false)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
  })

  it('setOpen(true) 直接设置', () => {
    const { result } = renderHook(() => useToggle(false))
    act(() => result.current[2](true))
    expect(result.current[0]).toBe(true)
  })

  it('setOpen(false) 直接设置', () => {
    const { result } = renderHook(() => useToggle(true))
    act(() => result.current[2](false))
    expect(result.current[0]).toBe(false)
  })

  it('setOpen 不重复设置(已为 true)', () => {
    const { result } = renderHook(() => useToggle(true))
    act(() => result.current[2](true))
    expect(result.current[0]).toBe(true)
  })

  it('toggle 引用稳定(useCallback)', () => {
    const { result, rerender } = renderHook(() => useToggle(false))
    const first = result.current[1]
    rerender()
    expect(result.current[1]).toBe(first)
  })
})

// ===========================================================
// useEventListener
// ===========================================================

describe('useEventListener', () => {
  it('添加事件监听器', () => {
    const handler = vi.fn()
    renderHook(() => useEventListener('click', handler))
    act(() => {
      window.dispatchEvent(new Event('click'))
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('多次触发事件', () => {
    const handler = vi.fn()
    renderHook(() => useEventListener('scroll', handler))
    act(() => {
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('scroll'))
      window.dispatchEvent(new Event('scroll'))
    })
    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('卸载后移除监听器', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useEventListener('resize', handler))
    unmount()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('handler 更新后使用新 handler', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const { rerender } = renderHook(({ h }) => useEventListener('click', h), {
      initialProps: { h: handler1 },
    })
    rerender({ h: handler2 })
    act(() => {
      window.dispatchEvent(new Event('click'))
    })
    expect(handler1).not.toHaveBeenCalled()
    expect(handler2).toHaveBeenCalledTimes(1)
  })

  it('eventName 变化 → 重新绑定', () => {
    const handler = vi.fn()
    const { rerender } = renderHook(({ name }) => useEventListener(name, handler), {
      initialProps: { name: 'click' as string },
    })
    rerender({ name: 'scroll' })
    act(() => {
      window.dispatchEvent(new Event('click'))
    })
    expect(handler).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('element=null → 不绑定', () => {
    const handler = vi.fn()
    renderHook(() => useEventListener('click', handler, null))
    act(() => {
      window.dispatchEvent(new Event('click'))
    })
    expect(handler).not.toHaveBeenCalled()
  })
})

// ===========================================================
// useLocalStorage
// ===========================================================

describe('useLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  it('初始值(key 不存在)', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('setValue 更新值', () => {
    const { result } = renderHook(() => useLocalStorage('my-key', ''))
    act(() => result.current[1]('new value'))
    expect(result.current[0]).toBe('new value')
    expect(window.localStorage.getItem('my-key')).toBe(JSON.stringify('new value'))
  })

  it('key 已存在 → 读取存储值', () => {
    window.localStorage.setItem('persisted', JSON.stringify('stored value'))
    const { result } = renderHook(() => useLocalStorage('persisted', 'default'))
    expect(result.current[0]).toBe('stored value')
  })

  it('函数式更新', () => {
    const { result } = renderHook(() => useLocalStorage('counter', 0))
    act(() => result.current[1]((prev) => prev + 1))
    expect(result.current[0]).toBe(1)
    act(() => result.current[1]((prev) => prev + 10))
    expect(result.current[0]).toBe(11)
  })

  it('对象值', () => {
    const { result } = renderHook(() => useLocalStorage<{ a: number; b?: number }>('obj', { a: 1 }))
    act(() => result.current[1]({ a: 2, b: 3 }))
    expect(result.current[0]).toEqual({ a: 2, b: 3 })
    expect(JSON.parse(window.localStorage.getItem('obj') ?? 'null')).toEqual({ a: 2, b: 3 })
  })

  it('数组值', () => {
    const { result } = renderHook(() => useLocalStorage<number[]>('arr', []))
    act(() => result.current[1]([1, 2, 3]))
    expect(result.current[0]).toEqual([1, 2, 3])
  })

  it('布尔值', () => {
    const { result } = renderHook(() => useLocalStorage('bool', false))
    act(() => result.current[1](true))
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem('bool')).toBe('true')
  })

  it('setValue 派发 storage 事件', () => {
    const storageHandler = vi.fn()
    window.addEventListener('storage', storageHandler)
    const { result } = renderHook(() => useLocalStorage('evt-test', ''))
    act(() => result.current[1]('triggered'))
    expect(storageHandler).toHaveBeenCalled()
    window.removeEventListener('storage', storageHandler)
  })

  it('JSON 解析失败 → 回退到 initialValue', () => {
    window.localStorage.setItem('broken', '{invalid json')
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useLocalStorage('broken', 'fallback'))
    expect(result.current[0]).toBe('fallback')
    consoleSpy.mockRestore()
  })

  it('null 值(key 存在但值为 null)', () => {
    window.localStorage.setItem('null-val', 'null')
    const { result } = renderHook(() => useLocalStorage('null-val', 'default'))
    expect(result.current[0]).toBeNull()
  })

  it('setValue 引用稳定', () => {
    const { result, rerender } = renderHook(() => useLocalStorage('stable', ''))
    const first = result.current[1]
    rerender()
    expect(result.current[1]).toBe(first)
  })
})
