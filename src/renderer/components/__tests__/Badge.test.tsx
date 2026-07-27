// =============================================================
// Badge / RiskBadge / StatusDot — 统一标签组件测试
// =============================================================

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge, RiskBadge, StatusDot } from '../Badge'

describe('Badge — 基本', () => {
  it('渲染 children', () => {
    render(<Badge>测试标签</Badge>)
    expect(screen.getByText('测试标签')).toBeDefined()
  })

  it('默认 variant=neutral', () => {
    render(<Badge>标签</Badge>)
    const badge = screen.getByText('标签')
    expect(badge.className).toContain('bg-gray')
  })

  it('渲染为 span 元素', () => {
    render(<Badge>span测试</Badge>)
    expect(screen.getByText('span测试').tagName).toBe('SPAN')
  })
})

describe('Badge — 变体', () => {
  it('variant=info → blue', () => {
    render(<Badge variant="info">信息</Badge>)
    expect(screen.getByText('信息').className).toContain('bg-blue')
  })

  it('variant=success → green', () => {
    render(<Badge variant="success">成功</Badge>)
    expect(screen.getByText('成功').className).toContain('bg-green')
  })

  it('variant=warning → yellow', () => {
    render(<Badge variant="warning">警告</Badge>)
    expect(screen.getByText('警告').className).toContain('bg-yellow')
  })

  it('variant=danger → red', () => {
    render(<Badge variant="danger">危险</Badge>)
    expect(screen.getByText('危险').className).toContain('bg-red')
  })

  it('variant=neutral → gray', () => {
    render(<Badge variant="neutral">中性</Badge>)
    expect(screen.getByText('中性').className).toContain('bg-gray')
  })

  it('所有变体含 rounded-full', () => {
    for (const v of ['info', 'success', 'warning', 'danger', 'neutral'] as const) {
      const { container } = render(<Badge variant={v}>x</Badge>)
      expect(container.querySelector('span')?.className).toContain('rounded-full')
    }
  })
})

describe('Badge — 自定义 className', () => {
  it('附加 className', () => {
    render(<Badge className="ml-2">标签</Badge>)
    const badge = screen.getByText('标签')
    expect(badge.className).toContain('ml-2')
  })

  it('className 合并后仍包含 base 样式', () => {
    render(<Badge className="custom">x</Badge>)
    const badge = screen.getByText('x')
    expect(badge.className).toContain('inline-flex')
    expect(badge.className).toContain('custom')
  })
})

describe('RiskBadge', () => {
  it('渲染风险文字', () => {
    render(<RiskBadge risk="高" />)
    expect(screen.getByText('高')).toBeDefined()
  })

  it('"低" → green 背景', () => {
    render(<RiskBadge risk="低" />)
    expect(screen.getByText('低').className).toContain('bg-green')
  })

  it('"极高" → red 背景', () => {
    render(<RiskBadge risk="极高" />)
    expect(screen.getByText('极高').className).toContain('bg-red')
  })

  it('未知风险 → gray', () => {
    render(<RiskBadge risk="unknown" />)
    expect(screen.getByText('unknown').className).toContain('bg-gray')
  })

  it('附加 className', () => {
    render(<RiskBadge risk="低" className="extra" />)
    expect(screen.getByText('低').className).toContain('extra')
  })
})

describe('StatusDot — 基本', () => {
  it('渲染圆点(span)', () => {
    const { container } = render(<StatusDot status="green" />)
    expect(container.querySelectorAll('span').length).toBeGreaterThanOrEqual(1)
  })

  it('无 label 时只渲染圆点(不渲染文字)', () => {
    const { container } = render(<StatusDot status="blue" />)
    const spans = container.querySelectorAll('span')
    // outer span + inner dot span, no text span
    expect(spans.length).toBe(2)
  })
})

describe('StatusDot — 颜色', () => {
  const colors: Array<['green' | 'red' | 'blue' | 'yellow' | 'gray', string]> = [
    ['green', 'bg-green-400'],
    ['red', 'bg-red-400'],
    ['blue', 'bg-blue-400'],
    ['yellow', 'bg-yellow-400'],
    ['gray', 'bg-gray-400'],
  ]

  for (const [status, expectedClass] of colors) {
    it(`status="${status}" → ${expectedClass}`, () => {
      const { container } = render(<StatusDot status={status} />)
      const dot = container.querySelector('.rounded-full')
      expect(dot?.className).toContain(expectedClass.split('-')[1])
    })
  }
})

describe('StatusDot — pulse', () => {
  it('pulse=true → animate-pulse', () => {
    const { container } = render(<StatusDot status="blue" pulse={true} />)
    expect(container.querySelector('.rounded-full')?.className).toContain('animate-pulse')
  })

  it('pulse=false(默认) → 无 animate-pulse', () => {
    const { container } = render(<StatusDot status="blue" />)
    expect(container.querySelector('.rounded-full')?.className).not.toContain('animate-pulse')
  })
})

describe('StatusDot — label', () => {
  it('有 label 时渲染文字', () => {
    render(<StatusDot status="green" label="运行中" />)
    expect(screen.getByText('运行中')).toBeDefined()
  })

  it('无 label 时不渲染文字', () => {
    const { container } = render(<StatusDot status="green" />)
    expect(container.querySelectorAll('span').length).toBe(2) // outer + dot, no label
  })

  it('label 文字有 text-xs 类', () => {
    render(<StatusDot status="green" label="状态" />)
    const label = screen.getByText('状态')
    expect(label.className).toContain('text-xs')
  })
})
