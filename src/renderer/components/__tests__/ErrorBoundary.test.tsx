// =============================================================
// ErrorBoundary — React 错误边界组件测试
// =============================================================

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../components/ErrorBoundary'

function ThrowOnRender({ error }: { error: Error | null }) {
  if (error) throw error
  return <div>正常内容</div>
}

describe('ErrorBoundary — 正常渲染', () => {
  it('无错误时渲染 children', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('正常内容')).toBeDefined()
  })

  it('无错误时不显示错误 UI', () => {
    render(
      <ErrorBoundary>
        <div>正常内容</div>
      </ErrorBoundary>,
    )
    expect(screen.queryByText('页面渲染出错了')).toBeNull()
  })

  it('嵌套 children 正常渲染', () => {
    render(
      <ErrorBoundary>
        <div>
          <span>嵌套文本</span>
          <p>段落</p>
        </div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('嵌套文本')).toBeDefined()
    expect(screen.getByText('段落')).toBeDefined()
  })
})

describe('ErrorBoundary — 自定义 fallback', () => {
  it('提供 fallback 时不显示默认错误 UI', () => {
    const error = new Error('test error')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary fallback={<div>自定义错误页面</div>}>
        <ThrowOnRender error={error} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('自定义错误页面')).toBeDefined()
    expect(screen.queryByText('页面渲染出错了')).toBeNull()
    consoleSpy.mockRestore()
  })

  it('fallback 为 null 时回退到默认错误 UI(null 是 falsy)', () => {
    const error = new Error('test')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary fallback={null}>
        <ThrowOnRender error={error} />
      </ErrorBoundary>,
    )
    // null is falsy, so `if (this.props.fallback)` is false → default error UI
    expect(screen.getByText('页面渲染出错了')).toBeDefined()
    consoleSpy.mockRestore()
  })
})

describe('ErrorBoundary — 错误捕获后恢复', () => {
  it('点击"重试"按钮重置错误状态', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // First render: throws error
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowOnRender error={new Error('崩溃')} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('崩溃')).toBeDefined()
    expect(screen.getByText('页面渲染出错了')).toBeDefined()

    // First: re-render WITHOUT error so children won't throw on retry
    rerender(
      <ErrorBoundary>
        <ThrowOnRender error={null} />
      </ErrorBoundary>,
    )
    // Error UI still showing (hasError is still true from first throw)
    expect(screen.getByText('页面渲染出错了')).toBeDefined()

    // Click retry → hasError=false → children render normally (no throw)
    fireEvent.click(screen.getByText('重试'))
    expect(screen.getByText('正常内容')).toBeDefined()
    expect(screen.queryByText('页面渲染出错了')).toBeNull()

    consoleSpy.mockRestore()
  })

  it('显示错误消息', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowOnRender error={new Error('特定错误消息')} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('特定错误消息')).toBeDefined()
    consoleSpy.mockRestore()
  })
})

describe('ErrorBoundary — componentDidCatch 记录错误', () => {
  it('错误被 console.error 记录', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <ThrowOnRender error={new Error('记录测试')} />
      </ErrorBoundary>,
    )
    expect(consoleSpy).toHaveBeenCalled()
    // The error message should appear in console.error calls
    const calls = consoleSpy.mock.calls.map((c) => String(c))
    expect(calls.some((c) => c.includes('ErrorBoundary'))).toBe(true)
    consoleSpy.mockRestore()
  })
})
