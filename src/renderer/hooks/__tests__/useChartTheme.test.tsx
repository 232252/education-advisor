// =============================================================
// useChartTheme — 图表主题 hook 测试
// 验证: 品牌色板、tooltip 毛玻璃样式、明暗主题切换
// =============================================================

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartTheme } from '../useChartTheme'
import * as useThemeModule from '../useTheme'

describe('useChartTheme — 品牌色板', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('色板使用品牌蓝-靛-紫系，而非 ECharts 默认色', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue('dark')
    const { result } = renderHook(() => useChartTheme())
    expect(result.current.palette).toContain('#3b82f6') // blue-500
    expect(result.current.palette).toContain('#6366f1') // indigo-500
    expect(result.current.palette).toContain('#8b5cf6') // violet-500
    // 不应包含 ECharts 默认色
    expect(result.current.palette).not.toContain('#5470c6')
    expect(result.current.palette).not.toContain('#91cc75')
  })

  it('色板为 8 色', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue('light')
    const { result } = renderHook(() => useChartTheme())
    expect(result.current.palette).toHaveLength(8)
  })
})

describe('useChartTheme — tooltip 样式', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('tooltipOption 含毛玻璃(backdrop-filter blur)', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue('dark')
    const { result } = renderHook(() => useChartTheme())
    const css = result.current.tooltipOption.extraCssText
    expect(css).toMatch(/backdrop-filter.*blur/i)
    expect(css).toMatch(/box-shadow/i)
  })

  it('tooltipOption 含圆角', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue('light')
    const { result } = renderHook(() => useChartTheme())
    expect(result.current.tooltipOption.borderRadius).toBeGreaterThan(0)
    expect(result.current.tooltipOption.padding.length).toBeGreaterThan(0)
  })
})

describe('useChartTheme — 明暗主题', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('深色模式 tooltip 背景为半透明深色', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue('dark')
    const { result } = renderHook(() => useChartTheme())
    expect(result.current.tooltipBg).toMatch(/rgba\(.*,\s*0\.\d+\)/)
  })

  it('浅色模式 tooltip 文字为深色', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue('light')
    const { result } = renderHook(() => useChartTheme())
    expect(result.current.tooltipText).toBe('#1f2937')
  })

  it('提供 axisOption / gridOption / legendOption', () => {
    vi.spyOn(useThemeModule, 'useTheme').mockReturnValue('dark')
    const { result } = renderHook(() => useChartTheme())
    expect(result.current.axisOption.xAxis).toBeDefined()
    expect(result.current.axisOption.yAxis).toBeDefined()
    expect(result.current.gridOption.borderColor).toBeDefined()
    expect(result.current.legendOption.textStyle.color).toBeDefined()
  })
})
