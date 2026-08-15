// =============================================================
// 成绩趋势折线图卡片 — 从 AcademicsTab 提取
// x轴=考试名, 每条线=一个科目
// =============================================================

import ReactEChartsCore from 'echarts-for-react/esm/core'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { echarts } from '../../../../lib/echarts-setup'
import { CARD_BASE } from '../../../../lib/ui-utils'
import { ACADEMIC_CHART_COLORS, type TrendData } from '../../lib/academics-metrics'

interface TrendChartProps {
  trendData: TrendData
}

export function TrendChart({ trendData }: TrendChartProps) {
  // 接入 Phase 1 useChartTheme（替代手写 axisColor/gridColor）
  // 颜色映射与 Dashboard Task 10 一致：axisColor→legendColor，gridColor→gridColor
  const chartTheme = useChartTheme()
  // colors 为本 Tab 数据系列自定义 10 色板，保持不变以维持视觉行为
  const colors = ACADEMIC_CHART_COLORS

  return (
    <div className={`${CARD_BASE} p-4 shadow-sm`}>
      <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📈 成绩趋势</h5>
      <ReactEChartsCore
        echarts={echarts}
        style={{ height: 280 }}
        option={{
          animation: true,
          animationDuration: 1000,
          tooltip: { trigger: 'axis' },
          legend: {
            data: trendData.series.map((s) => s.name),
            bottom: 0,
            textStyle: { color: chartTheme.legendColor, fontSize: 11 },
          },
          grid: { left: 8, right: 8, top: 8, bottom: 36, containLabel: true },
          xAxis: {
            type: 'category',
            data: trendData.labels,
            axisLabel: { color: chartTheme.legendColor, fontSize: 11 },
            axisLine: { lineStyle: { color: chartTheme.gridColor } },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: chartTheme.legendColor },
            splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
          },
          series: trendData.series.map((s, i) => ({
            name: s.name,
            type: 'line',
            data: s.data,
            smooth: true,
            lineStyle: { color: colors[i % colors.length], width: 2 },
            itemStyle: { color: colors[i % colors.length] },
            symbol: 'circle',
            symbolSize: 5,
          })),
        }}
      />
    </div>
  )
}
