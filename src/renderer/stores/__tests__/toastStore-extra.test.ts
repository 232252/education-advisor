// =============================================================
// Toast Store 补充 — 自动消失 / clear / 便捷方法 / 多 toast
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { useToastStore, toast } = await import('../toastStore')

describe('toastStore 补充 — 自动消失与定时器', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })
  afterEach(() => {
    toast.clear()
    vi.useRealTimers()
  })

  it('durationMs 后 toast 自动消失', () => {
    useToastStore.getState().push({ message: 'temp', durationMs: 3000 })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(3000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('durationMs=0 不自动消失', () => {
    useToastStore.getState().push({ message: 'persistent', durationMs: 0 })
    vi.advanceTimersByTime(100000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('dismiss 在自动消失前调用应取消定时器', () => {
    const id = useToastStore.getState().push({ message: 'x', durationMs: 5000 })
    useToastStore.getState().dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
    // 推进时间不应报错(定时器已清理)
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })

  it('clear 清理所有 toast 和定时器', () => {
    useToastStore.getState().push({ message: 'a', durationMs: 5000 })
    useToastStore.getState().push({ message: 'b', durationMs: 5000 })
    useToastStore.getState().push({ message: 'c', durationMs: 5000 })
    expect(useToastStore.getState().toasts).toHaveLength(3)
    useToastStore.getState().clear()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    // 定时器已清理,推进时间不报错
    expect(() => vi.advanceTimersByTime(10000)).not.toThrow()
  })
})

describe('toastStore 补充 — 便捷方法', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })
  afterEach(() => {
    toast.clear()
    vi.useRealTimers()
  })

  it('toast.success 设置 type=success', () => {
    toast.success('done')
    expect(useToastStore.getState().toasts[0].type).toBe('success')
    expect(useToastStore.getState().toasts[0].message).toBe('done')
  })

  it('toast.error 设置 type=error', () => {
    toast.error('failed')
    expect(useToastStore.getState().toasts[0].type).toBe('error')
  })

  it('toast.warning 设置 type=warning', () => {
    toast.warning('careful')
    expect(useToastStore.getState().toasts[0].type).toBe('warning')
  })

  it('toast.info 设置 type=info', () => {
    toast.info('note')
    expect(useToastStore.getState().toasts[0].type).toBe('info')
  })

  it('toast.show 默认 type=info', () => {
    toast.show('hello')
    expect(useToastStore.getState().toasts[0].type).toBe('info')
  })

  it('toast.show 可自定义 type', () => {
    toast.show('hello', 'success')
    expect(useToastStore.getState().toasts[0].type).toBe('success')
  })

  it('toast.dismiss 通过 id 移除', () => {
    const id = toast.success('x')
    toast.dismiss(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('toast.clear 清空', () => {
    toast.success('a')
    toast.error('b')
    toast.clear()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

describe('toastStore 补充 — 多 toast 与边界', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })
  afterEach(() => {
    toast.clear()
    vi.useRealTimers()
  })

  it('多个 toast 共存', () => {
    toast.info('a')
    toast.success('b')
    toast.error('c')
    toast.warning('d')
    expect(useToastStore.getState().toasts).toHaveLength(4)
    const types = useToastStore.getState().toasts.map((t) => t.type)
    expect(types).toEqual(['info', 'success', 'error', 'warning'])
  })

  it('每个 toast 有唯一 id', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10; i++) {
      ids.add(useToastStore.getState().push({ message: `t${i}` }))
    }
    expect(ids.size).toBe(10)
  })

  it('dismiss 不存在的 id 不报错', () => {
    expect(() => useToastStore.getState().dismiss('nonexistent')).not.toThrow()
  })

  it('不同 durationMs 的 toast 独立消失', () => {
    useToastStore.getState().push({ message: 'short', durationMs: 1000 })
    useToastStore.getState().push({ message: 'long', durationMs: 5000 })
    vi.advanceTimersByTime(1000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].message).toBe('long')
    vi.advanceTimersByTime(4000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('空消息 toast 仍可创建', () => {
    const id = useToastStore.getState().push({ message: '' })
    expect(id).toMatch(/toast-/)
    expect(useToastStore.getState().toasts[0].message).toBe('')
  })

  it('超长消息 toast 正常创建', () => {
    const long = 'x'.repeat(10000)
    useToastStore.getState().push({ message: long })
    expect(useToastStore.getState().toasts[0].message.length).toBe(10000)
  })
})
