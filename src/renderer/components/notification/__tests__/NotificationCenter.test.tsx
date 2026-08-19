// =============================================================
// NotificationCenter — 通知中心组件测试
// 验证: 铃铛入口/未读角标/面板开关/通知列表/标记已读/清空/外部点击关闭
// =============================================================

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotificationStore } from '../../../stores/notificationStore'
import { NotificationCenter } from '../NotificationCenter'

const navigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

function renderCenter() {
  return render(
    <MemoryRouter>
      <NotificationCenter />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useNotificationStore.getState().clear()
  navigate.mockReset()
})

afterEach(() => cleanup())

describe('NotificationCenter — 铃铛入口', () => {
  it('默认渲染铃铛按钮,面板关闭', () => {
    renderCenter()
    expect(screen.getByRole('button', { name: '通知中心' })).toBeDefined()
    // 面板未打开 — 无"清空"按钮
    expect(screen.queryByText('清空')).toBeNull()
  })

  it('无未读时不显示角标', () => {
    renderCenter()
    const bell = screen.getByRole('button', { name: '通知中心' })
    expect(bell.querySelector('span')).toBeNull()
  })

  it('有未读时显示角标数字', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'info', title: 'a' })
    useNotificationStore.getState().push({ source: 'cron', level: 'info', title: 'b' })
    renderCenter()
    const bell = screen.getByRole('button', { name: '通知中心' })
    expect(bell.textContent).toBe('2')
  })

  it('未读超过 99 显示 99+', () => {
    const s = useNotificationStore.getState()
    for (let i = 0; i < 120; i++) s.push({ source: 'system', level: 'info', title: `n${i}` })
    renderCenter()
    const bell = screen.getByRole('button', { name: '通知中心' })
    expect(bell.textContent).toBe('99+')
  })
})

describe('NotificationCenter — 面板交互', () => {
  it('点击铃铛打开面板,显示空状态', () => {
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    expect(screen.getByText('暂无通知')).toBeDefined()
  })

  it('面板显示通知标题与未读数', () => {
    useNotificationStore
      .getState()
      .push({ source: 'agent', level: 'error', title: 'Agent 运行失败' })
    useNotificationStore
      .getState()
      .push({ source: 'cron', level: 'success', title: '飞书同步完成' })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    expect(screen.getByText('Agent 运行失败')).toBeDefined()
    expect(screen.getByText('飞书同步完成')).toBeDefined()
    expect(screen.getByText(/2 条未读/)).toBeDefined()
  })

  it('点击通知标记已读,角标减少', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'info', title: 'click me' })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    fireEvent.click(screen.getByText('click me'))
    const items = useNotificationStore.getState().notifications
    expect(items[0].read).toBe(true)
    const bell = screen.getByRole('button', { name: '通知中心' })
    expect(bell.querySelector('span')).toBeNull()
  })

  it('点击带 target 的通知跳转并关闭面板', () => {
    useNotificationStore.getState().push({
      source: 'cron',
      level: 'error',
      title: '任务失败',
      target: '/scheduler',
    })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    fireEvent.click(screen.getByText('任务失败'))
    expect(navigate).toHaveBeenCalledWith('/scheduler')
    expect(screen.queryByText('任务失败')).toBeNull() // 面板已关闭
  })

  it('全部已读按钮清零未读数', () => {
    const s = useNotificationStore.getState()
    s.push({ source: 'agent', level: 'info', title: 'a' })
    s.push({ source: 'cron', level: 'info', title: 'b' })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    fireEvent.click(screen.getByText('全部已读'))
    expect(useNotificationStore.getState().notifications.every((n) => n.read)).toBe(true)
    const bell = screen.getByRole('button', { name: '通知中心' })
    expect(bell.querySelector('span')).toBeNull()
  })

  it('清空按钮移除全部通知', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'info', title: 'a' })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    fireEvent.click(screen.getByText('清空'))
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
    expect(screen.getByText('暂无通知')).toBeDefined()
  })

  it('单条删除按钮移除该通知', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'info', title: 'to delete' })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('点击面板外部关闭', () => {
    useNotificationStore.getState().push({ source: 'agent', level: 'info', title: 'x' })
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    expect(screen.getByText('x')).toBeDefined()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('x')).toBeNull() // 面板关闭后列表不再渲染
  })

  it('Escape 关闭面板', () => {
    renderCenter()
    fireEvent.click(screen.getByRole('button', { name: '通知中心' }))
    expect(screen.getByText('暂无通知')).toBeDefined()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('暂无通知')).toBeNull()
  })
})
