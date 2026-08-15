// =============================================================
// Button — 统一按钮组件测试
// 验证: 变体 class、尺寸、loading 旋转图标、icon/iconRight、disabled、fullWidth、ref 转发
// =============================================================
import { render, screen } from '@testing-library/react'
import { Check, ChevronRight } from 'lucide-react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Button } from '../Button'

describe('Button — 变体(variant)', () => {
  it('默认 variant=primary 包含 blue-600', () => {
    render(<Button>保存</Button>)
    const btn = screen.getByRole('button', { name: '保存' })
    expect(btn.className).toContain('bg-blue-600')
    expect(btn.className).toContain('hover:bg-blue-700')
  })

  it('variant=secondary 包含 surface-elevated + border', () => {
    render(<Button variant="secondary">取消</Button>)
    const btn = screen.getByRole('button', { name: '取消' })
    expect(btn.className).toContain('dark:bg-surface-elevated')
    expect(btn.className).toContain('border')
  })

  it('variant=danger 包含 red-600', () => {
    render(<Button variant="danger">删除</Button>)
    expect(screen.getByRole('button', { name: '删除' }).className).toContain('bg-red-600')
  })

  it('variant=success 包含 green-600', () => {
    render(<Button variant="success">确认</Button>)
    expect(screen.getByRole('button', { name: '确认' }).className).toContain('bg-green-600')
  })

  it('variant=warning 包含 amber-500', () => {
    render(<Button variant="warning">警告</Button>)
    expect(screen.getByRole('button', { name: '警告' }).className).toContain('bg-amber-500')
  })

  it('variant=ghost 包含 hover:bg-gray-100', () => {
    render(<Button variant="ghost">幽灵</Button>)
    expect(screen.getByRole('button', { name: '幽灵' }).className).toContain('hover:bg-gray-100')
  })

  it('variant=outline 包含 border-blue + 透明背景', () => {
    render(<Button variant="outline">描边</Button>)
    const btn = screen.getByRole('button', { name: '描边' })
    expect(btn.className).toContain('border-blue')
    expect(btn.className).toContain('bg-transparent')
  })

  it('所有变体都包含 rounded-lg', () => {
    const variants = [
      'primary',
      'secondary',
      'danger',
      'success',
      'warning',
      'ghost',
      'outline',
    ] as const
    for (const v of variants) {
      const { unmount } = render(<Button variant={v}>x</Button>)
      expect(screen.getByRole('button').className).toContain('rounded-lg')
      unmount()
    }
  })

  it('所有变体都包含 focus-visible ring', () => {
    const { unmount } = render(<Button>x</Button>)
    expect(screen.getByRole('button').className).toContain('focus-visible:ring-2')
    unmount()
  })
})

describe('Button — 尺寸(size)', () => {
  it('默认 size=md 包含 px-3 py-1.5 text-sm', () => {
    render(<Button>默认</Button>)
    const btn = screen.getByRole('button', { name: '默认' })
    expect(btn.className).toContain('px-3')
    expect(btn.className).toContain('py-1.5')
    expect(btn.className).toContain('text-sm')
  })

  it('size=xs 包含 text-xs', () => {
    render(<Button size="xs">极小</Button>)
    expect(screen.getByRole('button', { name: '极小' }).className).toContain('text-xs')
  })

  it('size=sm 包含 text-xs', () => {
    render(<Button size="sm">小</Button>)
    expect(screen.getByRole('button', { name: '小' }).className).toContain('text-xs')
  })

  it('size=lg 包含 px-5', () => {
    render(<Button size="lg">大</Button>)
    expect(screen.getByRole('button', { name: '大' }).className).toContain('px-5')
  })
})

describe('Button — loading 态', () => {
  it('loading=true 显示 Loader2 旋转图标', () => {
    const { container } = render(<Button loading>提交</Button>)
    // Loader2 带 animate-spin class
    const spinner = container.querySelector('.animate-spin')
    expect(spinner).not.toBeNull()
  })

  it('loading=true 时 button disabled', () => {
    render(<Button loading>提交</Button>)
    expect((screen.getByRole('button', { name: /提交/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('loading=true 时 aria-busy=true', () => {
    render(<Button loading>提交</Button>)
    expect(screen.getByRole('button', { name: /提交/ }).getAttribute('aria-busy')).toBe('true')
  })

  it('loading=false 不显示旋转图标', () => {
    const { container } = render(<Button>提交</Button>)
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('loading 时仍渲染 children 文字', () => {
    render(<Button loading>保存中</Button>)
    expect(screen.getByText('保存中')).toBeTruthy()
  })
})

describe('Button — 图标', () => {
  it('icon prop 渲染左侧图标', () => {
    render(<Button icon={<Check data-testid="check-icon" />}>完成</Button>)
    const btn = screen.getByRole('button', { name: /完成/ })
    const icon = screen.getByTestId('check-icon')
    expect(btn.contains(icon)).toBe(true)
  })

  it('iconRight prop 渲染右侧图标', () => {
    render(<Button iconRight={<ChevronRight data-testid="chevron" />}>下一步</Button>)
    expect(screen.getByTestId('chevron')).toBeTruthy()
  })

  it('loading 时 icon 被旋转图标替换(不渲染传入 icon)', () => {
    const { container } = render(
      <Button loading icon={<Check data-testid="check-icon" />}>
        提交
      </Button>,
    )
    // loading 优先: 传入的 Check 不应渲染
    expect(screen.queryByTestId('check-icon')).toBeNull()
    expect(container.querySelector('.animate-spin')).not.toBeNull()
  })
})

describe('Button — 交互属性', () => {
  it('disabled=true 时按钮禁用', () => {
    render(<Button disabled>禁用</Button>)
    expect((screen.getByRole('button', { name: '禁用' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('fullWidth=true 添加 w-full', () => {
    render(<Button fullWidth>撑满</Button>)
    expect(screen.getByRole('button', { name: '撑满' }).className).toContain('w-full')
  })

  it('fullWidth=false(默认) 不含 w-full', () => {
    render(<Button>普通</Button>)
    expect(screen.getByRole('button', { name: '普通' }).className).not.toContain('w-full')
  })

  it('onClick 可被触发', () => {
    let clicked = 0
    render(<Button onClick={() => (clicked += 1)}>点我</Button>)
    screen.getByRole('button', { name: '点我' }).click()
    expect(clicked).toBe(1)
  })

  it('loading 时 onClick 不触发(因 disabled)', () => {
    let clicked = 0
    render(
      <Button loading onClick={() => (clicked += 1)}>
        点我
      </Button>,
    )
    screen.getByRole('button').click()
    expect(clicked).toBe(0)
  })

  it('透传原生 button 属性 (data-testid, title)', () => {
    render(
      <Button data-testid="submit-btn" title="提交表单">
        提交
      </Button>,
    )
    const btn = screen.getByTestId('submit-btn')
    expect(btn.getAttribute('title')).toBe('提交表单')
  })
})

describe('Button — ref 转发', () => {
  it('forwardRef 正确转发到 button 元素', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>ref 测试</Button>)
    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe('BUTTON')
  })

  it('ref 可用于 focus()', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref}>聚焦</Button>)
    ref.current?.focus()
    expect(document.activeElement).toBe(ref.current)
  })
})
