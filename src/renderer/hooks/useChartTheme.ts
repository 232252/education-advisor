// =============================================================
// useChartTheme — ECharts 主题色板 hook
// 统一 Dashboard、Academics、StudentProfile 三处重复定义的
// isDark → axisColor/gridColor/legendColor/palette 逻辑。
// =============================================================

import { useMemo } from 'react'
import * as useThemeModule from './useTheme'

export interface ChartTheme {
  /** 坐标轴标签色 */
  axisLabelColor: string
  /** 网格线色 */
  gridColor: string
  /** 图例文字色 */
  legendColor: string
  /** tooltip 背景色 */
  tooltipBg: string
  /** tooltip 边框色 */
  tooltipBorder: string
  /** tooltip 文字色 */
  tooltipText: string
  /** 数据系列色板（品牌蓝-靛-紫-青-绿系，与应用渐变 Logo 呼应） */
  palette: string[]
  /** 可直接展开进 ECharts option 的 axis 配置 */
  axisOption: { xAxis: Record<string, unknown>; yAxis: Record<string, unknown> }
  /** 可直接展开进 ECharts option 的 grid 配置 */
  gridOption: { borderColor: string }
  /** 可直接展开进 ECharts option 的 legend 配置 */
  legendOption: { textStyle: { color: string } }
  /** 可直接展开进 ECharts option 的 tooltip 配置（毛玻璃 + 圆角 + 阴影） */
  tooltipOption: {
    backgroundColor: string
    borderColor: string
    borderWidth: number
    textStyle: { color: string; fontSize: number }
    padding: number[]
    borderRadius: number
    extraCssText: string
  }
}

// 品牌色板：蓝 → 靛 → 紫 → 青 → 绿 → 琥珀 → 橙 → 红
// 与 AppLogo / MainLayout 渐变（blue→indigo→violet）呼应，替代 ECharts 默认色
const PALETTE = [
  '#3b82f6', // blue-500
  '#6366f1', // indigo-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#22c55e', // green-500
  '#eab308', // yellow-500
  '#f97316', // orange-500
  '#ef4444', // red-500
]

export function useChartTheme(): ChartTheme {
  // 使用命名空间导入访问 useTheme，使测试中的 vi.spyOn 能可靠拦截。
  // 直接具名导入在某些打包/测试运行时下是 live binding，spy 可能不生效。
  const theme = useThemeModule.useTheme()
  const isDark = theme === 'dark'

  return useMemo<ChartTheme>(() => {
    const axisLabelColor = isDark ? '#d1d5db' : '#374151'
    const gridColor = isDark ? '#1f2937' : '#e5e7eb'
    const legendColor = isDark ? '#9ca3af' : '#6b7280'
    const tooltipBg = isDark ? 'rgba(30, 34, 42, 0.92)' : 'rgba(255, 255, 255, 0.96)'
    const tooltipBorder = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)'
    const tooltipText = isDark ? '#e5e7eb' : '#1f2937'
    return {
      axisLabelColor,
      gridColor,
      legendColor,
      tooltipBg,
      tooltipBorder,
      tooltipText,
      palette: PALETTE,
      axisOption: {
        xAxis: {
          axisLine: { lineStyle: { color: legendColor } },
          axisLabel: { color: axisLabelColor },
          splitLine: { lineStyle: { color: gridColor } },
        },
        yAxis: {
          axisLine: { lineStyle: { color: legendColor } },
          axisLabel: { color: axisLabelColor },
          splitLine: { lineStyle: { color: gridColor } },
        },
      },
      gridOption: { borderColor: gridColor },
      legendOption: { textStyle: { color: legendColor } },
      tooltipOption: {
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: tooltipText, fontSize: 12 },
        padding: [8, 12],
        borderRadius: 10,
        extraCssText:
          'backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 8px 24px rgba(0,0,0,0.18);',
      },
    }
  }, [isDark])
}
