// =============================================================
// EmptyState / Skeleton — 空状态 & 骨架屏组件测试
// =============================================================

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EmptyState } from '../EmptyState'
import { CardSkeleton, PageSkeleton, Skeleton, TableSkeleton } from '../Skeleton'

describe('EmptyState — 基本', () => {
  it('渲染 title', () => {
    render(<EmptyState title="暂无数据" />)
    expect(screen.getByText('暂无数据')).toBeDefined()
  })

  it('title 渲染为 h3', () => {
    render(<EmptyState title="标题" />)
    expect(screen.getByText('标题').tagName).toBe('H3')
  })

  it('无 description 时不渲染 p', () => {
    const { container } = render(<EmptyState title="标题" />)
    expect(container.querySelector('p')).toBeNull()
  })

  it('有 description 时渲染 p', () => {
    render(<EmptyState title="标题" description="描述文本" />)
    expect(screen.getByText('描述文本')).toBeDefined()
  })

  it('无 icon 时不渲染图标区', () => {
    const { container } = render(<EmptyState title="标题" />)
    // No icon div (the icon wrapper has mb-4 class)
    const iconWrapper = container.querySelector('.mb-4')
    expect(iconWrapper).toBeNull()
  })
})

describe('EmptyState — icon', () => {
  it('字符串 icon → emoji 渲染', () => {
    const { container } = render(<EmptyState title="标题" icon="📭" />)
    const emojiSpan = container.querySelector('.text-4xl')
    expect(emojiSpan).toBeDefined()
    expect(emojiSpan?.textContent).toBe('📭')
  })

  it('React node icon → div 包裹', () => {
    const { container } = render(
      <EmptyState title="标题" icon={<svg data-testid="custom-icon" />} />,
    )
    // Icon should be wrapped in a rounded div
    const wrapper = container.querySelector('.rounded-full')
    expect(wrapper).toBeDefined()
    expect(screen.getByTestId('custom-icon')).toBeDefined()
  })
})

describe('EmptyState — action', () => {
  it('有 action 时渲染', () => {
    render(<EmptyState title="标题" action={<button type="button">点击操作</button>} />)
    expect(screen.getByText('点击操作')).toBeDefined()
  })

  it('无 action 时不渲染', () => {
    const { container } = render(<EmptyState title="标题" />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('action 可以是任意元素', () => {
    render(<EmptyState title="标题" action={<a href="/new">新建链接</a>} />)
    expect(screen.getByText('新建链接').tagName).toBe('A')
  })
})

describe('EmptyState — className', () => {
  it('附加 className', () => {
    const { container } = render(<EmptyState title="标题" className="extra-padding" />)
    expect(container.firstChild).toBeDefined()
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('extra-padding')
  })
})

describe('Skeleton — 基本', () => {
  it('渲染为 div', () => {
    const { container } = render(<Skeleton />)
    expect(container.firstChild).toBeDefined()
    expect((container.firstChild as HTMLElement).tagName).toBe('DIV')
  })

  it('含 animate-pulse', () => {
    const { container } = render(<Skeleton />)
    expect((container.firstChild as HTMLElement).className).toContain('animate-pulse')
  })

  it('含 rounded-md', () => {
    const { container } = render(<Skeleton />)
    expect((container.firstChild as HTMLElement).className).toContain('rounded-md')
  })

  it('含 bg-gray-200', () => {
    const { container } = render(<Skeleton />)
    expect((container.firstChild as HTMLElement).className).toContain('bg-gray-200')
  })

  it('自定义 className 附加', () => {
    const { container } = render(<Skeleton className="h-4 w-full" />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('h-4')
    expect(el.className).toContain('w-full')
    // Still has base classes
    expect(el.className).toContain('animate-pulse')
  })
})

describe('CardSkeleton', () => {
  it('渲染多个 Skeleton 行', () => {
    const { container } = render(<CardSkeleton />)
    const skeletons = container.querySelectorAll('.animate-pulse')
    // CardSkeleton has 3 Skeleton children
    expect(skeletons.length).toBe(3)
  })

  it('含 border 样式', () => {
    const { container } = render(<CardSkeleton />)
    const root = container.firstChild as HTMLElement
    expect(root.className).toContain('border')
  })
})

describe('TableSkeleton', () => {
  it('默认 5 行 4 列', () => {
    const { container } = render(<TableSkeleton />)
    // Header: 4 skeletons, Rows: 5 * 4 = 20 skeletons, total = 24
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBe(4 + 5 * 4) // 24
  })

  it('自定义 rows 和 cols', () => {
    const { container } = render(<TableSkeleton rows={3} cols={2} />)
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBe(2 + 3 * 2) // 8
  })

  it('rows=0 只有表头', () => {
    const { container } = render(<TableSkeleton rows={0} cols={3} />)
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBe(3) // header only
  })

  it('cols=1 单列', () => {
    const { container } = render(<TableSkeleton rows={2} cols={1} />)
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBe(1 + 2 * 1) // 3
  })
})

describe('PageSkeleton', () => {
  it('渲染统计卡片和图表区', () => {
    const { container } = render(<PageSkeleton />)
    // PageSkeleton: 5 stat CardSkeletons + 2 chart CardSkeletons = 7
    // Each CardSkeleton has 3 inner Skeletons = 21 total
    const skeletons = container.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBe(7 * 3) // 21
  })

  it('含 grid 布局(子元素)', () => {
    const { container } = render(<PageSkeleton />)
    const grids = container.querySelectorAll('.grid')
    expect(grids.length).toBeGreaterThanOrEqual(1)
  })
})
