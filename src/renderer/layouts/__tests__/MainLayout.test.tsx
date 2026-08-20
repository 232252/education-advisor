// =============================================================
// MainLayout — 全局键盘快捷键测试
// 验证: Ctrl/Cmd+1..9 切换导航、Ctrl+, 进设置、输入框聚焦时不触发
// =============================================================

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()

// 仅 mock useNavigate，其余 react-router-dom 能力(MemoryRouter/NavLink/Outlet/Routes/Route)用真实实现
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

// mock agentStore（ Zustand selector 风格：useAgentStore(selector) → selector(state)）
// getState() 供 useNotificationListener 挂载时订阅 agent 状态总线
vi.mock('../../stores/agent/store', () => {
  const mockState = {
    agents: [],
    fetchAgents: () => Promise.resolve(),
    initStatusListener: () => {},
    subscribeStatus: () => () => {},
  }
  return {
    useAgentStore: Object.assign((selector: (s: unknown) => unknown) => selector(mockState), {
      getState: () => mockState,
    }),
  }
})

import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MainLayout } from '../MainLayout'

function renderLayout(initial = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="*" element={<div data-testid="page">page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('MainLayout — 全局键盘快捷键', () => {
  beforeEach(() => {
    navigate.mockReset()
  })
  afterEach(() => cleanup())

  it('Ctrl+1 → /dashboard', () => {
    renderLayout()
    fireEvent.keyDown(window, { key: '1', ctrlKey: true })
    expect(navigate).toHaveBeenCalledWith('/dashboard')
  })

  it('Ctrl+2 → /chat', () => {
    renderLayout()
    fireEvent.keyDown(window, { key: '2', ctrlKey: true })
    expect(navigate).toHaveBeenCalledWith('/chat')
  })

  it('Ctrl+9 → /scheduler (第 9 项)', () => {
    renderLayout()
    fireEvent.keyDown(window, { key: '9', ctrlKey: true })
    expect(navigate).toHaveBeenCalledWith('/scheduler')
  })

  it('Cmd(meta)+3 → /students', () => {
    renderLayout()
    fireEvent.keyDown(window, { key: '3', metaKey: true })
    expect(navigate).toHaveBeenCalledWith('/students')
  })

  it('Ctrl+, → /settings', () => {
    renderLayout()
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    expect(navigate).toHaveBeenCalledWith('/settings')
  })

  it('无修饰键不触发导航', () => {
    renderLayout()
    fireEvent.keyDown(window, { key: '1' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('数字超出 1-9 不触发', () => {
    renderLayout()
    fireEvent.keyDown(window, { key: '0', ctrlKey: true })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('输入框聚焦时不触发(保护打字)', () => {
    const { container } = renderLayout()
    const input = document.createElement('input')
    container.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: '2', ctrlKey: true })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('textarea 聚焦时不触发', () => {
    const { container } = renderLayout()
    const ta = document.createElement('textarea')
    container.appendChild(ta)
    ta.focus()
    fireEvent.keyDown(ta, { key: '5', ctrlKey: true })
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('MainLayout — 可折叠侧边栏 (Ctrl+B)', () => {
  beforeEach(() => {
    navigate.mockReset()
    localStorage.clear()
  })
  afterEach(() => cleanup())

  it('初始渲染为展开态 (aside 含 w-60)', () => {
    const { container } = renderLayout()
    const aside = container.querySelector('aside')
    expect(aside).not.toBeNull()
    expect(aside?.className).toContain('w-60')
    expect(aside?.className).not.toContain('w-[68px]')
  })

  it('Ctrl+B 触发折叠 (aside 切换到 w-[68px] + localStorage 持久化)', () => {
    const { container } = renderLayout()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    const aside = container.querySelector('aside')
    expect(aside?.className).toContain('w-[68px]')
    expect(aside?.className).not.toContain('w-60')
    expect(localStorage.getItem('ea.sidebar.collapsed')).toBe('true')
  })

  it('再次 Ctrl+B 恢复展开', () => {
    const { container } = renderLayout()
    // 折叠
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(container.querySelector('aside')?.className).toContain('w-[68px]')
    // 展开
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(container.querySelector('aside')?.className).toContain('w-60')
    expect(localStorage.getItem('ea.sidebar.collapsed')).toBe('false')
  })

  it('Cmd+B (mac metaKey) 同样触发折叠', () => {
    const { container } = renderLayout()
    fireEvent.keyDown(window, { key: 'b', metaKey: true })
    expect(container.querySelector('aside')?.className).toContain('w-[68px]')
  })

  it('无修饰键的 b 不触发折叠', () => {
    const { container } = renderLayout()
    fireEvent.keyDown(window, { key: 'b' })
    expect(container.querySelector('aside')?.className).toContain('w-60')
  })

  it('输入框聚焦时 Ctrl+B 不触发 (保护打字)', () => {
    const { container } = renderLayout()
    const input = document.createElement('input')
    container.appendChild(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    expect(container.querySelector('aside')?.className).toContain('w-60')
    expect(localStorage.getItem('ea.sidebar.collapsed')).toBeNull()
  })

  it('localStorage 预设 collapsed=1 时初始为折叠态', () => {
    localStorage.setItem('ea.sidebar.collapsed', '1')
    const { container } = renderLayout()
    const aside = container.querySelector('aside')
    expect(aside?.className).toContain('w-[68px]')
  })

  it('折叠态下导航项文字隐藏 + 出现 title tooltip', () => {
    const { container } = renderLayout()
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    const navLinks = container.querySelectorAll('aside nav a')
    // 折叠态: 文本节点仍存在但 <span> 隐藏; 用 title 属性判断折叠态
    const withTitle = [...navLinks].filter((a) => a.getAttribute('title'))
    expect(withTitle.length).toBeGreaterThan(0)
  })

  it('展开态下导航项无 title (文字可见)', () => {
    const { container } = renderLayout()
    const navLinks = container.querySelectorAll('aside nav a')
    const withTitle = [...navLinks].filter((a) => a.getAttribute('title'))
    expect(withTitle.length).toBe(0)
  })

  it('折叠按钮存在且可点击切换', () => {
    const { container } = renderLayout()
    // 折叠/展开按钮带 title 含 Ctrl+B
    const toggleBtn = container.querySelector(
      'aside button[title*="Ctrl"]',
    ) as HTMLButtonElement | null
    expect(toggleBtn).not.toBeNull()
    fireEvent.click(toggleBtn as HTMLButtonElement)
    expect(container.querySelector('aside')?.className).toContain('w-[68px]')
  })
})
