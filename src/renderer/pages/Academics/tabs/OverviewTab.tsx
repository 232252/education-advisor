// =============================================================
// 成绩总览 Tab — 3 个 echarts 图表(趋势线图/科目柱状图/雷达图)+ 成绩明细表
// 本 Tab 独占的常量: SUBJECT_COLORS(配色)、calcSubjectAvg、sortByDateAsc
// =============================================================

import type { ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { useMemo } from 'react'
import { Badge } from '../../../components/Badge'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { CardSkeleton } from '../../../components/Skeleton'
import { useChartTheme } from '../../../hooks/useChartTheme'
import { useTheme } from '../../../hooks/useTheme'
import { echarts } from '../../../lib/echarts-setup'
import { cn } from '../../../lib/ui-utils'
import { EXAM_TYPE_BADGE, EXAM_TYPE_LABEL, sortByDateDesc } from '../academics-shared'

/** 图表配色 — 每个科目一种颜色 */
const SUBJECT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#06b6d4',
  '#ec4899',
  '#eab308',
  '#14b8a6',
  '#6366f1',
]

/** 计算指定科目的平均分 (跨多次考试) */
function calcSubjectAvg(grades: GradeRecord[], subjectId: string): number | null {
  const scores = grades
    .filter((g) => g.subjectId === subjectId && g.score != null && g.score > 0)
    .map((g) => g.score as number)
  if (scores.length === 0) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

/** 按考试日期升序排序 */
function sortByDateAsc<T extends { date?: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
}

export interface OverviewTabProps {
  studentName: string
  subjects: SubjectDef[]
  exams: ExamDef[]
  grades: GradeRecord[]
  gradesLoading: boolean
}

export function OverviewTab({
  studentName,
  subjects,
  exams,
  grades,
  gradesLoading,
}: OverviewTabProps) {
  // 主题派生色：从公共 useChartTheme 获取；isDark 由 useTheme 派生（chartTheme 不含）
  // 原 themeProps.axisColor 与 legendColor 同值（均为 #9ca3af/#6b7280），故两者复用同一值
  const { gridColor, legendColor } = useChartTheme()
  const axisColor = legendColor
  const isDark = useTheme() === 'dark'

  /** 与成绩记录关联的有效考试 (按日期升序) */
  const sortedExamsWithGrades = useMemo(() => {
    const examIds = new Set(grades.map((g) => g.examId))
    const matched = exams.filter((e) => examIds.has(e.id))
    return sortByDateAsc(matched)
  }, [exams, grades])

  /** 趋势线图 option — X=考试名, Y=分数, 每个科目一条线 */
  const trendChartOption = useMemo(() => {
    const xData = sortedExamsWithGrades.map((e) => e.name)
    const series = subjects
      .map((sub, idx) => {
        const data = sortedExamsWithGrades.map((exam) => {
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
  }, [sortedExamsWithGrades, grades, subjects, isDark, axisColor, gridColor, legendColor])

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

  /** 雷达图 option — 每个科目一个轴, 显示最新一次考试的成绩 */
  const radarChartOption = useMemo(() => {
    if (sortedExamsWithGrades.length === 0) return null

    const latestExam = sortedExamsWithGrades[sortedExamsWithGrades.length - 1]
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
  }, [sortedExamsWithGrades, grades, subjects, isDark, axisColor, gridColor])

  /** 成绩表数据 — 按考试日期降序 */
  const gradeTableData = useMemo(() => {
    return sortByDateDesc(sortedExamsWithGrades).map((exam) => {
      const examGrades = grades.filter((g) => g.examId === exam.id)
      const scoresBySubject: Record<string, GradeRecord | undefined> = {}
      for (const sub of subjects) {
        scoresBySubject[sub.id] = examGrades.find((g) => g.subjectId === sub.id)
      }
      // 取第一个有 classRank 的记录作为本次考试的排名
      const rankRecord = examGrades.find((g) => g.classRank != null)
      return {
        exam,
        scoresBySubject,
        classRank: rankRecord?.classRank,
      }
    })
  }, [sortedExamsWithGrades, grades, subjects])

  if (gradesLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }

  if (grades.length === 0) {
    return (
      <EmptyState
        icon="📚"
        title="暂无成绩数据"
        description={`${studentName} 还没有任何成绩记录,请先在"考试管理"中创建考试,然后在"成绩录入"中录入成绩`}
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* 3 个图表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 趋势线图 (占两列) */}
        <Card padding="md" className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">📈 成绩趋势</h3>
          </div>
          {sortedExamsWithGrades.length > 0 ? (
            <ReactEChartsCore echarts={echarts} style={{ height: 300 }} option={trendChartOption} />
          ) : (
            <EmptyState icon="📈" title="暂无趋势数据" className="h-[300px] py-0" />
          )}
        </Card>

        {/* 科目柱状图 */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              📊 科目平均分
            </h3>
          </div>
          <ReactEChartsCore echarts={echarts} style={{ height: 260 }} option={subjectBarOption} />
        </Card>

        {/* 雷达图 */}
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
            <EmptyState icon="🎯" title="暂无数据" className="h-[260px] py-0" />
          )}
        </Card>
      </div>

      {/* 成绩表 */}
      <Card padding="md">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-orange-500" />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">📋 成绩明细</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-200 dark:border-white/[0.06]">
                <th className="py-2 px-3 font-medium">考试</th>
                <th className="py-2 px-3 font-medium">类型</th>
                <th className="py-2 px-3 font-medium">日期</th>
                {subjects.map((sub) => (
                  <th key={sub.id} className="py-2 px-3 font-medium text-center">
                    {sub.name}
                    <span className="text-[10px] text-gray-400 ml-0.5">/{sub.fullMark}</span>
                  </th>
                ))}
                <th className="py-2 px-3 font-medium text-center">班级排名</th>
              </tr>
            </thead>
            <tbody>
              {gradeTableData.map(({ exam, scoresBySubject, classRank }) => (
                <tr
                  key={exam.id}
                  className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
                >
                  <td className="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">
                    {exam.name}
                  </td>
                  <td className="py-2 px-3">
                    <Badge variant={EXAM_TYPE_BADGE[exam.type]}>{EXAM_TYPE_LABEL[exam.type]}</Badge>
                  </td>
                  <td className="py-2 px-3 text-gray-500 dark:text-gray-400 text-xs">
                    {exam.date}
                  </td>
                  {subjects.map((sub) => {
                    const g = scoresBySubject[sub.id]
                    return (
                      <td
                        key={sub.id}
                        className="py-2 px-3 text-center font-mono text-gray-700 dark:text-gray-300"
                      >
                        {g?.score != null ? (
                          <span
                            className={cn(
                              g.score >= sub.fullMark * 0.85
                                ? 'text-green-600 dark:text-green-400 font-medium'
                                : g.score < sub.fullMark * 0.6
                                  ? 'text-red-600 dark:text-red-400 font-medium'
                                  : '',
                            )}
                          >
                            {g.score}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">-</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="py-2 px-3 text-center font-mono">
                    {classRank != null ? (
                      <span className="text-blue-600 dark:text-blue-400 font-medium">
                        第 {classRank}
                      </span>
                    ) : (
                      <span className="text-gray-300 dark:text-gray-600">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
