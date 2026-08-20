// =============================================================
// 成绩趋势折线图卡片 — 从 AcademicsTab 提取
// x轴=考试名, 每条线=一个科目
// M21: 与 Academics/TrendChartCard 的重复 option 样板收敛到
// components/charts/option-builders(此前本图 tooltip 完全无主题、
// 容器用手写 CARD_BASE div,现统一 ChartCard + 玻璃拟态 tooltip)。
// =============================================================

import { useMemo } from 'react'
import { ChartCard } from '../../../../components/charts/ChartCard'
import {
  axisTooltip,
  bottomLegend,
  categoryAxis,
  containGrid,
  lineSeries,
  valueAxis,
} from '../../../../components/charts/option-builders'
import { CHART_BRAND, useChartTheme } from '../../../../hooks/useChartTheme'
import { useT } from '../../../../i18n'
import { SUBJECT_COLORS, type TrendData } from '../../../../lib/academics'

interface TrendChartProps {
  trendData: TrendData
}

export function TrendChart({ trendData }: TrendChartProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()

  const option = useMemo(
    () => ({
      animation: true,
      animationDuration: 800,
      tooltip: axisTooltip(chartTheme),
      legend: bottomLegend(chartTheme, { data: trendData.series.map((s) => s.name) }),
      grid: containGrid(36),
      xAxis: categoryAxis(trendData.labels, chartTheme),
      yAxis: valueAxis(chartTheme),
      series: trendData.series.map((s, i) =>
        lineSeries(s.name, s.data, SUBJECT_COLORS[i % SUBJECT_COLORS.length]),
      ),
    }),
    [trendData, chartTheme],
  )

  return (
    <ChartCard
      title={t('common.chart.trend')}
      dotColor={CHART_BRAND.blue}
      height={280}
      option={option}
    />
  )
}
