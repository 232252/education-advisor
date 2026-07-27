// =============================================================
// 学业选项卡 — 从学业模块(academic:* IPC)加载成绩,与 AcademicsPage 联动
// 展示各考试成绩卡片 / 成绩趋势 / 偏科分析 / 考试对比
// =============================================================

import type { EAAEventRecord, ExamDef, GradeRecord } from '@shared/types'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DeltaBadge } from '../../../components/DeltaBadge'
import { EmptyState } from '../../../components/EmptyState'
import { useChartTheme } from '../../../hooks/useChartTheme'
import { echarts } from '../../../lib/echarts-setup'
import { getAPI } from '../../../lib/ipc-client'
import { CARD_BASE, cn } from '../../../lib/ui-utils'
import {
  aggregateConductDelta,
  compareStudentGrades,
  type StudentComparison,
} from '../../Academics/exam-comparison'

// 科目 ID → 中文名 (与学业模块保持一致)
const ACADEMIC_SUBJECT_MAP: Record<string, string> = {
  chinese: '语文',
  math: '数学',
  english: '英语',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  politics: '政治',
  history: '历史',
  geography: '地理',
  pe: '体育',
}

export function AcademicsTab({
  studentName,
}: {
  studentName: string
  // isDark 保留为可选 prop 以维持调用方契约；主题色现由 useChartTheme 内部从 useTheme() 派生
  isDark?: boolean
}) {
  const [exams, setExams] = useState<ExamDef[]>([])
  const [grades, setGrades] = useState<GradeRecord[]>([])
  const [loading, setLoading] = useState(true)
  // 考试对比状态
  const [compareExamAId, setCompareExamAId] = useState<string>('')
  const [compareExamBId, setCompareExamBId] = useState<string>('')
  const [conductEvents, setConductEvents] = useState<EAAEventRecord[] | null>(null)

  // 从学业模块加载考试列表和该学生成绩
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [examRes, gradeRes] = await Promise.allSettled([
        getAPI().academic.listExams(),
        getAPI().academic.getGrades(studentName),
      ])
      if (examRes.status === 'fulfilled' && examRes.value.success && examRes.value.data) {
        setExams(examRes.value.data)
      }
      if (gradeRes.status === 'fulfilled' && gradeRes.value.success && gradeRes.value.data) {
        setGrades(gradeRes.value.data)
      }
    } catch (err) {
      console.warn('[StudentProfile.Academics] Load failed:', err)
    } finally {
      setLoading(false)
    }
  }, [studentName])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 按日期升序排列的考试 (有成绩的)
  const sortedExams = useMemo(() => {
    const examIdsWithGrades = new Set(grades.map((g) => g.examId))
    return exams
      .filter((e) => examIdsWithGrades.has(e.id))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  }, [exams, grades])

  // 成绩按考试分组: examId → GradeRecord[]
  const gradesByExam = useMemo(() => {
    const m: Record<string, GradeRecord[]> = {}
    for (const g of grades) {
      if (!m[g.examId]) m[g.examId] = []
      m[g.examId].push(g)
    }
    return m
  }, [grades])

  // 默认选最近两场考试(有成绩的)作为对比对象
  useEffect(() => {
    if (sortedExams.length >= 2 && !compareExamAId && !compareExamBId) {
      setCompareExamAId(sortedExams[sortedExams.length - 2].id)
      setCompareExamBId(sortedExams[sortedExams.length - 1].id)
    }
  }, [sortedExams, compareExamAId, compareExamBId])

  // 加载两次考试日期之间的操行分事件(用于计算净变化)
  useEffect(() => {
    const examA = exams.find((e) => e.id === compareExamAId)
    const examB = exams.find((e) => e.id === compareExamBId)
    if (!examA || !examB || !examA.date || !examB.date) {
      setConductEvents(null)
      return
    }
    // range 需要 start <= end
    const start = examA.date <= examB.date ? examA.date : examB.date
    const end = examA.date <= examB.date ? examB.date : examA.date
    let cancelled = false
    getAPI()
      .eaa.range(start, end, 1000)
      .then((res) => {
        if (!cancelled && res.success && res.data) {
          setConductEvents(res.data.events ?? [])
        } else if (!cancelled) {
          setConductEvents(null)
        }
      })
      .catch(() => {
        if (!cancelled) setConductEvents(null)
      })
    return () => {
      cancelled = true
    }
  }, [compareExamAId, compareExamBId, exams])

  // 计算对比结果(纯函数)
  const comparison: StudentComparison | null = useMemo(() => {
    if (!compareExamAId || !compareExamBId || compareExamAId === compareExamBId) return null
    const gradesA = gradesByExam[compareExamAId] ?? []
    const gradesB = gradesByExam[compareExamBId] ?? []
    if (gradesA.length === 0 && gradesB.length === 0) return null
    // 只有当学生在事件数组中有匹配事件时才计算操行分变化;
    // 否则为 null(UI 不显示操行分),避免"无事件但显示 0"的误导
    const hasConductEvents = conductEvents?.some((e) => e.name === studentName)
    const conductDelta =
      hasConductEvents && conductEvents ? aggregateConductDelta(conductEvents, studentName) : null
    return compareStudentGrades(gradesA, gradesB, ACADEMIC_SUBJECT_MAP, conductDelta)
  }, [compareExamAId, compareExamBId, gradesByExam, conductEvents, studentName])

  // 偏科分析: 计算各科目平均分
  const subjectAnalysis = useMemo(() => {
    const subjectScores: Record<string, number[]> = {}
    for (const g of grades) {
      if (g.score != null && g.score > 0) {
        if (!subjectScores[g.subjectId]) subjectScores[g.subjectId] = []
        subjectScores[g.subjectId].push(g.score)
      }
    }
    const avgs = Object.entries(subjectScores).map(([subId, scores]) => ({
      subjectId: subId,
      subject: ACADEMIC_SUBJECT_MAP[subId] ?? subId,
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
    }))
    avgs.sort((a, b) => b.avg - a.avg)
    return {
      strongest: avgs[0] ?? null,
      weakest: avgs[avgs.length - 1] ?? null,
      all: avgs,
    }
  }, [grades])

  // 趋势图数据: x轴=考试名, series=各科目分数
  const trendData = useMemo(() => {
    if (sortedExams.length === 0) return null
    const labels = sortedExams.map((e) => e.name)
    // 收集所有出现过的科目
    const subjectIds = new Set<string>()
    for (const exam of sortedExams) {
      const gs = gradesByExam[exam.id] ?? []
      for (const g of gs) subjectIds.add(g.subjectId)
    }
    const series = Array.from(subjectIds)
      .map((subId) => ({
        name: ACADEMIC_SUBJECT_MAP[subId] ?? subId,
        data: sortedExams.map((exam) => {
          const g = (gradesByExam[exam.id] ?? []).find((gr) => gr.subjectId === subId)
          return g?.score ?? null
        }),
      }))
      .filter((s) => s.data.some((v) => v != null))
    return { labels, series }
  }, [sortedExams, gradesByExam])

  // 接入 Phase 1 useChartTheme（替代手写 axisColor/gridColor）
  // 颜色映射与 Dashboard Task 10 一致：axisColor→legendColor，gridColor→gridColor
  // colors 为本 Tab 数据系列自定义 10 色板，保持不变以维持视觉行为
  const chartTheme = useChartTheme()
  const colors = [
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-400">
        加载学业数据...
      </div>
    )
  }

  if (grades.length === 0) {
    return (
      <EmptyState
        icon="📚"
        title="暂无学业成绩"
        description="请到「学业」页面录入考试成绩,数据将自动同步至此"
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">学业成绩</h4>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {grades.length} 条成绩 · {sortedExams.length} 场考试
        </span>
      </div>

      {/* 各考试成绩卡片 */}
      <div className="grid grid-cols-2 gap-3">
        {sortedExams.map((exam) => {
          const examGrades = gradesByExam[exam.id] ?? []
          const avg =
            examGrades.length > 0
              ? examGrades
                  .filter((g) => g.score != null)
                  .reduce((sum, g) => sum + (g.score ?? 0), 0) /
                examGrades.filter((g) => g.score != null).length
              : 0
          return (
            <div key={exam.id} className={`${CARD_BASE} p-4 shadow-sm`}>
              <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3 flex items-center justify-between">
                <span>{exam.name}</span>
                <span className="text-[10px] text-gray-400">{exam.date}</span>
              </h5>
              <div className="space-y-1.5">
                {examGrades.map((g) => (
                  <div
                    key={`${g.examId}-${g.subjectId}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-600 dark:text-gray-300">
                      {ACADEMIC_SUBJECT_MAP[g.subjectId] ?? g.subjectId}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-gray-700 dark:text-gray-200">
                        {g.score ?? '-'}
                      </span>
                      {g.fullMark != null && (
                        <span className="text-[10px] text-gray-400">/{g.fullMark}</span>
                      )}
                      {g.classRank != null && (
                        <span className="text-[10px] text-blue-500">#{g.classRank}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {examGrades.some((g) => g.score != null) && (
                <div className="mt-3 pt-2 border-t border-gray-100 dark:border-white/[0.06] text-xs text-gray-500 dark:text-gray-400 flex justify-between">
                  <span>平均分</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                    {avg.toFixed(1)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 成绩趋势图 */}
      {trendData && trendData.series.length > 0 && (
        <div className={`${CARD_BASE} p-4 shadow-sm`}>
          <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📈 成绩趋势</h5>
          <ReactEChartsCore
            echarts={echarts}
            style={{ height: 280 }}
            option={{
              animation: true,
              animationDuration: 1000,
              tooltip: { trigger: 'axis' },
              legend: {
                data: trendData.series.map((s) => s.name),
                bottom: 0,
                textStyle: { color: chartTheme.legendColor, fontSize: 11 },
              },
              grid: { left: 8, right: 8, top: 8, bottom: 36, containLabel: true },
              xAxis: {
                type: 'category',
                data: trendData.labels,
                axisLabel: { color: chartTheme.legendColor, fontSize: 11 },
                axisLine: { lineStyle: { color: chartTheme.gridColor } },
              },
              yAxis: {
                type: 'value',
                axisLabel: { color: chartTheme.legendColor },
                splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
              },
              series: trendData.series.map((s, i) => ({
                name: s.name,
                type: 'line',
                data: s.data,
                smooth: true,
                lineStyle: { color: colors[i % colors.length], width: 2 },
                itemStyle: { color: colors[i % colors.length] },
                symbol: 'circle',
                symbolSize: 5,
              })),
            }}
          />
        </div>
      )}

      {/* 偏科分析 */}
      {subjectAnalysis.all.length > 0 && (
        <div className={`${CARD_BASE} p-4 shadow-sm`}>
          <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📊 偏科分析</h5>
          <div className="grid grid-cols-2 gap-4 mb-3">
            {subjectAnalysis.strongest && (
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-lg p-3 border border-green-200/50 dark:border-green-700/30">
                <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                  🏆 最强科目
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold text-green-700 dark:text-green-300">
                    {subjectAnalysis.strongest.subject}
                  </span>
                  <span className="text-sm text-green-500">
                    {subjectAnalysis.strongest.avg.toFixed(1)}分
                  </span>
                </div>
              </div>
            )}
            {subjectAnalysis.weakest && subjectAnalysis.all.length > 1 && (
              <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/10 dark:to-rose-900/10 rounded-lg p-3 border border-red-200/50 dark:border-red-700/30">
                <div className="text-xs text-red-600 dark:text-red-400 font-medium">⚠️ 最弱科目</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-lg font-bold text-red-700 dark:text-red-300">
                    {subjectAnalysis.weakest.subject}
                  </span>
                  <span className="text-sm text-red-500">
                    {subjectAnalysis.weakest.avg.toFixed(1)}分
                  </span>
                </div>
              </div>
            )}
          </div>
          <ReactEChartsCore
            echarts={echarts}
            style={{ height: 180 }}
            option={{
              animation: true,
              animationDuration: 800,
              grid: { left: 38, right: 8, top: 8, bottom: 0, containLabel: true },
              tooltip: { trigger: 'axis' },
              xAxis: {
                type: 'category',
                data: subjectAnalysis.all.map((a) => a.subject),
                axisLabel: { color: chartTheme.legendColor, fontSize: 11 },
                axisLine: { lineStyle: { color: chartTheme.gridColor } },
              },
              yAxis: {
                type: 'value',
                axisLabel: { color: chartTheme.legendColor },
                splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
              },
              series: [
                {
                  type: 'bar',
                  data: subjectAnalysis.all.map((a, i) => ({
                    value: a.avg.toFixed(1),
                    itemStyle: {
                      borderRadius: [4, 4, 0, 0],
                      color: colors[i % colors.length],
                    },
                  })),
                  barWidth: '40%',
                },
              ],
            }}
          />
        </div>
      )}

      {/* 考试对比 */}
      {sortedExams.length >= 2 && (
        <div className={`${CARD_BASE} p-4 shadow-sm`}>
          <h5 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">📈 考试对比</h5>

          {/* 对比选择器 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <select
              value={compareExamAId}
              onChange={(e) => setCompareExamAId(e.target.value)}
              className={cn(
                'text-xs rounded-lg border border-gray-300 dark:border-white/[0.08]',
                'bg-white dark:bg-[#0f1117] text-gray-700 dark:text-gray-300 px-2 py-1',
              )}
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
              value={compareExamBId}
              onChange={(e) => setCompareExamBId(e.target.value)}
              className={cn(
                'text-xs rounded-lg border border-gray-300 dark:border-white/[0.08]',
                'bg-white dark:bg-[#0f1117] text-gray-700 dark:text-gray-300 px-2 py-1',
              )}
            >
              <option value="">选择考试 B</option>
              {sortedExams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}（{e.date}）
                </option>
              ))}
            </select>
          </div>

          {comparison ? (
            <div className="space-y-3">
              {/* 各科目对比表 */}
              <div className="space-y-1.5">
                <div className="grid grid-cols-12 gap-2 text-[11px] text-gray-400 dark:text-gray-500 px-1">
                  <div className="col-span-3">科目</div>
                  <div className="col-span-2 text-center">A 分</div>
                  <div className="col-span-2 text-center">B 分</div>
                  <div className="col-span-2 text-center">分差</div>
                  <div className="col-span-3 text-center">班排变化</div>
                </div>
                {comparison.subjects.map((s) => (
                  <div
                    key={s.subjectId}
                    className="grid grid-cols-12 gap-2 text-xs items-center px-1 py-1 rounded hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                  >
                    <div className="col-span-3 text-gray-700 dark:text-gray-300">
                      {s.subjectName}
                    </div>
                    <div className="col-span-2 text-center font-mono text-gray-600 dark:text-gray-300">
                      {s.scoreA ?? '-'}
                    </div>
                    <div className="col-span-2 text-center font-mono text-gray-600 dark:text-gray-300">
                      {s.scoreB ?? '-'}
                    </div>
                    <div className="col-span-2 text-center">
                      <DeltaBadge delta={s.scoreDelta} />
                    </div>
                    <div className="col-span-3 text-center">
                      {s.classRankDelta !== null ? (
                        <span className="text-gray-500 dark:text-gray-400">
                          {s.classRankA ?? '-'} → {s.classRankB ?? '-'}{' '}
                          <DeltaBadge delta={s.classRankDelta} type="rank" suffix="名" />
                        </span>
                      ) : (
                        <span className="text-gray-400">未录入</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* 总分行 */}
              {comparison.totalScoreDelta !== null && (
                <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-white/[0.06] text-sm">
                  <span className="text-gray-600 dark:text-gray-300 font-medium">总分</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-gray-700 dark:text-gray-200">
                      {comparison.totalScoreA}
                    </span>
                    <span className="text-gray-400">→</span>
                    <span className="font-mono text-gray-700 dark:text-gray-200">
                      {comparison.totalScoreB}
                    </span>
                    <DeltaBadge delta={comparison.totalScoreDelta} suffix="分" />
                  </div>
                </div>
              )}

              {/* 汇总 + 操行分 */}
              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100 dark:border-white/[0.06] text-xs">
                <span className="text-gray-500 dark:text-gray-400">
                  进步{' '}
                  <span className="text-green-600 dark:text-green-400 font-bold">
                    {comparison.improvedSubjects}
                  </span>{' '}
                  科
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  退步{' '}
                  <span className="text-red-600 dark:text-red-400 font-bold">
                    {comparison.declinedSubjects}
                  </span>{' '}
                  科
                </span>
                {comparison.unchangedSubjects > 0 && (
                  <span className="text-gray-500 dark:text-gray-400">
                    持平 {comparison.unchangedSubjects} 科
                  </span>
                )}
                {comparison.conductDelta !== null && (
                  <span className="text-gray-500 dark:text-gray-400 flex items-center gap-1">
                    期间操行分
                    <DeltaBadge delta={comparison.conductDelta} suffix="分" />
                  </span>
                )}
              </div>

              {/* 并排柱状图 */}
              {comparison.subjects.filter((s) => s.scoreA !== null || s.scoreB !== null).length >
                0 && (
                <div className="mt-2">
                  <ReactEChartsCore
                    echarts={echarts}
                    style={{ height: 200 }}
                    option={{
                      tooltip: { trigger: 'axis' },
                      legend: {
                        data: ['考试 A', '考试 B'],
                        textStyle: { color: chartTheme.legendColor },
                      },
                      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
                      xAxis: {
                        type: 'category',
                        data: comparison.subjects.map((s) => s.subjectName),
                        axisLabel: { color: chartTheme.legendColor, fontSize: 10 },
                        axisLine: { lineStyle: { color: chartTheme.gridColor } },
                      },
                      yAxis: {
                        type: 'value',
                        axisLabel: { color: chartTheme.legendColor },
                        splitLine: { lineStyle: { color: chartTheme.gridColor, type: 'dashed' } },
                      },
                      series: [
                        {
                          name: '考试 A',
                          type: 'bar',
                          data: comparison.subjects.map((s) => s.scoreA ?? '-'),
                          itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] },
                        },
                        {
                          name: '考试 B',
                          type: 'bar',
                          data: comparison.subjects.map((s) => s.scoreB ?? '-'),
                          itemStyle: { color: '#a855f7', borderRadius: [4, 4, 0, 0] },
                        },
                      ],
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-gray-400 dark:text-gray-500">
              {compareExamAId === compareExamBId && compareExamAId
                ? '请选择两场不同的考试'
                : '请选择两场考试进行对比'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
