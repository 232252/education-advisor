// =============================================================
// GradeBandChartCard — 成绩百分制分段柱状图
// 视觉与 ScoreDistChartCard 对齐：ChartCard + 分桶渐变柱。
// =============================================================

import { useMemo } from 'react'
import { ChartCard } from '../../../components/charts/ChartCard'
import {
  axisTooltip,
  categoryAxis,
  containGrid,
  valueAxis,
  verticalGradient,
} from '../../../components/charts/option-builders'
import { CHART_BRAND, type ChartTheme, useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'
import { GRADE_BAND_I18N, GRADE_BAND_LABELS, GRADE_BAND_ORDER } from '../dashboard-academic-stats'

function bandColors(label: string): [string, string] {
  if (label === GRADE_BAND_LABELS.FAIL) return ['#ef4444', '#dc2626']
  if (label === GRADE_BAND_LABELS.PASS) return ['#f97316', '#ea580c']
  if (label === GRADE_BAND_LABELS.GOOD) return ['#eab308', '#ca8a04']
  return ['#22c55e', '#16a34a']
}

function buildOption(
  bands: Record<string, number>,
  chartTheme: ChartTheme,
  translateKey: (key: string) => string,
) {
  const keys = GRADE_BAND_ORDER.filter((k) => k in bands)
  return {
    animation: true,
    animationDuration: 800,
    animationEasing: 'cubicOut' as const,
    tooltip: axisTooltip(chartTheme),
    grid: containGrid(28),
    xAxis: categoryAxis(keys.map(translateKey), chartTheme, { hideTick: true }),
    yAxis: valueAxis(chartTheme),
    series: [
      {
        type: 'bar',
        data: keys.map((label) => ({
          value: bands[label] ?? 0,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: verticalGradient(...bandColors(label)),
          },
        })),
        barWidth: '50%',
      },
    ],
  }
}

export function GradeBandChartCard({ bands }: { bands: Record<string, number> }) {
  const { t, lang } = useT()
  const chartTheme = useChartTheme()
  // biome-ignore lint/correctness/useExhaustiveDependencies: t 是模块级稳定函数;lang 变化时重译轴标签
  const option = useMemo(
    () => buildOption(bands, chartTheme, (key) => t(GRADE_BAND_I18N[key] ?? '', key)),
    [bands, chartTheme, lang],
  )
  return (
    <ChartCard
      title={t('page.dashboard.academic.chart.gradeBand')}
      dotColor={CHART_BRAND.blue}
      height={260}
      option={option}
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    />
  )
}
