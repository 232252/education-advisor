// =============================================================
// M-5 回归测试: useLocalStorage setItem 失败时不应更新内存状态
// 并验证 StorageEvent 携带 newValue 字段
// 使用 @testing-library/react (React 18) 的 renderHook
// =============================================================

import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'

import { useLocalStorage } from '../../../src/renderer/hooks/useLocalStorage'

/** 创建会抛错的 localStorage mock */
function createThrowingLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key]
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
}

/** 创建正常的 localStorage mock */
function createNormalLocalStorage() {
  const store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value)
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key]
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length
    },
  }
}

describe('M-5: useLocalStorage setItem 失败处理', () => {
  let originalLocalStorage: Storage

  beforeEach(() => {
    originalLocalStorage = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      value: createNormalLocalStorage(),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
    vi.restoreAllMocks()
  })

  it('初始值正确读取', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'))
    expect(result.current[0]).toBe('initial')
  })

  it('setValue 正常写入 localStorage + 更新内存', () => {
    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'))
    act(() => {
      result.current[1]('updated')
    })
    expect(result.current[0]).toBe('updated')
    expect(localStorage.getItem('test-key')).toBe(JSON.stringify('updated'))
  })

  it('M-5: setItem 抛错时,内存状态保持不变', () => {
    // 替换为抛错的 localStorage
    Object.defineProperty(window, 'localStorage', {
      value: createThrowingLocalStorage(),
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'))

    act(() => {
      result.current[1]('should-not-apply')
    })

    // 内存状态应保持原值,不应该被更新为 'should-not-apply'
    expect(result.current[0]).toBe('initial')
  })

  it('M-5: setItem 抛错时不会抛出未捕获异常', () => {
    Object.defineProperty(window, 'localStorage', {
      value: createThrowingLocalStorage(),
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useLocalStorage('test-key', 'initial'))

    // 不应抛出异常
    expect(() => {
      act(() => {
        result.current[1]({ count: 999 })
      })
    }).not.toThrow()
  })

  it('M-5: 函数式更新 setItem 失败时也不更新内存', () => {
    // 先用正常 localStorage 设置一次
    const { result } = renderHook(() => useLocalStorage<number>('counter', 0))

    act(() => {
      result.current[1]((prev) => prev + 1)
    })
    expect(result.current[0]).toBe(1)

    // 替换为抛错的 localStorage
    Object.defineProperty(window, 'localStorage', {
      value: createThrowingLocalStorage(),
      writable: true,
      configurable: true,
    })

    act(() => {
      result.current[1]((prev) => prev + 1)
    })

    // 应该保持 1,不应该变成 2
    expect(result.current[0]).toBe(1)
  })

  it('M-5: 成功写入时触发 storage 事件且包含 newValue', () => {
    const { result } = renderHook(() => useLocalStorage('event-test', 'initial'))

    const storageEventSpy = vi.fn()
    window.addEventListener('storage', storageEventSpy)

    act(() => {
      result.current[1]('new-value')
    })

    // 应该触发 storage 事件
    expect(storageEventSpy).toHaveBeenCalled()
    const event = storageEventSpy.mock.calls[0][0] as StorageEvent
    expect(event.key).toBe('event-test')
    expect(event.newValue).toBe(JSON.stringify('new-value'))

    window.removeEventListener('storage', storageEventSpy)
  })

  it('M-5: setItem 失败时不触发 storage 事件(因为内存未变)', () => {
    Object.defineProperty(window, 'localStorage', {
      value: createThrowingLocalStorage(),
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useLocalStorage('no-event', 'initial'))

    const storageEventSpy = vi.fn()
    window.addEventListener('storage', storageEventSpy)

    act(() => {
      result.current[1]('should-fail')
    })

    // setItem 失败时不应该触发 storage 事件(因为状态没有变更)
    expect(storageEventSpy).not.toHaveBeenCalled()

    window.removeEventListener('storage', storageEventSpy)
  })

  it('跨标签页同步: 监听 storage 事件后可同步状态', async () => {
    const { result, unmount } = renderHook(() => useLocalStorage('sync-test', 'original'))

    // 模拟另一个标签页触发的 storage 事件
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'sync-test',
          newValue: JSON.stringify('updated-by-other-tab'),
        }),
      )
    })

    expect(result.current[0]).toBe('updated-by-other-tab')
    unmount()
  })

  it('跨标签页同步: 忽略 null newValue', async () => {
    const { result, unmount } = renderHook(() => useLocalStorage('null-test', 'keep-me'))

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'null-test',
          newValue: null,
        }),
      )
    })

    // 不应该被 null 覆盖
    expect(result.current[0]).toBe('keep-me')
    unmount()
  })

  it('跨标签页同步: 忽略其他 key 的事件', async () => {
    const { result, unmount } = renderHook(() => useLocalStorage('my-key', 'mine'))

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'other-key',
          newValue: JSON.stringify('not-mine'),
        }),
      )
    })

    expect(result.current[0]).toBe('mine')
    unmount()
  })

  it('解析失败时回退到原值', () => {
    localStorage.setItem('bad-json', '{not-valid-json')

    const { result, unmount } = renderHook(() => useLocalStorage('bad-json', 'fallback'))

    // 读取时 JSON.parse 失败,应回退到 initialValue
    expect(result.current[0]).toBe('fallback')
    unmount()
  })
})
