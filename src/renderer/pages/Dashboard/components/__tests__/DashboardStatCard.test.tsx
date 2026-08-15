// =============================================================
// DashboardStatCard — 数值千分位格式化测试
// =============================================================

import { render } from '@testing-library/react'
import { Users } from 'lucide-react'
import { describe, expect, it } from 'vitest'
import { DashboardStatCard } from '../DashboardStatCard'

// 用最小 prop 渲染并提取数值文本
function valueText(value: string | number): string {
  const { container } = render(
    <DashboardStatCard title="t" value={value} color="blue" icon={Users} />,
  )
  // 数值在 text-2xl 的 div 里
  const el = container.querySelector('.text-2xl')
  return el?.textContent ?? ''
}

describe('DashboardStatCard — 数值千分位', () => {
  it('大数字加千分位: 34922 → 34,922', () => {
    expect(valueText(34922)).toBe('34,922')
  })
  it('四位数加千分位: 1638 → 1,638', () => {
    expect(valueText(1638)).toBe('1,638')
  })
  it('小数字不变: 18 → 18', () => {
    expect(valueText(18)).toBe('18')
  })
  it('纯数字字符串加千分位并保留小数: "1234.5" → 1,234.5', () => {
    expect(valueText('1234.5')).toBe('1,234.5')
  })
  it('含小数的负数字符串: "-12345.0" → -12,345.0', () => {
    expect(valueText('-12345.0')).toBe('-12,345.0')
  })
  it('比值字符串不变: "10/18" → 10/18', () => {
    expect(valueText('10/18')).toBe('10/18')
  })
  it('中文/非数字不变: "未设置" → 未设置', () => {
    expect(valueText('未设置')).toBe('未设置')
  })
  it('短横线占位不变: "-" → -', () => {
    expect(valueText('-')).toBe('-')
  })
})
