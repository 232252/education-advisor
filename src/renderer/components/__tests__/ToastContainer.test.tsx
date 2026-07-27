// =============================================================
// ToastContainer — Toast 通知容器组件测试
// =============================================================

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../stores/toastStore'
import { ToastContainer } from '../ToastContainer'

// Helper to reset store between tests
beforeEach(() => {
  useToastStore.getState().clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ToastContainer — 空', () => {
  it('无 toast 时不渲染', () => {
    const { container } = render(<ToastContainer />)
    expect(container.querySelector('.toast-container')).toBeNull()
  })

  it('无 toast 时返回 null', () => {
    const { container } = render(<ToastContainer />)
    expect(container.innerHTML).toBe('')
  })
})

describe('ToastContainer — 单条 toast', () => {
  it('显示 info toast', () => {
    useToastStore.getState().push({ message: '信息消息', type: 'info' })
    render(<ToastContainer />)
    expect(screen.getByText('信息消息')).toBeDefined()
  })

  it('显示 success toast(含 ✓ 图标)', () => {
    useToastStore.getState().push({ message: '操作成功', type: 'success' })
    render(<ToastContainer />)
    expect(screen.getByText('操作成功')).toBeDefined()
    expect(screen.getByText('✓')).toBeDefined()
  })

  it('显示 error toast(含 ✕ 图标)', () => {
    useToastStore.getState().push({ message: '操作失败', type: 'error' })
    render(<ToastContainer />)
    expect(screen.getByText('操作失败')).toBeDefined()
    expect(screen.getByText('✕')).toBeDefined()
  })

  it('显示 warning toast(含 ⚠ 图标)', () => {
    useToastStore.getState().push({ message: '警告消息', type: 'warning' })
    render(<ToastContainer />)
    expect(screen.getByText('警告消息')).toBeDefined()
    expect(screen.getByText('⚠')).toBeDefined()
  })

  it('info toast 有 role="status"', () => {
    useToastStore.getState().push({ message: 'info', type: 'info' })
    render(<ToastContainer />)
    expect(screen.getByRole('status')).toBeDefined()
  })

  it('error toast 有 role="alert"', () => {
    useToastStore.getState().push({ message: 'err', type: 'error' })
    render(<ToastContainer />)
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('warning toast 有 role="alert"', () => {
    useToastStore.getState().push({ message: 'warn', type: 'warning' })
    render(<ToastContainer />)
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('success toast 有 role="status"', () => {
    useToastStore.getState().push({ message: 'ok', type: 'success' })
    render(<ToastContainer />)
    expect(screen.getByRole('status')).toBeDefined()
  })
})

describe('ToastContainer — 关闭按钮', () => {
  it('有关闭按钮(aria-label="关闭通知")', () => {
    useToastStore.getState().push({ message: 'msg', type: 'info' })
    render(<ToastContainer />)
    expect(screen.getByLabelText('关闭通知')).toBeDefined()
  })

  it('点击关闭按钮移除 toast', () => {
    useToastStore.getState().push({ message: '可关闭', type: 'info' })
    render(<ToastContainer />)
    expect(screen.getByText('可关闭')).toBeDefined()
    fireEvent.click(screen.getByLabelText('关闭通知'))
    expect(screen.queryByText('可关闭')).toBeNull()
  })
})

describe('ToastContainer — 多条 toast', () => {
  it('同时显示多条 toast', () => {
    useToastStore.getState().push({ message: '消息1', type: 'info' })
    useToastStore.getState().push({ message: '消息2', type: 'success' })
    useToastStore.getState().push({ message: '消息3', type: 'error' })
    render(<ToastContainer />)
    expect(screen.getByText('消息1')).toBeDefined()
    expect(screen.getByText('消息2')).toBeDefined()
    expect(screen.getByText('消息3')).toBeDefined()
  })

  it('多条 toast 各自有独立关闭按钮', () => {
    useToastStore.getState().push({ message: 'a', type: 'info' })
    useToastStore.getState().push({ message: 'b', type: 'info' })
    render(<ToastContainer />)
    const closeBtns = screen.getAllByLabelText('关闭通知')
    expect(closeBtns.length).toBe(2)
  })

  it('关闭一条不影响其他', () => {
    useToastStore.getState().push({ message: '保留', type: 'info' })
    useToastStore.getState().push({ message: '删除', type: 'info' })
    render(<ToastContainer />)
    const closeBtns = screen.getAllByLabelText('关闭通知')
    fireEvent.click(closeBtns[1]) // close second toast
    expect(screen.getByText('保留')).toBeDefined()
    expect(screen.queryByText('删除')).toBeNull()
  })
})

describe('ToastContainer — accessibility', () => {
  it('容器有 aria-label="通知"', () => {
    useToastStore.getState().push({ message: 'msg', type: 'info' })
    render(<ToastContainer />)
    const section = screen.getByLabelText('通知')
    expect(section.tagName).toBe('SECTION')
  })

  it('容器有 aria-live="polite"', () => {
    useToastStore.getState().push({ message: 'msg', type: 'info' })
    render(<ToastContainer />)
    const section = screen.getByLabelText('通知')
    expect(section.getAttribute('aria-live')).toBe('polite')
  })

  it('图标有 aria-hidden', () => {
    useToastStore.getState().push({ message: 'msg', type: 'info' })
    render(<ToastContainer />)
    const icon = screen.getByText('ℹ')
    expect(icon.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('ToastContainer — 图标映射', () => {
  it('info → ℹ', () => {
    useToastStore.getState().push({ message: 'x', type: 'info' })
    render(<ToastContainer />)
    expect(screen.getByText('ℹ')).toBeDefined()
  })
  it('success → ✓', () => {
    useToastStore.getState().push({ message: 'x', type: 'success' })
    render(<ToastContainer />)
    expect(screen.getByText('✓')).toBeDefined()
  })
  it('error → ✕', () => {
    useToastStore.getState().push({ message: 'x', type: 'error' })
    render(<ToastContainer />)
    expect(screen.getByText('✕')).toBeDefined()
  })
  it('warning → ⚠', () => {
    useToastStore.getState().push({ message: 'x', type: 'warning' })
    render(<ToastContainer />)
    expect(screen.getByText('⚠')).toBeDefined()
  })
})
