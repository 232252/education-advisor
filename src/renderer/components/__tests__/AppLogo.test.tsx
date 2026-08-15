// =============================================================
// AppLogo — 品牌标识组件测试
// 验证: SVG 渲染、尺寸、状态点、多实例渐变 id 隔离、可访问性
// =============================================================

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppLogo } from '../AppLogo'

describe('AppLogo — 渲染', () => {
  it('渲染 SVG 元素', () => {
    const { container } = render(<AppLogo />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1024 1024')
  })

  it('默认尺寸 32px', () => {
    const { container } = render(<AppLogo />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.width).toBe('32px')
    expect(wrapper.style.height).toBe('32px')
  })

  it('自定义尺寸生效', () => {
    const { container } = render(<AppLogo size={48} />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.style.width).toBe('48px')
    expect(wrapper.style.height).toBe('48px')
  })

  it('SVG width/height 属性随 size 变化', () => {
    const { container } = render(<AppLogo size={64} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('64')
    expect(svg?.getAttribute('height')).toBe('64')
  })
})

describe('AppLogo — 状态点', () => {
  it('默认显示运行状态点', () => {
    const { container } = render(<AppLogo />)
    // 状态点是 emerald 色的 span
    const dot = container.querySelector('.bg-emerald-400')
    expect(dot).not.toBeNull()
  })

  it('showStatusDot=false 隐藏状态点', () => {
    const { container } = render(<AppLogo showStatusDot={false} />)
    const dot = container.querySelector('.bg-emerald-400')
    expect(dot).toBeNull()
  })

  it('status=running 显示蓝色脉冲点', () => {
    const { container } = render(<AppLogo status="running" />)
    const dot = container.querySelector('.bg-blue-500, .bg-blue-400')
    expect(dot).not.toBeNull()
    expect(dot?.className).toContain('animate-pulse')
  })

  it('status=error 显示红色点', () => {
    const { container } = render(<AppLogo status="error" />)
    const dot = container.querySelector('.bg-red-500, .bg-red-400')
    expect(dot).not.toBeNull()
  })

  it('status=idle 默认绿色点', () => {
    const { container } = render(<AppLogo status="idle" />)
    expect(container.querySelector('.bg-emerald-400')).not.toBeNull()
  })
})

describe('AppLogo — 可访问性', () => {
  it('SVG 有 role=img', () => {
    const { container } = render(<AppLogo />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('role')).toBe('img')
  })

  it('SVG 有 aria-label', () => {
    const { container } = render(<AppLogo />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('aria-label')).toBe('Education Advisor')
  })
})

describe('AppLogo — 渐变 id 隔离', () => {
  it('多实例渲染时渐变 id 不冲突', () => {
    // 同一页面渲染两个 AppLogo, 它们的渐变 id 应不同(useId 隔离)
    // 否则第二个实例的 fill="url(#bg-xxx)" 会引用第一个的定义, 删除第一个时第二个失色
    const { container } = render(
      <div>
        <AppLogo size={32} />
        <AppLogo size={32} />
      </div>,
    )
    const gradients = container.querySelectorAll('linearGradient')
    const ids = new Set<string>()
    gradients.forEach((g) => {
      ids.add(g.getAttribute('id') ?? '')
    })
    // 至少有 2 组渐变(bg + sheen), 且 id 各不相同
    expect(ids.size).toBeGreaterThanOrEqual(2)
    // 确认没有重复 id
    const allIds = Array.from(gradients).map((g) => g.getAttribute('id') ?? '')
    const uniqueIds = new Set(allIds)
    expect(uniqueIds.size).toBe(allIds.length)
  })

  it('包含背景渐变和书页/网络等关键元素', () => {
    const { container } = render(<AppLogo />)
    // 背景渐变
    const bgGradient = Array.from(container.querySelectorAll('linearGradient')).find((g) =>
      (g.getAttribute('id') ?? '').startsWith('bg-'),
    )
    expect(bgGradient).toBeDefined()
    // 网络节点 (cyan 圆)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBeGreaterThanOrEqual(4) // 3 网络节点 + 1 核心
    // 书页路径
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBeGreaterThanOrEqual(2) // 左页 + 右页
  })
})
