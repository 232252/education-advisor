// =============================================================
// ScoreDistChartCard — 分数分布柱状图卡片
// 职责：接收分数区间数据 + 主题，内部构造并 memo ECharts option。
// M21: 轴/网格/tooltip 样板收敛到 components/charts/option-builders,
// 容器收敛到 ChartCard;仅保留本图语义(按分数区间分桶渐变着色)。
// =============================================================

import { useMemo } from 'react'
import { ChartCard } from '../../../components/charts/ChartCard'
import {
  axisTooltip,
  categoryAxis,
  containGrid,
  valueAxis,
} from '../../../components/charts/option-builders'
import { CHART_BRAND, type ChartTheme, useChartTheme } from '../../../hooks/useChartTheme'
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
    tooltip: axisTooltip(chartTheme),
    grid: containGrid(28),
    xAxis: categoryAxis(sortedScoreKeys, chartTheme, { hideTick: true }),
    yAxis: valueAxis(chartTheme),
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
    <ChartCard
      title={t('page.dashboard.chart.scoreDist')}
      dotColor={CHART_BRAND.blue}
      height={260}
      option={option}
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    />
  )
}
