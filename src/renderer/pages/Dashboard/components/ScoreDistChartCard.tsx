// =============================================================
// ScoreDistChartCard — 分数分布柱状图卡片
// 职责：接收分数区间数据 + 主题，内部构造并 memo ECharts option。
// （option 构造函数不导出，避免 declaration emit 的 TS4058，
//   与代码库其他图表组件内联构造 option 的模式一致）
// =============================================================

import ReactEChartsCore from 'echarts-for-react/esm/core'
import { useMemo } from 'react'
import { Card } from '../../../components/Card'
import { type ChartTheme, useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'
import { echarts } from '../../../lib/echarts-setup'

interface ScoreDistChartCardProps {
  /** 分数区间 → 人数 */
  scoreIntervals: Record<string, number>
  /** 排序后的区间键（x 轴顺序） */
  sortedScoreKeys: string[]
}

/** 构造分数分布柱状图 option（按分数区间分桶着色） */
function buildScoreChartOption(
  scoreIntervals: Record<string, number>,
  sortedScoreKeys: string[],
  chartTheme: ChartTheme,
) {
  return {
    animation: true,
    animationDuration: 800,
    animationEasing: 'cubicOut' as const,
    tooltip: {
      trigger: 'axis',
      ...chartTheme.tooltipOption,
    },
    grid: { left: 8, right: 8, top: 8, bottom: 28, containLabel: true },
    xAxis: {
      type: 'category',
      data: sortedScoreKeys,
      axisLabel: { color: chartTheme.legendColor, fontSize: 11, rotate: 0 },
      axisLine: { lineStyle: { color: chartTheme.gridColor } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: chartTheme.legendColor },
      splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
    },
    series: [
      {
        type: 'bar',
        data: Object.entries(scoreIntervals).map(([label, count]) => ({
          value: count,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              {
                offset: 0,
                color: label.includes('极高')
                  ? '#ef4444'
                  : label.includes('低')
                    ? '#f97316'
                    : label.includes('中')
                      ? '#eab308'
                      : '#22c55e',
              },
              {
                offset: 1,
                color: label.includes('极高')
                  ? '#dc2626'
                  : label.includes('低')
                    ? '#ea580c'
                    : label.includes('中')
                      ? '#ca8a04'
                      : '#16a34a',
              },
            ]),
          },
        })),
        barWidth: '50%',
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.2)' },
        },
      },
    ],
  }
}

export function ScoreDistChartCard({ scoreIntervals, sortedScoreKeys }: ScoreDistChartCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()
  const option = useMemo(
    () => buildScoreChartOption(scoreIntervals, sortedScoreKeys, chartTheme),
    [scoreIntervals, sortedScoreKeys, chartTheme],
  )
  return (
    <Card
      padding="md"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
        {t('page.dashboard.chart.scoreDist')}
      </h3>
      <ReactEChartsCore echarts={echarts} style={{ height: 260 }} option={option} />
    </Card>
  )
}
