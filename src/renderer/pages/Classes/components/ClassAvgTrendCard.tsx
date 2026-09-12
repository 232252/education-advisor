// =============================================================
// ClassAvgTrendCard — multi-exam class average line chart
// =============================================================

import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { ChartCard } from '../../../components/charts/ChartCard'
import {
  axisTooltip,
  categoryAxis,
  containGrid,
  lineSeries,
  valueAxis,
} from '../../../components/charts/option-builders'
import { CHART_BRAND, useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'
import { SUBJECT_FILTER_ALL } from '../../Dashboard/dashboard-lens'
import { type ClassAvgTrendPoint, trendPointsWithData } from '../lib/class-avg-trend'

interface ClassAvgTrendCardProps {
  points: ClassAvgTrendPoint[]
  subjectId: string
  ready: boolean
}

export function ClassAvgTrendCard({ points, subjectId, ready }: ClassAvgTrendCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()
  const withData = useMemo(() => trendPointsWithData(points), [points])
  const isPercent = subjectId === SUBJECT_FILTER_ALL

  const option = useMemo(() => {
    if (withData.length < 2) return null
    const labels = withData.map((p) => p.examName)
    const data = withData.map((p) => p.average)
    const seriesName = t('page.classes.grades.trendSeries')
    return {
      animation: true,
      animationDuration: 800,
      tooltip: axisTooltip(chartTheme),
      grid: containGrid(28),
      xAxis: categoryAxis(labels, chartTheme, { rotate: labels.length > 4 ? 20 : 0 }),
      yAxis: {
        ...valueAxis(chartTheme),
        ...(isPercent ? { min: 0, max: 100 } : {}),
        axisLabel: {
          color: chartTheme.legendColor,
          formatter: isPercent ? '{value}%' : '{value}',
        },
      },
      series: [lineSeries(seriesName, data, CHART_BRAND.blue)],
    }
  }, [withData, chartTheme, t, isPercent])

  if (!ready) return null

  return (
    <ChartCard
      title={t('page.classes.grades.trendTitle')}
      dotColor={CHART_BRAND.blue}
      height={260}
      option={option}
      isEmpty={withData.length < 2}
      emptyTitle={t('page.classes.grades.trendNeedTwo')}
      emptyIcon={<TrendingUp size={28} />}
      emptyClassName="h-[260px] py-0"
    />
  )
}
