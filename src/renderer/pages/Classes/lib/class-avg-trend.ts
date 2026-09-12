// =============================================================
// class-avg-trend — multi-exam class average series (percent-normalized)
// Same score/fullMark → percent口径 as Dashboard computeStudentGradeRows.
// =============================================================

import type { ExamDef, GradeRecord } from '@shared/types'
import { sortByDateAsc } from '../../../lib/academics'
import { SUBJECT_FILTER_ALL } from '../../Dashboard/dashboard-lens'

export interface ClassAvgTrendPoint {
  examId: string
  examName: string
  date: string
  /** Class average: percent when subject=all, raw when single subject */
  average: number | null
  /** Students with at least one numeric score in scope */
  recordedCount: number
}

const TREND_RECENT_N = 8

/** Pick exams for the trend: same semester as anchor when ≥2; else recent N. */
export function pickTrendExams(exams: ExamDef[], anchorExamId: string): ExamDef[] {
  if (exams.length === 0) return []
  const anchor = exams.find((e) => e.id === anchorExamId)
  const semester = anchor?.semester?.trim()
  let pool = exams
  if (semester) {
    const same = exams.filter((e) => e.semester === semester)
    if (same.length >= 2) pool = same
  }
  const asc = sortByDateAsc(pool)
  if (asc.length <= TREND_RECENT_N) return asc
  return asc.slice(asc.length - TREND_RECENT_N)
}

function meanPct(records: GradeRecord[]): number | null {
  const scored = records.filter((g) => g.score != null && g.fullMark > 0)
  if (scored.length === 0) return null
  const sum = scored.reduce((acc, g) => acc + ((g.score as number) / g.fullMark) * 100, 0)
  return sum / scored.length
}

function meanRaw(records: GradeRecord[]): number | null {
  const scored = records.filter((g) => g.score != null)
  if (scored.length === 0) return null
  return scored.reduce((acc, g) => acc + (g.score as number), 0) / scored.length
}

/**
 * Compute one class-average point for an exam.
 * gradesByStudent = getClassGrades result for that exam.
 */
export function computeExamClassAverage(
  gradesByStudent: Record<string, GradeRecord[]>,
  subjectId: string,
): { average: number | null; recordedCount: number } {
  const perStudent: number[] = []
  for (const grades of Object.values(gradesByStudent)) {
    const scoped =
      subjectId === SUBJECT_FILTER_ALL ? grades : grades.filter((g) => g.subjectId === subjectId)
    const v = subjectId === SUBJECT_FILTER_ALL ? meanPct(scoped) : meanRaw(scoped)
    if (v != null) perStudent.push(v)
  }
  if (perStudent.length === 0) return { average: null, recordedCount: 0 }
  const average = perStudent.reduce((a, b) => a + b, 0) / perStudent.length
  return { average, recordedCount: perStudent.length }
}

/** Build trend points in date ascending order. */
export function buildClassAvgTrend(
  exams: ExamDef[],
  gradesByExam: Record<string, Record<string, GradeRecord[]>>,
  subjectId: string,
): ClassAvgTrendPoint[] {
  return exams.map((exam) => {
    const { average, recordedCount } = computeExamClassAverage(
      gradesByExam[exam.id] ?? {},
      subjectId,
    )
    return {
      examId: exam.id,
      examName: exam.name,
      date: exam.date,
      average: average != null ? Math.round(average * 10) / 10 : null,
      recordedCount,
    }
  })
}

/** Points that have data (for empty-state: need ≥2). */
export function trendPointsWithData(points: ClassAvgTrendPoint[]): ClassAvgTrendPoint[] {
  return points.filter((p) => p.average != null)
}
