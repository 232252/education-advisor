// =============================================================
// 科目平均分柱状图卡 — X=科目, Y=平均分
// (option 构造内联不导出, 与 Dashboard 图表组件模式一致)
// =============================================================

import type { GradeRecord, SubjectDef } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import { useMemo } from 'react'
import { Card } from '../../../../components/Card'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { useTheme } from '../../../../hooks/useTheme'
import { echarts } from '../../../../lib/echarts-setup'
import { calcSubjectAvg, SUBJECT_COLORS } from '../../lib/academics-metrics'

interface SubjectAvgChartCardProps {
  subjects: SubjectDef[]
  grades: GradeRecord[]
}

export function SubjectAvgChartCard({ subjects, grades }: SubjectAvgChartCardProps) {
  const { gridColor, legendColor } = useChartTheme()
  const axisColor = legendColor
  const isDark = useTheme() === 'dark'

  /** 科目柱状图 option — X=科目, Y=平均分 */
  const subjectBarOption = useMemo(() => {
    const subjectAvgs = subjects.map((sub, idx) => {
      const avg = calcSubjectAvg(grades, sub.id)
      return {
        name: sub.name,
        value: avg != null ? Number(avg.toFixed(1)) : 0,
        hasData: avg != null,
        itemStyle: {
          borderRadius: [6, 6, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: SUBJECT_COLORS[idx % SUBJECT_COLORS.length] },
            { offset: 1, color: `${SUBJECT_COLORS[idx % SUBJECT_COLORS.length]}80` },
          ]),
        },
      }
    })

    return {
      animation: true,
      animationDuration: 800,
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: isDark ? '#1f2937' : '#fff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        textStyle: { color: isDark ? '#d1d5db' : '#374151' },
        formatter: (params: Array<{ name: string; value: number; data: { hasData: boolean } }>) => {
          const p = params[0]
          return p.data.hasData ? `${p.name}: ${p.value} 分` : `${p.name}: 暂无数据`
        },
      },
      grid: { left: 8, right: 8, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: subjectAvgs.map((s) => s.name),
        axisLabel: { color: axisColor, fontSize: 11, rotate: subjects.length > 6 ? 30 : 0 },
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { color: axisColor },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' as const } },
      },
      series: [
        {
          type: 'bar' as const,
          data: subjectAvgs,
          barWidth: '50%',
        },
      ],
    }
  }, [grades, subjects, isDark, axisColor, gridColor])

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">📊 科目平均分</h3>
      </div>
      <ReactEChartsCore echarts={echarts} style={{ height: 260 }} option={subjectBarOption} />
    </Card>
  )
}
