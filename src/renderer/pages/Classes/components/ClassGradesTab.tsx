// =============================================================
// ClassProfile — Grades tab: single-exam analytics + lightweight
// two-exam movement + multi-exam class avg trend + print sheet +
// AI class analysis (academic agent, aggregate context).
// Reuses Dashboard Grade* cards, Academics SubjectAvgChartCard /
// comparison helpers, and existing ClassGradeSheetDocument print.
// =============================================================

import type { EAAStudent } from '@shared/types'
import { BookOpen, PencilLine, Printer, TrendingUp, Users } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../components/Button'
import { Card } from '../../../components/Card'
import { DeltaBadge } from '../../../components/DeltaBadge'
import { EmptyState } from '../../../components/EmptyState'
import { ClassGradeSheetDocument } from '../../../components/print/ClassGradeSheetDocument'
import { PrintOverlay } from '../../../components/print/PrintOverlay'
import { useT } from '../../../i18n'
import { mergeExamSubjects } from '../../../lib/academics'
import {
  cn,
  INPUT_SM,
  TABLE_ROW,
  TABLE_STICKY_HEAD,
  TABLE_TD,
  TABLE_TH,
} from '../../../lib/ui-utils'
import { SubjectAvgChartCard } from '../../Academics/components/overview/SubjectAvgChartCard'
import { useExamGradeSheet } from '../../Academics/hooks/useExamGradeSheet'
import { AcademicStatsRow } from '../../Dashboard/components/AcademicStatsRow'
import { DashboardCardSkeleton } from '../../Dashboard/components/DashboardCardSkeleton'
import { GradeBandChartCard } from '../../Dashboard/components/GradeBandChartCard'
import { GradeRankingCard } from '../../Dashboard/components/GradeRankingCard'
import { GradeWatchlistCard } from '../../Dashboard/components/GradeWatchlistCard'
import {
  computeAcademicStats,
  computeGradeBands,
  computeStudentGradeRows,
  flattenClassGrades,
  rankStudentGrades,
  watchlistStudents,
} from '../../Dashboard/dashboard-academic-stats'
import { SUBJECT_FILTER_ALL } from '../../Dashboard/dashboard-lens'
import { useClassGradesAnalytics } from '../hooks/useClassGradesAnalytics'
import { EXAM_FILTER_ALL, isForeignClassExam } from '../lib/exam-scope'
import { ClassAvgTrendCard } from './ClassAvgTrendCard'
import { ClassGradesAiPanel } from './ClassGradesAiPanel'

export function ClassGradesTab({
  students,
  classLabel,
  classId,
}: {
  students: EAAStudent[]
  /** Class display name for print sheet header */
  classLabel?: string
  /** 当前班级编号(自动选本班考试 + 标记他班考试) */
  classId?: string | null
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const analytics = useClassGradesAnalytics({ students, classId })
  const {
    exams,
    subjects,
    examId,
    setExamId,
    subjectId,
    setSubjectId,
    selectedExam,
    classGrades,
    examAId,
    setExamAId,
    examBId,
    setExamBId,
    studentComparisons,
    movement,
    canCompare,
    trendPoints,
    trendReady,
    catalogReady,
    gradesReady,
    compareReady,
    reload,
  } = analytics

  /**
   * 科目筛选/图表用的科目 = 目录 ∪ 当前口径实际出现的科目:
   * AI 导入的「通用技术」等目录外科目不补齐时,下拉选不到、
   * 科目均分图也不画,看起来像"整科成绩不存在"。
   * 「全部考试」无单场考试可参照,按成绩记录里的科目补齐。
   */
  const filterSubjects = useMemo(() => {
    const flat = Object.values(classGrades).flat()
    return selectedExam
      ? mergeExamSubjects(subjects, [selectedExam], flat)
      : mergeExamSubjects(subjects, [], flat, [...new Set(flat.map((g) => g.subjectId))])
  }, [subjects, selectedExam, classGrades])

  const gradeSheet = useExamGradeSheet(students, filterSubjects)

  const entityByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of students) m.set(s.name, s.entity_id)
    return m
  }, [students])

  const openStudent = (entityId: string) => {
    navigate(`/academics?entity_id=${encodeURIComponent(entityId)}`)
  }

  const openAcademicsTab = (tab: 'entry' | 'compare' | 'exams') => {
    navigate(`/academics?tab=${tab}`)
  }

  const rows = useMemo(
    () => computeStudentGradeRows(students, classGrades, subjectId),
    [students, classGrades, subjectId],
  )
  const stats = useMemo(() => computeAcademicStats(rows, exams.length), [rows, exams.length])
  const bands = useMemo(() => computeGradeBands(rows), [rows])
  const ranked = useMemo(() => rankStudentGrades(rows), [rows])
  const watchlist = useMemo(() => watchlistStudents(rows), [rows])
  const flatGrades = useMemo(() => flattenClassGrades(classGrades), [classGrades])

  const avgLabel = useMemo(() => {
    const scored = rows.filter((r) => r.displayScore != null)
    if (scored.length === 0) return '—'
    const avg = scored.reduce((acc, r) => acc + (r.displayScore as number), 0) / scored.length
    return subjectId === SUBJECT_FILTER_ALL ? `${avg.toFixed(1)}%` : avg.toFixed(1)
  }, [rows, subjectId])

  const subjectLabel = useMemo(() => {
    if (subjectId === SUBJECT_FILTER_ALL) return t('page.dashboard.academic.filter.allSubjects')
    return filterSubjects.find((s) => s.id === subjectId)?.name ?? subjectId
  }, [subjectId, filterSubjects, t])

  const examAName = useMemo(() => exams.find((e) => e.id === examAId)?.name, [exams, examAId])
  const examBName = useMemo(() => exams.find((e) => e.id === examBId)?.name, [exams, examBId])

  const aiMovers = useMemo(
    () =>
      studentComparisons.map((sc) => ({
        studentName: sc.studentName,
        totalScoreDelta: sc.totalScoreDelta,
      })),
    [studentComparisons],
  )

  if (!catalogReady) {
    return <DashboardCardSkeleton />
  }

  if (students.length === 0) {
    return (
      <EmptyState
        icon={<Users size={28} />}
        title={t('page.classes.profile.noStudents')}
        description={t('page.classes.grades.emptyRosterDesc')}
      />
    )
  }

  if (exams.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={28} />}
        title={t('page.dashboard.academic.summary.empty')}
        description={t('page.dashboard.academic.summary.noExam')}
        action={
          <Button variant="secondary" onClick={() => openAcademicsTab('exams')}>
            {t('page.dashboard.academic.summary.createExam')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
          className={INPUT_SM}
          title={t('page.dashboard.academic.filter.exam')}
          aria-label={t('page.dashboard.academic.filter.exam')}
        >
          <option value={EXAM_FILTER_ALL}>{t('page.classes.grades.allExams', '全部考试')}</option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.name}
              {exam.date ? ` · ${exam.date}` : ''}
              {isForeignClassExam(exam, classId)
                ? ` · ${t('page.classes.grades.foreignExam', '他班')}`
                : ''}
            </option>
          ))}
        </select>
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className={INPUT_SM}
          title={t('page.dashboard.academic.filter.subject')}
          aria-label={t('page.dashboard.academic.filter.subject')}
        >
          <option value={SUBJECT_FILTER_ALL}>
            {t('page.dashboard.academic.filter.allSubjects')}
          </option>
          {filterSubjects.map((sub) => (
            <option key={sub.id} value={sub.id}>
              {sub.name}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={reload} aria-label={t('common.refresh')}>
          {t('common.refresh')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!selectedExam || gradeSheet.loading}
          onClick={() => selectedExam && void gradeSheet.printSheet(selectedExam)}
        >
          <Printer size={14} strokeWidth={2} />
          {t('page.classes.grades.printSheet')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => openAcademicsTab('entry')}>
          <PencilLine size={14} strokeWidth={2} />
          {t('page.classes.grades.shortcutEntry')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => openAcademicsTab('compare')}>
          <TrendingUp size={14} strokeWidth={2} />
          {t('page.classes.grades.shortcutCompare')}
        </Button>
      </div>

      {gradesReady && (
        <ClassGradesAiPanel
          classLabel={classLabel}
          examName={selectedExam?.name ?? t('page.classes.grades.allExams', '全部考试')}
          examDate={selectedExam?.date}
          subjectLabel={subjectLabel}
          stats={stats}
          avgLabel={avgLabel}
          ranked={ranked}
          watchlist={watchlist}
          movement={movement}
          canCompare={canCompare && compareReady}
          examAName={examAName}
          examBName={examBName}
          movers={aiMovers}
          disabled={stats.recordedCount === 0}
        />
      )}

      {gradesReady ? (
        <>
          {stats.recordedCount === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <span>{t('page.classes.grades.noGradesDesc')}</span>
              <Button variant="ghost" size="xs" onClick={() => openAcademicsTab('entry')}>
                {t('page.classes.grades.goEntry')}
              </Button>
            </div>
          )}
          <AcademicStatsRow stats={stats} avgLabel={avgLabel} />
          <ClassAvgTrendCard points={trendPoints} subjectId={subjectId} ready={trendReady} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GradeBandChartCard bands={bands} />
            <SubjectAvgChartCard subjects={filterSubjects} grades={flatGrades} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <GradeRankingCard items={ranked} onSelectStudent={openStudent} />
            <GradeWatchlistCard items={watchlist} onSelectStudent={openStudent} />
          </div>
        </>
      ) : (
        <DashboardCardSkeleton />
      )}

      <details
        className="rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary p-3"
        open
      >
        <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-200">
          {t('page.classes.grades.compareTitle')}
        </summary>
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              {t('page.classes.grades.compareBase')}
              <select
                value={examAId}
                onChange={(e) => setExamAId(e.target.value)}
                className={cn(INPUT_SM, 'ml-1')}
                aria-label={t('page.classes.grades.compareBase')}
              >
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                    {exam.date ? ` · ${exam.date}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              {t('page.classes.grades.compareNext')}
              <select
                value={examBId}
                onChange={(e) => setExamBId(e.target.value)}
                className={cn(INPUT_SM, 'ml-1')}
                aria-label={t('page.classes.grades.compareNext')}
              >
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                    {exam.date ? ` · ${exam.date}` : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {exams.length < 2 ? (
            <EmptyState
              icon={<TrendingUp size={28} />}
              title={t('page.academics.compare.needTwoExams')}
              description={t('page.classes.grades.compareNeedTwoDesc')}
              className="py-8"
              action={
                <Button variant="secondary" onClick={() => openAcademicsTab('exams')}>
                  {t('page.dashboard.academic.summary.createExam')}
                </Button>
              }
            />
          ) : !canCompare ? (
            <EmptyState
              icon={<TrendingUp size={28} />}
              title={t('page.academics.compare.selectDifferent')}
              className="py-8"
            />
          ) : !compareReady ? (
            <DashboardCardSkeleton />
          ) : studentComparisons.length === 0 ? (
            <EmptyState
              icon={<TrendingUp size={28} />}
              title={t('page.academics.compare.noData')}
              className="py-8"
            />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Card padding="sm">
                  <div className="text-xs text-gray-400 mb-1">
                    {t('page.classes.grades.improved')}
                  </div>
                  <div className="text-lg font-bold text-green-600 dark:text-green-400">
                    {movement.improved}
                  </div>
                </Card>
                <Card padding="sm">
                  <div className="text-xs text-gray-400 mb-1">
                    {t('page.classes.grades.declined')}
                  </div>
                  <div className="text-lg font-bold text-red-600 dark:text-red-400">
                    {movement.declined}
                  </div>
                </Card>
                <Card padding="sm">
                  <div className="text-xs text-gray-400 mb-1">{t('page.classes.grades.flat')}</div>
                  <div className="text-lg font-bold text-gray-600 dark:text-gray-300">
                    {movement.flat}
                  </div>
                </Card>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className={TABLE_STICKY_HEAD}>
                    <tr>
                      <th className={TABLE_TH}>{t('page.academics.common.student')}</th>
                      <th className={cn(TABLE_TH, 'text-center')}>
                        {t('page.classes.grades.col.prev')}
                      </th>
                      <th className={cn(TABLE_TH, 'text-center')}>
                        {t('page.classes.grades.col.next')}
                      </th>
                      <th className={cn(TABLE_TH, 'text-center')}>
                        {t('page.academics.compare.totalChange')}
                      </th>
                      <th className={cn(TABLE_TH, 'text-center')}>
                        {t('page.academics.compare.improvedDeclined')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentComparisons.map((sc) => {
                      const entityId = entityByName.get(sc.studentName)
                      return (
                        <tr key={sc.studentName} className={TABLE_ROW}>
                          <td className={cn(TABLE_TD, 'font-medium')}>
                            {entityId ? (
                              <button
                                type="button"
                                onClick={() => openStudent(entityId)}
                                title={t('page.classes.grades.openAcademics')}
                                className="text-blue-600 dark:text-blue-400 hover:underline bg-transparent border-0 p-0 cursor-pointer"
                              >
                                {sc.studentName}
                              </button>
                            ) : (
                              sc.studentName
                            )}
                          </td>
                          <td
                            className={cn(
                              TABLE_TD,
                              'text-center font-mono text-gray-600 dark:text-gray-300',
                            )}
                          >
                            {sc.totalScoreA ?? '—'}
                          </td>
                          <td
                            className={cn(
                              TABLE_TD,
                              'text-center font-mono text-gray-600 dark:text-gray-300',
                            )}
                          >
                            {sc.totalScoreB ?? '—'}
                          </td>
                          <td className={cn(TABLE_TD, 'text-center')}>
                            <DeltaBadge
                              delta={sc.totalScoreDelta}
                              suffix={t('page.academics.common.scoreUnit')}
                            />
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
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </details>

      {gradeSheet.sheet && (
        <PrintOverlay
          title={`${t('print.gradeSheet.title', '成绩单')} — ${gradeSheet.sheet.exam.name}`}
          onClose={gradeSheet.closeSheet}
        >
          <ClassGradeSheetDocument
            exam={gradeSheet.sheet.exam}
            subjects={gradeSheet.sheet.subjects}
            rows={gradeSheet.sheet.rows}
            subjectStats={gradeSheet.sheet.subjectStats}
            classLabel={classLabel}
          />
        </PrintOverlay>
      )}
    </div>
  )
}
