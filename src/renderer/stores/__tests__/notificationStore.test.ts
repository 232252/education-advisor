// =============================================================
// notificationStore — 通知中心 store 测试
// 验证: push/markRead/markAllRead/remove/clear + 容量上限 + localStorage 持久化
// =============================================================

import { beforeEach, describe, expect, it } from 'vitest'
import { selectUnreadCount, useNotificationStore } from '../notificationStore'

const STORAGE_KEY = 'ea.notifications.v1'

beforeEach(() => {
  localStorage.clear()
  useNotificationStore.getState().clear()
})

describe('notificationStore — push', () => {
  it('push 后通知出现在列表头部,未读', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'success', title: 'T1' })
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('T1')
    expect(items[0].read).toBe(false)
    expect(items[0].id).toMatch(/^ntf-/)
    expect(typeof items[0].createdAt).toBe('number')
  })

  it('多次 push 保持最新在前', () => {
    const s = useNotificationStore.getState()
    s.push({ source: 'agent', level: 'info', title: 'first' })
    s.push({ source: 'cron', level: 'warning', title: 'second' })
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('second')
    expect(items[1].title).toBe('first')
  })

  it('容量上限 100 条,超出丢弃最旧', () => {
    const s = useNotificationStore.getState()
    for (let i = 0; i < 105; i++) {
      s.push({ source: 'system', level: 'info', title: `n${i}` })
    }
    const items = useNotificationStore.getState().notifications
    expect(items).toHaveLength(100)
    // 最新的 n104 在头部,最旧的 n0 被丢弃
    expect(items[0].title).toBe('n104')
    expect(items.some((n) => n.title === 'n0')).toBe(false)
    expect(items.some((n) => n.title === 'n5')).toBe(true)
  })

  it('push 持久化到 localStorage', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'error', title: '持久化' })
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw as string)
    expect(parsed[0].title).toBe('持久化')
  })
})

describe('notificationStore — 已读管理', () => {
  it('markRead 标记单条已读', () => {
    const s = useNotificationStore.getState()
    s.push({ source: 'agent', level: 'info', title: 'a' })
    s.push({ source: 'cron', level: 'info', title: 'b' })
    const [newest, oldest] = useNotificationStore.getState().notifications
    useNotificationStore.getState().markRead(newest.id)
    const items = useNotificationStore.getState().notifications
    expect(items.find((n) => n.id === newest.id)?.read).toBe(true)
    expect(items.find((n) => n.id === oldest.id)?.read).toBe(false)
  })

  it('markAllRead 全部标记已读', () => {
    const s = useNotificationStore.getState()
    s.push({ source: 'agent', level: 'info', title: 'a' })
    s.push({ source: 'cron', level: 'info', title: 'b' })
    useNotificationStore.getState().markAllRead()
    expect(useNotificationStore.getState().notifications.every((n) => n.read)).toBe(true)
  })

  it('selectUnreadCount 统计未读数', () => {
    const s = useNotificationStore.getState()
    s.push({ source: 'agent', level: 'info', title: 'a' })
    s.push({ source: 'cron', level: 'info', title: 'b' })
    s.push({ source: 'system', level: 'info', title: 'c' })
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(3)
    const first = useNotificationStore.getState().notifications[0]
    useNotificationStore.getState().markRead(first.id)
    expect(selectUnreadCount(useNotificationStore.getState())).toBe(2)
  })
})

describe('notificationStore — 删除与清空', () => {
  it('remove 删除指定通知', () => {
    const s = useNotificationStore.getState()
    s.push({ source: 'agent', level: 'info', title: 'a' })
    s.push({ source: 'cron', level: 'info', title: 'b' })
    const items = useNotificationStore.getState().notifications
    useNotificationStore.getState().remove(items[0].id)
    const rest = useNotificationStore.getState().notifications
    expect(rest).toHaveLength(1)
    expect(rest[0].title).toBe('a')
  })

  it('clear 清空全部并持久化空数组', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'info', title: 'a' })
    useNotificationStore.getState().clear()
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]')
  })
})
