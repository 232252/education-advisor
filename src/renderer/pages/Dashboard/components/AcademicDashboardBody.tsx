// =============================================================
// AcademicDashboardBody — 成绩优先视图主体
// 布局对齐操行仪表盘：统计行 → 快捷入口 → 双图 → 三卡片
// =============================================================

import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { BookOpen } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/Button'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import { SubjectAvgChartCard } from '../../Academics/components/overview/SubjectAvgChartCard'
import {
  computeAcademicStats,
  computeExamSubjectAvgs,
  computeGradeBands,
  computeStudentGradeRows,
  flattenClassGrades,
  rankStudentGrades,
  watchlistStudents,
} from '../dashboard-academic-stats'
import { EXAM_FILTER_ALL, SUBJECT_FILTER_ALL } from '../dashboard-lens'
import { AcademicShortcutsCard } from './AcademicShortcutsCard'
import { AcademicStatsRow } from './AcademicStatsRow'
import { DashboardCardSkeleton } from './DashboardCardSkeleton'
import { GradeBandChartCard } from './GradeBandChartCard'
import { GradeRankingCard } from './GradeRankingCard'
import { GradeWatchlistCard } from './GradeWatchlistCard'
import { LatestExamSummaryCard } from './LatestExamSummaryCard'

export function AcademicDashboardBody({
  students,
  exams,
  subjects,
  examId,
  subjectId,
  classGrades,
  catalogReady,
  gradesReady,
}: {
  students: EAAStudent[]
  exams: ExamDef[]
  subjects: SubjectDef[]
  examId: string
  subjectId: string
  classGrades: Record<string, GradeRecord[]>
  catalogReady: boolean
  gradesReady: boolean
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const currentExam = useMemo(() => exams.find((e) => e.id === examId) ?? null, [exams, examId])
  const allExamsSelected = examId === EXAM_FILTER_ALL

  const rows = useMemo(
    () => computeStudentGradeRows(students, classGrades, subjectId),
    [students, classGrades, subjectId],
  )
  const stats = useMemo(() => computeAcademicStats(rows, exams.length), [rows, exams.length])
  const bands = useMemo(() => computeGradeBands(rows), [rows])
  const ranked = useMemo(() => rankStudentGrades(rows), [rows])
  const watchlist = useMemo(() => watchlistStudents(rows), [rows])
  const flatGrades = useMemo(() => flattenClassGrades(classGrades), [classGrades])
  const subjectAvgs = useMemo(
    () => computeExamSubjectAvgs(flatGrades, subjects),
    [flatGrades, subjects],
  )

  const avgLabel = useMemo(() => {
    const scored = rows.filter((r) => r.displayScore != null)
    if (scored.length === 0) return '—'
    const avg = scored.reduce((acc, r) => acc + (r.displayScore as number), 0) / scored.length
    return subjectId === SUBJECT_FILTER_ALL ? `${avg.toFixed(1)}%` : avg.toFixed(1)
  }, [rows, subjectId])

  const openStudentAi = (entityId: string) => {
    navigate(`/students?entity_id=${encodeURIComponent(entityId)}&tab=ai`)
  }

  if (!catalogReady) {
    return <DashboardCardSkeleton />
  }

  if (exams.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title={t('page.dashboard.academic.summary.empty')}
        description={t('page.dashboard.academic.summary.noExam')}
        action={
          <Button variant="secondary" onClick={() => navigate('/academics?tab=exams')}>
            {t('page.dashboard.academic.summary.createExam')}
          </Button>
        }
      />
    )
  }

  return (
    <>
      <AcademicStatsRow stats={stats} avgLabel={avgLabel} />
      <AcademicShortcutsCard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {gradesReady ? <GradeBandChartCard bands={bands} /> : <DashboardCardSkeleton />}
        {gradesReady ? (
          <SubjectAvgChartCard subjects={subjects} grades={flatGrades} />
        ) : (
          <DashboardCardSkeleton />
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {gradesReady ? (
          <GradeWatchlistCard items={watchlist} onSelectStudent={openStudentAi} />
        ) : (
          <DashboardCardSkeleton />
        )}
        {gradesReady ? (
          <GradeRankingCard items={ranked} onSelectStudent={openStudentAi} />
        ) : (
          <DashboardCardSkeleton />
        )}
        {gradesReady ? (
          <LatestExamSummaryCard
            exam={currentExam}
            allExamsSelected={allExamsSelected}
            stats={stats}
            subjectAvgs={subjectAvgs}
          />
        ) : (
          <DashboardCardSkeleton />
        )}
      </div>
    </>
  )
}
