// =============================================================
// 科目平均分变化柱状图卡 — 正=进步绿, 负=退步红
// M21: 轴/网格/tooltip 样板收敛到 charts 共享层
// (此前本图 tooltip 无主题、grid 留白自成一套,现统一);
// 仅保留本图语义(正负着色 + 柱顶数值标签)。
// =============================================================

import { useMemo } from 'react'
import { ChartCard } from '../../../../components/charts/ChartCard'
import {
  axisTooltip,
  categoryAxis,
  containGrid,
  valueAxis,
} from '../../../../components/charts/option-builders'
import { CHART_BRAND, useChartTheme } from '../../../../hooks/useChartTheme'
import { useT } from '../../../../i18n'
import type { ClassComparisonSummary } from '../../../../lib/academics'

interface SubjectDeltaChartCardProps {
  /** 各科平均分变化 (summary.subjectDeltas) */
  subjectDeltas: ClassComparisonSummary['subjectDeltas']
}

export function SubjectDeltaChartCard({ subjectDeltas }: SubjectDeltaChartCardProps) {
  const { t } = useT()
  const chartTheme = useChartTheme()

  const option = useMemo(
    () => ({
      animation: true,
      animationDuration: 800,
      tooltip: axisTooltip(chartTheme, {
        formatter: (params: Array<{ name: string; value: number }>) =>
          `${params[0].name}: ${params[0].value} ${t('page.academics.common.scoreUnit', '分')}`,
      }),
      grid: containGrid(28),
      xAxis: categoryAxis(
        subjectDeltas.map((s) => s.subjectName),
        chartTheme,
      ),
      yAxis: valueAxis(chartTheme),
      series: [
        {
          type: 'bar',
          data: subjectDeltas.map((s) => ({
            value: Number(s.avgDelta.toFixed(2)),
            // 正=进步绿,负=退步红
            itemStyle: {
              color: s.avgDelta >= 0 ? '#22c55e' : '#ef4444',
              borderRadius: [4, 4, 0, 0],
            },
          })),
          barWidth: '40%',
          label: { show: true, position: 'top', color: chartTheme.legendColor, fontSize: 10 },
        },
      ],
    }),
    [subjectDeltas, chartTheme, t],
  )

  return (
    <ChartCard
      title={t('page.academics.chart.subjectDelta')}
      dotColor={CHART_BRAND.blue}
      height={240}
      option={option}
      padding="sm"
    />
  )
}
