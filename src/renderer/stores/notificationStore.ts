// =============================================================
// Notification Store — 通知中心 (Zustand + localStorage 持久化)
// 集中收集 Agent 运行结果 / 定时任务(cron)执行结果 / 系统事件。
// 容量上限 100 条,超出丢弃最旧;重启后恢复最近通知。
// 用法:
//   const items = useNotificationStore((s) => s.notifications)
//   useNotificationStore.getState().push({ source: 'agent', level: 'success', title: '...' })
// =============================================================

import { create } from 'zustand'

export type NotificationSource = 'agent' | 'cron' | 'system'
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export interface NotificationItem {
  id: string
  source: NotificationSource
  level: NotificationLevel
  title: string
  /** 详情(错误信息/输出摘要) */
  message?: string
  createdAt: number
  read: boolean
  /** 可选跳转目标(如 /agents?agent_id=xxx) */
  target?: string
}

/** 持久化上限 */
const MAX_ITEMS = 100
const STORAGE_KEY = 'ea.notifications.v1'

let counter = 0
const nextId = () => `ntf-${Date.now()}-${++counter}`

function loadPersisted(): NotificationItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (n): n is NotificationItem =>
        n != null &&
        typeof n.id === 'string' &&
        typeof n.title === 'string' &&
        typeof n.createdAt === 'number',
    )
  } catch {
    return []
  }
}

function persist(items: NotificationItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch {
    /* localStorage 不可用时静默降级(仅内存态) */
  }
}

interface NotificationState {
  notifications: NotificationItem[]
  push: (n: Omit<NotificationItem, 'id' | 'createdAt' | 'read'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clear: () => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: loadPersisted(),

  push: (n) => {
    set((s) => {
      const items = [{ ...n, id: nextId(), createdAt: Date.now(), read: false }, ...s.notifications]
      const trimmed = items.length > MAX_ITEMS ? items.slice(0, MAX_ITEMS) : items
      persist(trimmed)
      return { notifications: trimmed }
    })
  },

  markRead: (id) => {
    set((s) => {
      const items = s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
      persist(items)
      return { notifications: items }
    })
  },

  markAllRead: () => {
    set((s) => {
      const items = s.notifications.map((n) => ({ ...n, read: true }))
      persist(items)
      return { notifications: items }
    })
  },

  remove: (id) => {
    set((s) => {
      const items = s.notifications.filter((n) => n.id !== id)
      persist(items)
      return { notifications: items }
    })
  },

  clear: () => {
    persist([])
    set({ notifications: [] })
  },
}))

/** 未读数 selector 组件用: useNotificationStore(selectUnreadCount) */
export const selectUnreadCount = (s: NotificationState): number =>
  s.notifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0)
