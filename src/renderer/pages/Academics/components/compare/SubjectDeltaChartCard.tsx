// =============================================================
// 科目平均分变化柱状图卡 — 正=进步绿, 负=退步红
// (option 构造内联不导出, 与 Dashboard 图表组件模式一致)
// =============================================================

import ReactEChartsCore from 'echarts-for-react/esm/core'
import { useMemo } from 'react'
import { Card } from '../../../../components/Card'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { echarts } from '../../../../lib/echarts-setup'
import type { ClassComparisonSummary } from '../../exam-comparison'

interface SubjectDeltaChartCardProps {
  /** 各科平均分变化 (summary.subjectDeltas) */
  subjectDeltas: ClassComparisonSummary['subjectDeltas']
}

export function SubjectDeltaChartCard({ subjectDeltas }: SubjectDeltaChartCardProps) {
  // 主题派生色：原 themeProps.axisColor 与 legendColor 同值，故 axisColor 复用 legendColor
  const { gridColor, legendColor: axisColor } = useChartTheme()

  const option = useMemo(
    () => ({
      tooltip: { trigger: 'axis', formatter: '{b}: {c} 分' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: subjectDeltas.map((s) => s.subjectName),
        axisLabel: { color: axisColor, fontSize: 11 },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: axisColor },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      },
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
          label: { show: true, position: 'top', color: axisColor, fontSize: 10 },
        },
      ],
    }),
    [subjectDeltas, axisColor, gridColor],
  )

  return (
    <Card padding="sm">
      <h5 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-3">
        📊 各科目平均分变化
      </h5>
      <ReactEChartsCore echarts={echarts} style={{ height: 240 }} option={option} />
    </Card>
  )
}
