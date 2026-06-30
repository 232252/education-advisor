// =============================================================
// Toast Store 测试 — push/dismiss/clear + 便捷方法
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useToastStore, toast } = await import('../../../src/renderer/stores/toastStore')

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push 应添加 toast 并返回 id', () => {
    const id = useToastStore.getState().push({ message: 'hello' })
    expect(id).toMatch(/toast-/)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('hello')
    expect(useToastStore.getState().toasts[0].type).toBe('info')
    expect(useToastStore.getState().toasts[0].durationMs).toBe(4000)
  })

  it('push 自定义 type/duration', () => {
    useToastStore.getState().push({ type: 'error', message: 'err', durationMs: 1000 })
    const t = useToastStore.getState().toasts[0]
    expect(t.type).toBe('error')
    expect(t.durationMs).toBe(1000)
  })

  it('durationMs=0 应不自动消失', () => {
    useToastStore.getState().push({ message: 'sticky', durationMs: 0 })
    vi.advanceTimersByTime(10000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('默认 duration 应自动 dismiss', () => {
    useToastStore.getState().push({ message: 'auto-dismiss' })
    vi.advanceTimersByTime(4500)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('dismiss 应移除指定 toast', () => {
    const id = useToastStore.getState().push({ message: 'x', durationMs: 0 })
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('clear 应清空所有 toasts', () => {
    useToastStore.getState().push({ message: 'a', durationMs: 0 })
    useToastStore.getState().push({ message: 'b', durationMs: 0 })
    useToastStore.getState().clear()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  describe('toast 便捷方法', () => {
    it('toast.success', () => {
      toast.success('saved')
      const t = useToastStore.getState().toasts[0]
      expect(t.type).toBe('success')
      expect(t.message).toBe('saved')
      expect(t.durationMs).toBe(3000)
    })

    it('toast.error', () => {
      toast.error('failed')
      const t = useToastStore.getState().toasts[0]
      expect(t.type).toBe('error')
      expect(t.durationMs).toBe(5000)
    })

    it('toast.warning', () => {
      toast.warning('warn')
      const t = useToastStore.getState().toasts[0]
      expect(t.type).toBe('warning')
    })

    it('toast.info', () => {
      toast.info('info')
      const t = useToastStore.getState().toasts[0]
      expect(t.type).toBe('info')
    })

    it('toast.show 默认 type=info', () => {
      toast.show('plain')
      const t = useToastStore.getState().toasts[0]
      expect(t.type).toBe('info')
    })
  })

  it('多个 push 应累积', () => {
    useToastStore.getState().push({ message: 'a', durationMs: 0 })
    useToastStore.getState().push({ message: 'b', durationMs: 0 })
    useToastStore.getState().push({ message: 'c', durationMs: 0 })
    expect(useToastStore.getState().toasts).toHaveLength(3)
  })
})
