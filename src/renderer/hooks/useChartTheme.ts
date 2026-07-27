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
  /** 数据系列色板（固定 8 色，与原页面一致） */
  palette: string[]
  /** 可直接展开进 ECharts option 的 axis 配置 */
  axisOption: { xAxis: Record<string, unknown>; yAxis: Record<string, unknown> }
  /** 可直接展开进 ECharts option 的 grid 配置 */
  gridOption: { borderColor: string }
  /** 可直接展开进 ECharts option 的 legend 配置 */
  legendOption: { textStyle: { color: string } }
}

const PALETTE = [
  '#5470c6',
  '#91cc75',
  '#fac858',
  '#ee6666',
  '#73c0de',
  '#3ba272',
  '#fc8452',
  '#9a60fd',
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
    return {
      axisLabelColor,
      gridColor,
      legendColor,
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
    }
  }, [isDark])
}
