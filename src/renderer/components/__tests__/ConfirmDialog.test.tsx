// =============================================================
// ConfirmDialog — 确认对话框组件测试
// =============================================================

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../../components/ConfirmDialog'

describe('ConfirmDialog — open=false', () => {
  it('open=false 时不渲染', () => {
    render(<ConfirmDialog open={false} message="test" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('open=false 时无确认按钮', () => {
    render(<ConfirmDialog open={false} message="test" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('确认')).toBeNull()
  })
})

describe('ConfirmDialog — open=true', () => {
  it('open=true 时渲染对话框', () => {
    render(
      <ConfirmDialog open={true} message="确定删除吗?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByRole('alertdialog')).toBeDefined()
  })

  it('显示 message 内容', () => {
    render(
      <ConfirmDialog
        open={true}
        message="这是一个警告消息"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('这是一个警告消息')).toBeDefined()
  })

  it('显示 title(当提供时)', () => {
    render(
      <ConfirmDialog
        open={true}
        title="警告"
        message="消息"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('警告')).toBeDefined()
  })

  it('不显示 title(当未提供时)', () => {
    render(<ConfirmDialog open={true} message="消息" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText('警告')).toBeNull()
    // message should exist but title heading should not
    expect(screen.queryByLabelText('confirm-dialog-title')).toBeNull()
  })

  it('默认 confirmText 为"确认"', () => {
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('确认')).toBeDefined()
  })

  it('默认 cancelText 为"取消"', () => {
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('取消')).toBeDefined()
  })

  it('自定义 confirmText', () => {
    render(
      <ConfirmDialog
        open={true}
        message="msg"
        confirmText="删除"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('删除')).toBeDefined()
  })

  it('自定义 cancelText', () => {
    render(
      <ConfirmDialog
        open={true}
        message="msg"
        cancelText="返回"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('返回')).toBeDefined()
  })
})

describe('ConfirmDialog — 回调', () => {
  it('点击确认按钮调用 onConfirm', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open={true} message="msg" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('确认'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('点击取消按钮调用 onCancel', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('取消'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('点击背景遮罩调用 onCancel', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={onCancel} />)
    // The backdrop is the outer div with onMouseDown
    const backdrop = screen.getByRole('alertdialog').parentElement
    expect(backdrop).toBeDefined()
    // Simulate click on backdrop (mouse down where target === currentTarget)
    fireEvent.mouseDown(backdrop as HTMLElement, { target: backdrop })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('点击对话框内部不触发 onCancel', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={onCancel} />)
    // Click on message (inside dialog, not backdrop)
    fireEvent.mouseDown(screen.getByText('msg'))
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('ConfirmDialog — 键盘操作', () => {
  it('Escape 键调用 onCancel', () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Enter 键调用 onConfirm', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open={true} message="msg" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('其他键不触发回调', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open={true} message="msg" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'a' })
    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.keyDown(document, { key: ' ' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('open=false 时键盘事件不生效', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<ConfirmDialog open={false} message="msg" onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})

describe('ConfirmDialog — variant 样式', () => {
  it('variant="danger" 时确认按钮有红色样式', () => {
    render(
      <ConfirmDialog
        open={true}
        message="msg"
        variant="danger"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const confirmBtn = screen.getByText('确认').closest('button')
    expect(confirmBtn?.className).toContain('red')
  })

  it('variant="default" 时确认按钮有蓝色样式', () => {
    render(
      <ConfirmDialog
        open={true}
        message="msg"
        variant="default"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const confirmBtn = screen.getByText('确认').closest('button')
    expect(confirmBtn?.className).toContain('blue')
  })

  it('未指定 variant 时默认为 default(蓝色)', () => {
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const confirmBtn = screen.getByText('确认').closest('button')
    expect(confirmBtn?.className).toContain('blue')
    expect(confirmBtn?.className).not.toContain('red')
  })
})

describe('ConfirmDialog — accessibility', () => {
  it('有 role="alertdialog"', () => {
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alertdialog')).toBeDefined()
  })

  it('有 aria-modal="true"', () => {
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alertdialog').getAttribute('aria-modal')).toBe('true')
  })

  it('message 有 aria-describedby', () => {
    render(<ConfirmDialog open={true} message="msg" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('alertdialog')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).toBe('confirm-dialog-message')
  })
})
