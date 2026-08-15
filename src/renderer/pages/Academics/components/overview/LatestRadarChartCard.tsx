// =============================================================
// 最新考试雷达图卡 — 每个科目一个轴, 显示最新一次考试的成绩
// (option 构造内联不导出, 与 Dashboard 图表组件模式一致)
// =============================================================

import type { ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import { Target } from 'lucide-react'
import { useMemo } from 'react'
import { Card } from '../../../../components/Card'
import { EmptyState } from '../../../../components/EmptyState'
import { useChartTheme } from '../../../../hooks/useChartTheme'
import { useTheme } from '../../../../hooks/useTheme'
import { echarts } from '../../../../lib/echarts-setup'

interface LatestRadarChartCardProps {
  /** 与成绩记录关联的有效考试 (按日期升序) */
  examsWithGrades: ExamDef[]
  subjects: SubjectDef[]
  grades: GradeRecord[]
}

export function LatestRadarChartCard({
  examsWithGrades,
  subjects,
  grades,
}: LatestRadarChartCardProps) {
  const { gridColor, legendColor } = useChartTheme()
  const axisColor = legendColor
  const isDark = useTheme() === 'dark'

  /** 雷达图 option — 每个科目一个轴, 显示最新一次考试的成绩 */
  const radarChartOption = useMemo(() => {
    if (examsWithGrades.length === 0) return null

    const latestExam = examsWithGrades[examsWithGrades.length - 1]
    const indicator = subjects.map((sub) => ({
      name: sub.name,
      max: sub.fullMark,
    }))
    const latestScores = subjects.map((sub) => {
      const g = grades.find((gr) => gr.examId === latestExam.id && gr.subjectId === sub.id)
      return g?.score ?? 0
    })

    return {
      animation: true,
      animationDuration: 1000,
      tooltip: {
        backgroundColor: isDark ? '#1f2937' : '#fff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        textStyle: { color: isDark ? '#d1d5db' : '#374151' },
      },
      radar: {
        indicator,
        radius: '65%',
        center: ['50%', '50%'],
        axisName: { color: axisColor, fontSize: 11 },
        splitLine: { lineStyle: { color: gridColor } },
        splitArea: {
          areaStyle: {
            color: isDark
              ? ['transparent', 'rgba(255,255,255,0.02)']
              : ['transparent', 'rgba(0,0,0,0.02)'],
          },
        },
        axisLine: { lineStyle: { color: gridColor } },
      },
      series: [
        {
          type: 'radar' as const,
          data: [
            {
              value: latestScores,
              name: latestExam.name,
              areaStyle: { color: 'rgba(59,130,246,0.2)' },
              lineStyle: { color: '#3b82f6', width: 2 },
              itemStyle: { color: '#3b82f6' },
            },
          ],
        },
      ],
    }
  }, [examsWithGrades, grades, subjects, isDark, axisColor, gridColor])

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-purple-500" />
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          🎯 最新考试雷达图
        </h3>
      </div>
      {radarChartOption ? (
        <ReactEChartsCore echarts={echarts} style={{ height: 260 }} option={radarChartOption} />
      ) : (
        <EmptyState icon={<Target size={28} />} title="暂无数据" className="h-[260px] py-0" />
      )}
    </Card>
  )
}
