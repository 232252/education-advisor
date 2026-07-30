// =============================================================
// useTheme — 主题管理 hook 测试
// =============================================================

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTheme } from '../../hooks/useTheme'

beforeEach(() => {
  document.documentElement.className = ''
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  window.api = {
    settings: {
      get: vi.fn().mockResolvedValue({ general: { theme: 'dark' } }),
      set: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      onUpdate: vi.fn(),
    },
  } as unknown as typeof window.api
})

afterEach(() => {
  document.documentElement.className = ''
  vi.restoreAllMocks()
})

describe('useTheme — 初始加载', () => {
  it('settings.theme=dark → 添加 dark class', async () => {
    const { result } = renderHook(() => useTheme())
    await waitFor(() => expect(result.current).toBe('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('settings.theme=light → 移除 dark class', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue({ general: { theme: 'light' } })
    const { result } = renderHook(() => useTheme())
    await waitFor(() => expect(result.current).toBe('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('settings 加载失败 → 回退到 light', async () => {
    window.api.settings.get = vi.fn().mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useTheme())
    // R169 起回退默认 light(与 settings-service / index.html 防 FOUC 一致)
    await waitFor(() => expect(result.current).toBe('light'))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('useTheme — theme-changed 事件', () => {
  it('收到 theme-changed(light) → 应用 light', async () => {
    const { result } = renderHook(() => useTheme())
    await waitFor(() => expect(result.current).toBe('dark'))
    act(() => {
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }))
    })
    expect(result.current).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('收到 theme-changed(dark) → 应用 dark', async () => {
    window.api.settings.get = vi.fn().mockResolvedValue({ general: { theme: 'light' } })
    const { result } = renderHook(() => useTheme())
    await waitFor(() => expect(result.current).toBe('light'))
    act(() => {
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }))
    })
    expect(result.current).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('卸载后不响应 theme-changed', async () => {
    const { result, unmount } = renderHook(() => useTheme())
    await waitFor(() => expect(result.current).toBe('dark'))
    unmount()
    act(() => {
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }))
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('useTheme — dark class 管理', () => {
  it('初始 dark class 被 dark theme 添加', async () => {
    renderHook(() => useTheme())
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  })

  it('dark → light → dark 循环切换', async () => {
    const { result } = renderHook(() => useTheme())
    await waitFor(() => expect(result.current).toBe('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => {
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'light' }))
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)

    act(() => {
      window.dispatchEvent(new CustomEvent('theme-changed', { detail: 'dark' }))
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('useTheme — 默认值', () => {
  it('mount 前默认 light', () => {
    ;(window.api.settings.get as unknown) = vi.fn(() => new Promise(() => {}))
    const { result } = renderHook(() => useTheme())
    // R169 起挂载前默认 light(白主题默认,黑主题可切换)
    expect(result.current).toBe('light')
  })
})
