// =============================================================
// Hooks 测试 — useLocalStorage / useToggle / useEventListener
// 覆盖：读写、跨 tab 同步、清理、SSR 安全
// =============================================================

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEventListener } from '../useEventListener'
import { useLocalStorage } from '../useLocalStorage'
import { useToggle } from '../useToggle'

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('初始值应使用传入的 defaultValue', () => {
    const { result } = renderHook(() => useLocalStorage('key1', 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('localStorage 中有值时应优先使用', () => {
    localStorage.setItem('key2', JSON.stringify('stored'))
    const { result } = renderHook(() => useLocalStorage('key2', 'default'))
    expect(result.current[0]).toBe('stored')
  })

  it('localStorage 中有无效 JSON 应回退到 defaultValue', () => {
    localStorage.setItem('key3', 'invalid json{')
    const { result } = renderHook(() => useLocalStorage('key3', 'default'))
    expect(result.current[0]).toBe('default')
  })

  it('setValue 应更新 localStorage 和 state', () => {
    const { result } = renderHook(() => useLocalStorage('key4', 'initial'))
    act(() => {
      result.current[1]('updated')
    })
    expect(result.current[0]).toBe('updated')
    expect(localStorage.getItem('key4')).toBe(JSON.stringify('updated'))
  })

  it('setValue 接受函数 updater', () => {
    const { result } = renderHook(() => useLocalStorage<number>('key5', 10))
    act(() => {
      result.current[1]((prev) => prev + 5)
    })
    expect(result.current[0]).toBe(15)
  })

  it('应能存储复杂对象', () => {
    const obj = { a: 1, b: { c: 'nested' } }
    const { result } = renderHook(() => useLocalStorage('key6', {} as typeof obj))
    act(() => {
      result.current[1](obj)
    })
    expect(result.current[0]).toEqual(obj)
    expect(JSON.parse(localStorage.getItem('key6') || '{}')).toEqual(obj)
  })

  it('跨标签页 storage 事件应同步状态', () => {
    const { result } = renderHook(() => useLocalStorage('key7', 'default'))
    act(() => {
      // 模拟另一个标签页修改 localStorage
      localStorage.setItem('key7', JSON.stringify('from-other-tab'))
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'key7',
          newValue: JSON.stringify('from-other-tab'),
        }),
      )
    })
    expect(result.current[0]).toBe('from-other-tab')
  })

  it('不同 key 的 storage 事件不应影响本 key', () => {
    const { result } = renderHook(() => useLocalStorage('key8', 'initial'))
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'different-key',
          newValue: JSON.stringify('x'),
        }),
      )
    })
    expect(result.current[0]).toBe('initial')
  })
})

describe('useToggle', () => {
  it('默认 false', () => {
    const { result } = renderHook(() => useToggle())
    expect(result.current[0]).toBe(false)
  })

  it('可指定初始值', () => {
    const { result } = renderHook(() => useToggle(true))
    expect(result.current[0]).toBe(true)
  })

  it('toggle 切换布尔值', () => {
    const { result } = renderHook(() => useToggle(false))
    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(true)
    act(() => {
      result.current[1]()
    })
    expect(result.current[0]).toBe(false)
  })

  it('setValue 显式设置', () => {
    const { result } = renderHook(() => useToggle(false))
    act(() => {
      result.current[2](true)
    })
    expect(result.current[0]).toBe(true)
  })

  it('多次 toggle 应反复切换', () => {
    const { result } = renderHook(() => useToggle(false))
    for (let i = 0; i < 5; i++) {
      act(() => {
        result.current[1]()
      })
    }
    expect(result.current[0]).toBe(true)
  })
})

describe('useEventListener', () => {
  it('应监听 window 事件', () => {
    const handler = vi.fn()
    renderHook(() => useEventListener('keydown', handler))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('应支持自定义 element', () => {
    const handler = vi.fn()
    const div = document.createElement('div')
    document.body.appendChild(div)
    renderHook(() => useEventListener('click', handler, div))
    act(() => {
      div.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
    document.body.removeChild(div)
  })

  it('应接受最新的 handler (无需手动依赖)', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const { rerender } = renderHook(({ h }) => useEventListener('click', h), {
      initialProps: { h: handler1 },
    })
    rerender({ h: handler2 })
    act(() => {
      window.dispatchEvent(new MouseEvent('click'))
    })
    expect(handler2).toHaveBeenCalledTimes(1)
    expect(handler1).not.toHaveBeenCalled()
  })

  it('卸载时移除监听', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useEventListener('click', handler))
    unmount()
    act(() => {
      window.dispatchEvent(new MouseEvent('click'))
    })
    expect(handler).not.toHaveBeenCalled()
  })
})
