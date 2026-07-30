// =============================================================
// 成绩对比 Tab — 选两场考试,对比全班学生的分数/名次/操行分变化
// 包含: 班级/考试选择器、汇总卡片、科目平均变化柱状图、学生对比表
// =============================================================

import type {
  ClassEntity,
  EAAEventRecord,
  EAAStudent,
  ExamDef,
  GradeRecord,
  SubjectDef,
} from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import { Inbox, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '../../../components/Card'
import { DeltaBadge } from '../../../components/DeltaBadge'
import { EmptyState } from '../../../components/EmptyState'
import { CardSkeleton } from '../../../components/Skeleton'
import { useChartTheme } from '../../../hooks/useChartTheme'
import { useT } from '../../../i18n'
import { echarts } from '../../../lib/echarts-setup'
import { getAPI, getErrorMessage } from '../../../lib/ipc-client'
import {
  cn,
  deltaColor,
  INPUT_BASE,
  TABLE_ROW,
  TABLE_STICKY_HEAD,
  TABLE_TD,
  TABLE_TH,
} from '../../../lib/ui-utils'
import { toast } from '../../../stores/toastStore'
import {
  aggregateConductDelta,
  compareClassGrades,
  summarizeClassComparison,
} from '../exam-comparison'

export interface CompareTabProps {
  students: EAAStudent[]
  classList: ClassEntity[]
  subjects: SubjectDef[]
  exams: ExamDef[]
}

export function CompareTab({ students, classList, subjects, exams }: CompareTabProps) {
  const { t } = useT()
  // 主题派生色：原 themeProps.axisColor 与 legendColor 同值，故 axisColor 复用 legendColor
  const { gridColor, legendColor: axisColor } = useChartTheme()
  const [classFilter, setClassFilter] = useState<string>('__ALL__')
  const [examAId, setExamAId] = useState<string>('')
  const [examBId, setExamBId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [classGradesA, setClassGradesA] = useState<Record<string, GradeRecord[]> | null>(null)
  const [classGradesB, setClassGradesB] = useState<Record<string, GradeRecord[]> | null>(null)
  const [conductEvents, setConductEvents] = useState<EAAEventRecord[] | null>(null)

  // subjectId → 中文名(纯函数模块要求 Record<string,string>)
  const subjectNameMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of subjects) m[s.id] = s.name
    return m
  }, [subjects])

  // 当前班级的学生名(按 classFilter 过滤,status 非 Deleted)
  const targetStudentNames = useMemo(() => {
    let list = students.filter((s) => s.status !== 'Deleted')
    if (classFilter === '__NONE__') {
      list = list.filter((s) => !s.class_id)
    } else if (classFilter !== '__ALL__') {
      list = list.filter((s) => s.class_id === classFilter)
    }
    return list.map((s) => s.name)
  }, [students, classFilter])

  // 按日期升序的考试列表
  const sortedExams = useMemo(
    () => [...exams].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    [exams],
  )

  // 默认选最近两场
  useEffect(() => {
    if (sortedExams.length >= 2 && !examAId && !examBId) {
      setExamAId(sortedExams[sortedExams.length - 2].id)
      setExamBId(sortedExams[sortedExams.length - 1].id)
    }
  }, [sortedExams, examAId, examBId])

  // 加载对比数据
  const loadComparison = useCallback(async () => {
    if (!examAId || !examBId || examAId === examBId || targetStudentNames.length === 0) {
      setClassGradesA(null)
      setClassGradesB(null)
      setConductEvents(null)
      return
    }
    setLoading(true)
    try {
      const examA = exams.find((e) => e.id === examAId)
      const examB = exams.find((e) => e.id === examBId)
      const [resA, resB] = await Promise.allSettled([
        getAPI().academic.getClassGrades(targetStudentNames, examAId),
        getAPI().academic.getClassGrades(targetStudentNames, examBId),
      ])
      if (resA.status === 'fulfilled' && resA.value.success && resA.value.data) {
        setClassGradesA(resA.value.data)
      }
      if (resB.status === 'fulfilled' && resB.value.success && resB.value.data) {
        setClassGradesB(resB.value.data)
      }
      // 加载两次考试日期之间的操行分事件
      if (examA?.date && examB?.date) {
        const start = examA.date <= examB.date ? examA.date : examB.date
        const end = examA.date <= examB.date ? examB.date : examA.date
        try {
          const rangeRes = await getAPI().eaa.range(start, end, 5000)
          if (rangeRes.success && rangeRes.data) {
            setConductEvents(rangeRes.data.events ?? [])
          } else {
            setConductEvents(null)
          }
        } catch {
          setConductEvents(null)
        }
      }
    } catch (err) {
      console.warn('[CompareTab] load failed:', err)
      toast.error(
        getErrorMessage({ success: false } as never, t('page.academics.toast.compareLoadFailed')),
      )
    } finally {
      setLoading(false)
    }
  }, [examAId, examBId, exams, targetStudentNames, t])

  useEffect(() => {
    loadComparison()
  }, [loadComparison])

  // 计算对比结果(纯函数)
  const { studentComparisons, summary } = useMemo(() => {
    if (!classGradesA || !classGradesB) return { studentComparisons: [], summary: null }
    // 聚合每个学生的操行分变化
    const conductDeltas: Record<string, number> = {}
    if (conductEvents) {
      for (const name of targetStudentNames) {
        conductDeltas[name] = aggregateConductDelta(conductEvents, name)
      }
    }
    const comps = compareClassGrades(classGradesA, classGradesB, subjectNameMap, conductDeltas)
    // 按 totalScoreDelta 降序(进步多的在前)
    comps.sort((a, b) => {
      const da = a.totalScoreDelta ?? -Infinity
      const db = b.totalScoreDelta ?? -Infinity
      return db - da
    })
    return { studentComparisons: comps, summary: summarizeClassComparison(comps) }
  }, [classGradesA, classGradesB, conductEvents, targetStudentNames, subjectNameMap])

  const canCompare = examAId && examBId && examAId !== examBId && targetStudentNames.length > 0

  return (
    <div className="space-y-4">
      {/* 选择器栏 */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className={cn(INPUT_BASE)}
          >
            <option value="__ALL__">全部班级</option>
            <option value="__NONE__">未分班</option>
            {classList.map((c) => (
              <option key={c.class_id} value={c.class_id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-gray-400 text-sm">|</span>
          <select
            value={examAId}
            onChange={(e) => setExamAId(e.target.value)}
            className={cn(INPUT_BASE)}
          >
            <option value="">选择考试 A</option>
            {sortedExams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}（{e.date}）
              </option>
            ))}
          </select>
          <span className="text-gray-400">→</span>
          <select
            value={examBId}
            onChange={(e) => setExamBId(e.target.value)}
            className={cn(INPUT_BASE)}
          >
            <option value="">选择考试 B</option>
            {sortedExams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}（{e.date}）
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400 ml-auto">{targetStudentNames.length} 名学生</span>
        </div>
      </Card>

      {loading ? (
        <CardSkeleton />
      ) : !canCompare ? (
        <EmptyState
          icon={<TrendingUp size={28} />}
          title="选择两场考试进行对比"
          description={
            sortedExams.length < 2
              ? '至少需要 2 场考试才能对比'
              : examAId === examBId && examAId
                ? '请选择两场不同的考试'
                : '从上方选择班级和两场考试'
          }
        />
      ) : studentComparisons.length === 0 ? (
        <EmptyState
          icon={<Inbox size={28} />}
          title="暂无对比数据"
          description="所选班级在两次考试中均无成绩记录"
        />
      ) : (
        <>
          {/* 汇总卡片 */}
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card padding="sm">
                <div className="text-xs text-gray-400 mb-1">班级平均分变化</div>
                <div className={cn('text-lg font-bold', deltaColor(summary.avgScoreDelta))}>
                  {summary.avgScoreDelta > 0 ? '+' : ''}
                  {summary.avgScoreDelta.toFixed(1)}
                </div>
              </Card>
              <Card padding="sm">
                <div className="text-xs text-gray-400 mb-1">进步最多</div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                  {summary.mostImprovedStudent ?? '-'}
                </div>
                {summary.mostImprovedDelta !== null && (
                  <DeltaBadge delta={summary.mostImprovedDelta} suffix="分" />
                )}
              </Card>
              <Card padding="sm">
                <div className="text-xs text-gray-400 mb-1">退步最多</div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                  {summary.mostDeclinedStudent ?? '-'}
                </div>
                {summary.mostDeclinedDelta !== null && (
                  <DeltaBadge delta={summary.mostDeclinedDelta} suffix="分" />
                )}
              </Card>
              <Card padding="sm">
                <div className="text-xs text-gray-400 mb-1">参与对比</div>
                <div className="text-lg font-bold text-gray-700 dark:text-gray-200">
                  {summary.totalStudents}
                </div>
              </Card>
            </div>
          )}

          {/* 科目平均变化柱状图 */}
          {summary && summary.subjectDeltas.length > 0 && (
            <Card padding="sm">
              <h5 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-3">
                📊 各科目平均分变化
              </h5>
              <ReactEChartsCore
                echarts={echarts}
                style={{ height: 240 }}
                option={{
                  tooltip: { trigger: 'axis', formatter: '{b}: {c} 分' },
                  grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                  xAxis: {
                    type: 'category',
                    data: summary.subjectDeltas.map((s) => s.subjectName),
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
                      data: summary.subjectDeltas.map((s) => ({
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
                }}
              />
            </Card>
          )}

          {/* 学生对比表 */}
          <Card padding="sm" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className={cn(TABLE_STICKY_HEAD)}>
                  <tr>
                    <th className={TABLE_TH}>学生</th>
                    <th className={cn(TABLE_TH, 'text-center')}>总分 A</th>
                    <th className={cn(TABLE_TH, 'text-center')}>总分 B</th>
                    <th className={cn(TABLE_TH, 'text-center')}>总分变化</th>
                    <th className={cn(TABLE_TH, 'text-center')}>进步/退步</th>
                    <th className={cn(TABLE_TH, 'text-center')}>操行分变化</th>
                  </tr>
                </thead>
                <tbody>
                  {studentComparisons.map((sc) => (
                    <tr key={sc.studentName} className={TABLE_ROW}>
                      <td className={cn(TABLE_TD, 'text-gray-700 dark:text-gray-300')}>
                        {sc.studentName}
                      </td>
                      <td
                        className={cn(
                          TABLE_TD,
                          'text-center font-mono text-gray-600 dark:text-gray-300',
                        )}
                      >
                        {sc.totalScoreA ?? '-'}
                      </td>
                      <td
                        className={cn(
                          TABLE_TD,
                          'text-center font-mono text-gray-600 dark:text-gray-300',
                        )}
                      >
                        {sc.totalScoreB ?? '-'}
                      </td>
                      <td className={cn(TABLE_TD, 'text-center')}>
                        <DeltaBadge delta={sc.totalScoreDelta} suffix="分" />
                      </td>
                      <td className={cn(TABLE_TD, 'text-center text-xs')}>
                        <span className="text-green-600 dark:text-green-400">
                          {sc.improvedSubjects}
                        </span>
                        <span className="text-gray-300 mx-1">/</span>
                        <span className="text-red-600 dark:text-red-400">
                          {sc.declinedSubjects}
                        </span>
                      </td>
                      <td className={cn(TABLE_TD, 'text-center')}>
                        {sc.conductDelta !== null ? (
                          <DeltaBadge delta={sc.conductDelta} suffix="分" />
                        ) : (
                          <span className="text-gray-400 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
