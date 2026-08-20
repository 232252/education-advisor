// =============================================================
// 学业选项卡 — 从学业模块(academic:* IPC)加载成绩,与 AcademicsPage 联动
// 展示各考试成绩卡片 / 成绩趋势 / 偏科分析 / 考试对比
// 纯计算逻辑提取至 lib/academics-metrics.ts,
// UI 块提取至 components/academics/ 下独立组件
// =============================================================

import type { EAAEventRecord, ExamDef, GradeRecord } from '@shared/types'
import { AlertTriangle, BookOpen, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '../../../components/Button'
import { EmptyState } from '../../../components/EmptyState'
import { CardSkeleton } from '../../../components/Skeleton'
import { t } from '../../../i18n'
import {
  analyzeSubjects,
  buildComparison,
  buildTrendData,
  filterExamsWithGrades,
  groupGradesByExam,
} from '../../../lib/academics'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'
import { ExamCompareCard } from '../components/academics/ExamCompareCard'
import { ExamGradeCards } from '../components/academics/ExamGradeCards'
import { SubjectAnalysisCard } from '../components/academics/SubjectAnalysisCard'
import { TrendChart } from '../components/academics/TrendChart'

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
  /** 考试/成绩加载失败信息;非空时显示错误态,与"暂无成绩"空态区分 */
  const [loadError, setLoadError] = useState<string | null>(null)
  // 考试对比状态
  const [compareExamAId, setCompareExamAId] = useState<string>('')
  const [compareExamBId, setCompareExamBId] = useState<string>('')
  const [conductEvents, setConductEvents] = useState<EAAEventRecord[] | null>(null)

  // 从学业模块加载考试列表和该学生成绩
  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [examRes, gradeRes] = await Promise.allSettled([
        getAPI().academic.listExams(),
        getAPI().academic.getGrades(studentName),
      ])
      const errors: string[] = []
      if (examRes.status === 'fulfilled' && examRes.value.success && examRes.value.data) {
        setExams(examRes.value.data)
      } else {
        setExams([])
        errors.push(
          examRes.status === 'rejected'
            ? `${t('page.students.academics.examListLoadFailed', '考试列表加载失败')}: ${String(examRes.reason)}`
            : `${t('page.students.academics.examListLoadFailed', '考试列表加载失败')}: ${examRes.value.error ?? t('error.unknown', '未知错误')}`,
        )
      }
      if (gradeRes.status === 'fulfilled' && gradeRes.value.success && gradeRes.value.data) {
        setGrades(gradeRes.value.data)
      } else {
        setGrades([])
        errors.push(
          gradeRes.status === 'rejected'
            ? `${t('page.students.academics.gradesLoadFailed', '成绩加载失败')}: ${String(gradeRes.reason)}`
            : `${t('page.students.academics.gradesLoadFailed', '成绩加载失败')}: ${gradeRes.value.error ?? t('error.unknown', '未知错误')}`,
        )
      }
      if (errors.length > 0) {
        console.warn('[StudentProfile.Academics] Load failed:', errors)
        setLoadError(errors.join(';'))
      }
    } catch (err) {
      console.warn('[StudentProfile.Academics] Load failed:', err)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [studentName])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 按日期升序排列的考试 (有成绩的)
  const sortedExams = useMemo(() => filterExamsWithGrades(exams, grades), [exams, grades])

  // 成绩按考试分组: examId → GradeRecord[]
  const gradesByExam = useMemo(() => groupGradesByExam(grades), [grades])

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
          // M10: range 结果达上限时提醒缩小日期范围
          if (res.data.truncated) {
            toast.warning(t('toast.eaa.rangeTruncated'))
          }
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
  const comparison = useMemo(
    () => buildComparison(gradesByExam, compareExamAId, compareExamBId, conductEvents, studentName),
    [gradesByExam, compareExamAId, compareExamBId, conductEvents, studentName],
  )

  // 偏科分析: 计算各科目平均分
  const subjectAnalysis = useMemo(() => analyzeSubjects(grades), [grades])

  // 趋势图数据: x轴=考试名, series=各科目分数
  const trendData = useMemo(
    () => buildTrendData(sortedExams, gradesByExam),
    [sortedExams, gradesByExam],
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )
  }

  if (loadError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title={t('page.students.academics.loadFailed', '学业数据加载失败')}
        description={`${loadError} — ${t('page.students.academics.loadFailedHint', '数据可能存在但未能读取,请重试;若持续失败请检查数据目录或查看日志')}`}
        action={
          <Button onClick={loadData} icon={<RotateCw size={14} aria-hidden />}>
            {t('common.retry', '重试')}
          </Button>
        }
      />
    )
  }

  if (grades.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-6 w-6" />}
        title={t('page.students.academics.empty', '暂无学业成绩')}
        description={t(
          'page.students.academics.emptyHint',
          '请到「学业」页面录入考试成绩,数据将自动同步至此',
        )}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('page.students.academics.title', '学业成绩')}
        </h4>
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {grades.length} {t('page.students.academics.gradeCount', '条成绩')} · {sortedExams.length}{' '}
          {t('page.students.academics.examCount', '场考试')}
        </span>
      </div>

      {/* 各考试成绩卡片 */}
      <ExamGradeCards sortedExams={sortedExams} gradesByExam={gradesByExam} />

      {/* 成绩趋势图 */}
      {trendData && trendData.series.length > 0 && <TrendChart trendData={trendData} />}

      {/* 偏科分析 */}
      {subjectAnalysis.all.length > 0 && <SubjectAnalysisCard subjectAnalysis={subjectAnalysis} />}

      {/* 考试对比 */}
      {sortedExams.length >= 2 && (
        <ExamCompareCard
          sortedExams={sortedExams}
          compareExamAId={compareExamAId}
          compareExamBId={compareExamBId}
          onCompareExamAChange={setCompareExamAId}
          onCompareExamBChange={setCompareExamBId}
          comparison={comparison}
        />
      )}
    </div>
  )
}
