// =============================================================
// 成绩趋势线图卡 — X=考试名, Y=分数, 每个科目一条线
// (option 构造内联不导出, 与 Dashboard 图表组件模式一致)
// =============================================================

import type { ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import { TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { Card } from '../../../../components/Card'
import { EmptyState } from '../../../../components/EmptyState'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { useTheme } from '../../../../hooks/useTheme'
import { echarts } from '../../../../lib/echarts-setup'
import { SUBJECT_COLORS } from '../../lib/academics-metrics'

interface TrendChartCardProps {
  /** 与成绩记录关联的有效考试 (按日期升序) */
  examsWithGrades: ExamDef[]
  subjects: SubjectDef[]
  grades: GradeRecord[]
}

export function TrendChartCard({ examsWithGrades, subjects, grades }: TrendChartCardProps) {
  // 主题派生色：从公共 useChartTheme 获取；isDark 由 useTheme 派生（chartTheme 不含）
  // 原 themeProps.axisColor 与 legendColor 同值（均为 #9ca3af/#6b7280），故两者复用同一值
  const { gridColor, legendColor } = useChartTheme()
  const axisColor = legendColor
  const isDark = useTheme() === 'dark'

  /** 趋势线图 option — X=考试名, Y=分数, 每个科目一条线 */
  const trendChartOption = useMemo(() => {
    const xData = examsWithGrades.map((e) => e.name)
    const series = subjects
      .map((sub, idx) => {
        const data = examsWithGrades.map((exam) => {
          const g = grades.find((gr) => gr.examId === exam.id && gr.subjectId === sub.id)
          return g?.score ?? null
        })
        // 只显示有数据的科目
        if (!data.some((v) => v != null)) return null
        return {
          name: sub.name,
          type: 'line' as const,
          data,
          smooth: true,
          lineStyle: { color: SUBJECT_COLORS[idx % SUBJECT_COLORS.length], width: 2 },
          itemStyle: { color: SUBJECT_COLORS[idx % SUBJECT_COLORS.length] },
          symbol: 'circle',
          symbolSize: 5,
        }
      })
      .filter(Boolean) as Array<Record<string, unknown>>

    return {
      animation: true,
      animationDuration: 800,
      tooltip: {
        trigger: 'axis' as const,
        backgroundColor: isDark ? '#1f2937' : '#fff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        textStyle: { color: isDark ? '#d1d5db' : '#374151' },
      },
      legend: {
        data: series.map((s) => s.name as string),
        bottom: 0,
        textStyle: { color: legendColor, fontSize: 11 },
        type: 'scroll' as const,
      },
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      xAxis: {
        type: 'category' as const,
        data: xData,
        axisLabel: { color: axisColor, fontSize: 11 },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: 'value' as const,
        axisLabel: { color: axisColor },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' as const } },
      },
      series,
    }
  }, [examsWithGrades, grades, subjects, isDark, axisColor, gridColor, legendColor])

  return (
    <Card padding="md" className="lg:col-span-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-blue-500" />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">📈 成绩趋势</h3>
      </div>
      {examsWithGrades.length > 0 ? (
        <ReactEChartsCore echarts={echarts} style={{ height: 300 }} option={trendChartOption} />
      ) : (
        <EmptyState
          icon={<TrendingUp size={28} />}
          title="暂无趋势数据"
          className="h-[300px] py-0"
        />
      )}
    </Card>
  )
}
