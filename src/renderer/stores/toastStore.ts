// =============================================================
// Toast Store — 全局通知 (Zustand)
// 修复 P2-8: 替换散落的 console.error,用户能看到错误提示
// 用法：
//   import { useToastStore } from '../../stores/toastStore'
//   const push = useToastStore((s) => s.push)
//   push({ type: 'error', message: '加载失败' })
//   push({ type: 'success', message: '已保存' })
// =============================================================

import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'error' | 'warning'

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  /** 自动消失时间(ms),0 表示不自动消失 */
  durationMs: number
  /** 创建时间(用于排查) */
  createdAt: number
}

interface ToastState {
  toasts: ToastItem[]
  push: (toast: { type?: ToastType; message: string; durationMs?: number }) => string
  dismiss: (id: string) => void
  clear: () => void
}

let counter = 0
const nextId = () => `toast-${Date.now()}-${++counter}`

/** Medium 修复: 保存 toast 自动消失的 timer id,dismiss 时清理,避免资源泄漏 */
const toastTimers = new Map<string, number>()

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (toast) => {
    const id = nextId()
    const item: ToastItem = {
      id,
      type: toast.type ?? 'info',
      message: toast.message,
      durationMs: toast.durationMs ?? 4000,
      createdAt: Date.now(),
    }
    set((s) => ({ toasts: [...s.toasts, item] }))

    if (item.durationMs > 0 && typeof window !== 'undefined') {
      // P2-6 同理:用 window.setTimeout 以保证 SSR/test 环境可被 mock
      const timerId = window.setTimeout(() => {
        toastTimers.delete(id)
        get().dismiss(id)
      }, item.durationMs)
      toastTimers.set(id, timerId)
    }

    return id
  },

  dismiss: (id) => {
    // Medium 修复: 清理未触发的 timer,避免已 dismiss 的 toast 重复触发 dismiss
    const timerId = toastTimers.get(id)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      toastTimers.delete(id)
    }
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  // MEDIUM 修复: clear() 同步清理 toastTimers Map,避免已设置但未触发的定时器泄漏
  clear: () => {
    for (const timerId of toastTimers.values()) {
      window.clearTimeout(timerId)
    }
    toastTimers.clear()
    set({ toasts: [] })
  },
}))

// 便捷静态方法(用于非组件上下文)
// 注意:这些方法直接操作 store,无需 React hook
export const toast = {
  show: (message: string, type: ToastType = 'info', durationMs = 4000) =>
    useToastStore.getState().push({ type, message, durationMs }),
  success: (message: string, durationMs = 3000) =>
    useToastStore.getState().push({ type: 'success', message, durationMs }),
  error: (message: string, durationMs = 5000) =>
    useToastStore.getState().push({ type: 'error', message, durationMs }),
  warning: (message: string, durationMs = 4000) =>
    useToastStore.getState().push({ type: 'warning', message, durationMs }),
  info: (message: string, durationMs = 4000) =>
    useToastStore.getState().push({ type: 'info', message, durationMs }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
}
