// =============================================================
// Card / CardHeader — 卡片容器组件测试
// =============================================================

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Card, CardHeader } from '../Card'

describe('Card — 基本', () => {
  it('渲染 children', () => {
    render(<Card>卡片内容</Card>)
    expect(screen.getByText('卡片内容')).toBeDefined()
  })

  it('渲染为 div', () => {
    const { container } = render(<Card>x</Card>)
    expect((container.firstChild as HTMLElement).tagName).toBe('DIV')
  })

  it('含 rounded-xl', () => {
    const { container } = render(<Card>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('rounded-xl')
  })

  it('含 border', () => {
    const { container } = render(<Card>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('border')
  })

  it('含 bg-white', () => {
    const { container } = render(<Card>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('bg-white')
  })
})

describe('Card — padding 变体', () => {
  it('默认 padding="md" → p-5', () => {
    const { container } = render(<Card>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('p-5')
  })

  it('padding="none" → 无 padding 类', () => {
    const { container } = render(<Card padding="none">x</Card>)
    expect((container.firstChild as HTMLElement).className).not.toContain('p-3')
    expect((container.firstChild as HTMLElement).className).not.toContain('p-5')
    expect((container.firstChild as HTMLElement).className).not.toContain('p-6')
  })

  it('padding="sm" → p-3', () => {
    const { container } = render(<Card padding="sm">x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('p-3')
  })

  it('padding="lg" → p-6', () => {
    const { container } = render(<Card padding="lg">x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('p-6')
  })

  it('不同 padding 互斥(sm 不含 md)', () => {
    const { container } = render(<Card padding="sm">x</Card>)
    const cls = (container.firstChild as HTMLElement).className
    expect(cls).toContain('p-3')
    expect(cls).not.toContain('p-5')
  })
})

describe('Card — interactive', () => {
  it('interactive=false(默认) → 无 hover 类', () => {
    const { container } = render(<Card>x</Card>)
    const cls = (container.firstChild as HTMLElement).className
    expect(cls).not.toContain('hover:shadow')
  })

  it('interactive=true → 含 hover:shadow-md', () => {
    const { container } = render(<Card interactive>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('hover:shadow')
  })

  it('interactive=true → 含 transition-all', () => {
    const { container } = render(<Card interactive>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('transition-all')
  })

  it('interactive=true → 含 cursor-pointer', () => {
    const { container } = render(<Card interactive>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('cursor-pointer')
  })
})

describe('Card — onClick', () => {
  it('有 onClick → 触发回调', () => {
    const handler = vi.fn()
    render(<Card onClick={handler}>可点击</Card>)
    fireEvent.click(screen.getByText('可点击'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('有 onClick → 含 cursor-pointer', () => {
    const { container } = render(<Card onClick={() => {}}>x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('cursor-pointer')
  })

  it('无 onClick → 无 cursor-pointer(非 interactive)', () => {
    const { container } = render(<Card>x</Card>)
    expect((container.firstChild as HTMLElement).className).not.toContain('cursor-pointer')
  })
})

describe('Card — className 合并', () => {
  it('自定义 className 附加', () => {
    const { container } = render(<Card className="my-custom">x</Card>)
    expect((container.firstChild as HTMLElement).className).toContain('my-custom')
  })

  it('className 与 base 样式共存', () => {
    const { container } = render(<Card className="extra">x</Card>)
    const cls = (container.firstChild as HTMLElement).className
    expect(cls).toContain('extra')
    expect(cls).toContain('rounded-xl')
  })
})

describe('CardHeader', () => {
  it('渲染 title', () => {
    render(<CardHeader title="标题文字" />)
    expect(screen.getByText('标题文字')).toBeDefined()
  })

  it('title 渲染为 h3', () => {
    render(<CardHeader title="标题" />)
    expect(screen.getByText('标题').tagName).toBe('H3')
  })

  it('有 subtitle → 渲染副标题', () => {
    render(<CardHeader title="标题" subtitle="副标题文字" />)
    expect(screen.getByText('副标题文字')).toBeDefined()
  })

  it('无 subtitle → 不渲染 p', () => {
    const { container } = render(<CardHeader title="标题" />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('subtitle 渲染为 p', () => {
    render(<CardHeader title="标题" subtitle="副标题" />)
    expect(screen.getByText('副标题').tagName).toBe('P')
  })

  it('有 action → 渲染 action', () => {
    render(<CardHeader title="标题" action={<button type="button">操作</button>} />)
    expect(screen.getByText('操作')).toBeDefined()
  })

  it('无 action → 不渲染 action', () => {
    const { container } = render(<CardHeader title="标题" />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('action 可以是任意元素', () => {
    render(<CardHeader title="标题" action={<span data-testid="custom-action">自定义</span>} />)
    expect(screen.getByTestId('custom-action')).toBeDefined()
  })

  it('含 mb-4 (margin bottom)', () => {
    const { container } = render(<CardHeader title="标题" />)
    expect((container.firstChild as HTMLElement).className).toContain('mb-4')
  })
})
