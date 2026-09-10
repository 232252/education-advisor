// =============================================================
// 成绩优先仪表盘 — 纯计算
// 班级口径：按考试 + 可选科目聚合均分 / 分段 / 排行 / 待关注。
// 百分制用 score/fullMark，避免语文 150 与物理 100 直接比原始分。
// =============================================================

import type { EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { calcSubjectAvg, sortByDateDesc } from '../../lib/academics'
import { SUBJECT_FILTER_ALL } from './dashboard-lens'

/** 成绩分段标签（数据层 key，渲染层经 GRADE_BAND_I18N 翻译） */
export const GRADE_BAND_LABELS = {
  FAIL: '不及格(<60%)',
  PASS: '及格(60-75%)',
  GOOD: '良好(75-85%)',
  EXCELLENT: '优秀(>=85%)',
} as const

/** 分段展示顺序：不及格 → 优秀 */
export const GRADE_BAND_ORDER = [
  GRADE_BAND_LABELS.FAIL,
  GRADE_BAND_LABELS.PASS,
  GRADE_BAND_LABELS.GOOD,
  GRADE_BAND_LABELS.EXCELLENT,
] as const

export const GRADE_BAND_I18N: Record<string, string> = {
  [GRADE_BAND_LABELS.FAIL]: 'page.dashboard.gradeBand.fail',
  [GRADE_BAND_LABELS.PASS]: 'page.dashboard.gradeBand.pass',
  [GRADE_BAND_LABELS.GOOD]: 'page.dashboard.gradeBand.good',
  [GRADE_BAND_LABELS.EXCELLENT]: 'page.dashboard.gradeBand.excellent',
}

export type GradeWatchStatus = 'ok' | 'fail' | 'absent' | 'missing'

/** 单个学生在当前考试/科目口径下的成绩行 */
export interface StudentGradeRow {
  name: string
  entityId: string
  /** 展示分：单科为原始分；全科为百分制均分 */
  displayScore: number | null
  /** 百分制（缺考/未录为 null） */
  pct: number | null
  kind: 'score' | 'percent'
  status: GradeWatchStatus
}

export interface AcademicStatsSummary {
  examCount: number
  studentCount: number
  /** 至少有一条非空分数 */
  recordedCount: number
  /** 已录入/总人数，供统计卡直接展示 */
  recordedLabel: string
  avgPct: number
  /** 缺考 + 未录入 */
  absentCount: number
  /** 有分数但低于 60% */
  lowCount: number
}

function scopedRecords(grades: GradeRecord[], subjectId: string): GradeRecord[] {
  if (subjectId === SUBJECT_FILTER_ALL) return grades
  return grades.filter((g) => g.subjectId === subjectId)
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

/** 把班级成绩展开成 GradeRecord[]（科目均分图可直接复用 Academics 图表） */
export function flattenClassGrades(classGrades: Record<string, GradeRecord[]>): GradeRecord[] {
  return Object.values(classGrades).flat()
}

/** 按日期降序取最近一场考试 id */
export function pickLatestExamId(exams: ExamDef[]): string {
  return sortByDateDesc(exams)[0]?.id ?? ''
}

/**
 * 计算每名学生在当前考试/科目口径下的成绩行。
 * classGrades 已是单场考试的 getClassGrades 结果。
 */
export function computeStudentGradeRows(
  students: EAAStudent[],
  classGrades: Record<string, GradeRecord[]>,
  subjectId: string,
): StudentGradeRow[] {
  const kind: StudentGradeRow['kind'] = subjectId === SUBJECT_FILTER_ALL ? 'percent' : 'score'
  return students.map((s) => {
    const recs = scopedRecords(classGrades[s.name] ?? [], subjectId)
    if (recs.length === 0) {
      return {
        name: s.name,
        entityId: s.entity_id,
        displayScore: null,
        pct: null,
        kind,
        status: 'missing',
      }
    }
    if (recs.every((g) => g.score == null)) {
      return {
        name: s.name,
        entityId: s.entity_id,
        displayScore: null,
        pct: null,
        kind,
        status: 'absent',
      }
    }
    const pct = meanPct(recs)
    const displayScore = kind === 'percent' ? pct : meanRaw(recs)
    return {
      name: s.name,
      entityId: s.entity_id,
      displayScore,
      pct,
      kind,
      status: pct != null && pct < 60 ? 'fail' : 'ok',
    }
  })
}

/** 百分制分桶：仅计入有 pct 的学生 */
export function computeGradeBands(rows: StudentGradeRow[]): Record<string, number> {
  const buckets: Record<string, number> = {
    [GRADE_BAND_LABELS.FAIL]: 0,
    [GRADE_BAND_LABELS.PASS]: 0,
    [GRADE_BAND_LABELS.GOOD]: 0,
    [GRADE_BAND_LABELS.EXCELLENT]: 0,
  }
  for (const r of rows) {
    if (r.pct == null) continue
    if (r.pct < 60) buckets[GRADE_BAND_LABELS.FAIL]++
    else if (r.pct < 75) buckets[GRADE_BAND_LABELS.PASS]++
    else if (r.pct < 85) buckets[GRADE_BAND_LABELS.GOOD]++
    else buckets[GRADE_BAND_LABELS.EXCELLENT]++
  }
  return buckets
}

export function computeAcademicStats(
  rows: StudentGradeRow[],
  examCount: number,
): AcademicStatsSummary {
  const studentCount = rows.length
  const recordedCount = rows.filter((r) => r.status === 'ok' || r.status === 'fail').length
  const withPct = rows.filter((r) => r.pct != null)
  const avgPct =
    withPct.length > 0 ? withPct.reduce((acc, r) => acc + (r.pct as number), 0) / withPct.length : 0
  const absentCount = rows.filter((r) => r.status === 'absent' || r.status === 'missing').length
  const lowCount = rows.filter((r) => r.status === 'fail').length
  return {
    examCount,
    studentCount,
    recordedCount,
    recordedLabel: studentCount > 0 ? `${recordedCount}/${studentCount}` : '0/0',
    avgPct,
    absentCount,
    lowCount,
  }
}

/** 有分数的学生按展示分降序，取 Top N */
export function rankStudentGrades(rows: StudentGradeRow[], topN = 10): StudentGradeRow[] {
  return [...rows]
    .filter((r) => r.displayScore != null)
    .sort((a, b) => (b.displayScore as number) - (a.displayScore as number))
    .slice(0, topN)
}

const WATCH_ORDER: Record<GradeWatchStatus, number> = {
  fail: 0,
  absent: 1,
  missing: 2,
  ok: 3,
}

/** 待关注：不及格优先，再缺考、未录入 */
export function watchlistStudents(rows: StudentGradeRow[], limit = 8): StudentGradeRow[] {
  return [...rows]
    .filter((r) => r.status !== 'ok')
    .sort((a, b) => {
      const d = WATCH_ORDER[a.status] - WATCH_ORDER[b.status]
      if (d !== 0) return d
      return (a.pct ?? 0) - (b.pct ?? 0)
    })
    .slice(0, limit)
}

export interface SubjectAvgItem {
  id: string
  name: string
  avg: number
}

/** 本场考试各科目班级均分（排除无数据科目） */
export function computeExamSubjectAvgs(
  grades: GradeRecord[],
  subjects: SubjectDef[],
): SubjectAvgItem[] {
  const items: SubjectAvgItem[] = []
  for (const sub of subjects) {
    const avg = calcSubjectAvg(grades, sub.id)
    if (avg != null) items.push({ id: sub.id, name: sub.name, avg })
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}
