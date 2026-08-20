// =============================================================
// ECharts option 构造器 — 图表共享层 (M21)
//
// 之前 7 个图表组件各自内联构造 option, 坐标轴/网格/tooltip/图例/
// 折线 series 样板重复 4-6 份, 且出现三种 tooltip 风格漂移:
//   - Dashboard: chartTheme.tooltipOption(玻璃拟态)
//   - Academics: 4 处手写 isDark 三元色(与 useChartTheme 重复)
//   - Students TrendChart / SubjectDelta: 完全无主题(白底黑字)
// 本模块收敛为唯一权威实现, 各图表组件只保留语义差异
// (数据着色/自定义 formatter/rotate/高度/空态)。
//
// TS4058 约束: tsconfig 开启 declaration emit, 导出函数的返回类型
// 必须显式可声明 — 全部返回 Record<string, unknown>, 与既有图表
// 组件"option 构造内联不导出"的规避方式等效且可复用。
// =============================================================

import type { ChartTheme } from '../../hooks/useChartTheme'

/** 坐标轴触发 tooltip — 统一玻璃拟态样式(替代各处手写 isDark 三元色) */
export function axisTooltip(
  chartTheme: ChartTheme,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { trigger: 'axis', ...chartTheme.tooltipOption, ...extra }
}

/** item 触发 tooltip(饼图/雷达图);extra 可带 formatter */
export function itemTooltip(
  chartTheme: ChartTheme,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { trigger: 'item', ...chartTheme.tooltipOption, ...extra }
}

/** 类目轴(x 轴): 标签字号 11 + 主题色;hideTick 用于柱状图(原行为保留) */
export function categoryAxis(
  data: string[],
  chartTheme: ChartTheme,
  opts?: { rotate?: number; hideTick?: boolean },
): Record<string, unknown> {
  return {
    type: 'category',
    data,
    axisLabel: { color: chartTheme.legendColor, fontSize: 11, rotate: opts?.rotate ?? 0 },
    axisLine: { lineStyle: { color: chartTheme.gridColor } },
    ...(opts?.hideTick ? { axisTick: { show: false } } : {}),
  }
}

/** 数值轴(y 轴): 主题标签色 + 虚线网格 */
export function valueAxis(chartTheme: ChartTheme): Record<string, unknown> {
  return {
    type: 'value',
    axisLabel: { color: chartTheme.legendColor },
    splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
  }
}

/** 网格: containLabel + 统一留白(bottom 由图例/轴标签高度决定) */
export function containGrid(bottom: number): Record<string, unknown> {
  return { left: 8, right: 8, top: 8, bottom, containLabel: true }
}

/** 底部图例: 字号 11 + 主题色;scroll 用于科目较多的趋势图(原行为保留) */
export function bottomLegend(
  chartTheme: ChartTheme,
  opts?: { scroll?: boolean; data?: string[] },
): Record<string, unknown> {
  return {
    ...(opts?.data ? { data: opts.data } : {}),
    bottom: 0,
    textStyle: { color: chartTheme.legendColor, fontSize: 11 },
    ...(opts?.scroll ? { type: 'scroll' } : {}),
  }
}

/** 折线 series: 平滑 + 圆点符号 + 指定色(科目色板由调用方传入) */
export function lineSeries(
  name: string,
  data: Array<number | null>,
  color: string,
): Record<string, unknown> {
  return {
    name,
    type: 'line',
    data,
    smooth: true,
    lineStyle: { color, width: 2 },
    itemStyle: { color },
    symbol: 'circle',
    symbolSize: 5,
  }
}
