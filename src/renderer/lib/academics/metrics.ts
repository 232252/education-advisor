// =============================================================
// 学业指标纯函数 — 共享层(唯一事实来源)
// 由 pages/Academics/lib/academics-metrics.ts 与
//    pages/Students/lib/academics-metrics.ts 两份重复实现合并而来
// 覆盖: 过滤/排序/聚合/偏科统计/趋势数据/考试对比构建/平均分计算
// =============================================================

import type { EAAEventRecord, EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import {
  aggregateConductDelta,
  compareClassGrades,
  compareStudentGrades,
  type StudentComparison,
} from './comparison'
import { ACADEMIC_SUBJECT_MAP } from './constants'
import { sortByDateDesc } from './shared'

/** 按考试日期升序排序 */
export function sortByDateAsc<T extends { date?: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
}

/** 计算指定科目的平均分 (跨多次考试) */
export function calcSubjectAvg(grades: GradeRecord[], subjectId: string): number | null {
  const scores = grades
    .filter((g) => g.subjectId === subjectId && g.score != null && g.score > 0)
    .map((g) => g.score as number)
  if (scores.length === 0) return null
  return scores.reduce((a, b) => a + b, 0) / scores.length
}

/** 过滤学生列表 (剔除已删除 + 班级筛选 + 搜索词, 按姓名排序) — AcademicsPage 侧边栏 */
export function filterStudents(
  students: EAAStudent[],
  classFilter: string,
  searchQuery: string,
): EAAStudent[] {
  const q = searchQuery.trim().toLowerCase()
  let list = students.filter((s) => s.status !== 'Deleted')
  // 班级筛选
  if (classFilter === '__NONE__') {
    list = list.filter((s) => !s.class_id)
  } else if (classFilter !== '__ALL__') {
    list = list.filter((s) => s.class_id === classFilter)
  }
  if (q) {
    list = list.filter((s) => s.name.toLowerCase().includes(q))
  }
  // 按姓名排序, 便于查找
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/** 学期列表 (从 exams 中提取去重, 降序) */
export function extractSemesters(exams: ExamDef[]): string[] {
  const set = new Set<string>()
  for (const e of exams) if (e.semester) set.add(e.semester)
  return Array.from(set).sort().reverse()
}

/** 与成绩记录关联的有效考试 (按日期升序) — OverviewTab / Students AcademicsTab 共用 */
export function filterExamsWithGrades(exams: ExamDef[], grades: GradeRecord[]): ExamDef[] {
  const examIds = new Set(grades.map((g) => g.examId))
  const matched = exams.filter((e) => examIds.has(e.id))
  return sortByDateAsc(matched)
}

/** 成绩明细表行数据 */
export interface GradeTableRow {
  exam: ExamDef
  scoresBySubject: Record<string, GradeRecord | undefined>
  classRank: number | undefined
}

/** 构造成绩明细表数据 (输入按日期升序的考试, 输出按日期降序) */
export function buildGradeTableData(
  examsWithGrades: ExamDef[],
  grades: GradeRecord[],
  subjects: SubjectDef[],
): GradeTableRow[] {
  return sortByDateDesc(examsWithGrades).map((exam) => {
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
}

/** 当前班级的学生名 (按 classFilter 过滤, status 非 Deleted) — CompareTab */
export function filterStudentNamesByClass(students: EAAStudent[], classFilter: string): string[] {
  let list = students.filter((s) => s.status !== 'Deleted')
  if (classFilter === '__NONE__') {
    list = list.filter((s) => !s.class_id)
  } else if (classFilter !== '__ALL__') {
    list = list.filter((s) => s.class_id === classFilter)
  }
  return list.map((s) => s.name)
}

/** 计算全班对比结果并按 totalScoreDelta 降序 (进步多的在前) — CompareTab */
export function computeStudentComparisons(
  classGradesA: Record<string, GradeRecord[]>,
  classGradesB: Record<string, GradeRecord[]>,
  conductEvents: EAAEventRecord[] | null,
  targetStudentNames: string[],
  subjectNameMap: Record<string, string>,
): StudentComparison[] {
  // 聚合每个学生的操行分变化
  const conductDeltas: Record<string, number> = {}
  if (conductEvents) {
    for (const name of targetStudentNames) {
      conductDeltas[name] = aggregateConductDelta(conductEvents, name)
    }
  }
  const comps = compareClassGrades(classGradesA, classGradesB, subjectNameMap, conductDeltas)
  comps.sort((a, b) => {
    const da = a.totalScoreDelta ?? -Infinity
    const db = b.totalScoreDelta ?? -Infinity
    return db - da
  })
  return comps
}

// ---------------------------------------------------------------
// 以下为原 Students 页学业 Tab 的纯函数(合并自 pages/Students/lib/academics-metrics.ts)
// ---------------------------------------------------------------

/** 偏科分析单科平均分 */
export interface SubjectAverage {
  subjectId: string
  subject: string
  avg: number
}

/** 偏科分析结果 */
export interface SubjectAnalysis {
  strongest: SubjectAverage | null
  weakest: SubjectAverage | null
  all: SubjectAverage[]
}

/** 趋势图数据: x轴=考试名, series=各科目分数 */
export interface TrendData {
  labels: string[]
  series: Array<{ name: string; data: Array<number | null> }>
}

/** 成绩按考试分组: examId → GradeRecord[] */
export function groupGradesByExam(grades: GradeRecord[]): Record<string, GradeRecord[]> {
  const m: Record<string, GradeRecord[]> = {}
  for (const g of grades) {
    if (!m[g.examId]) m[g.examId] = []
    m[g.examId].push(g)
  }
  return m
}

/** 偏科分析: 计算各科目平均分（平均分降序,最强在前最弱在后） */
export function analyzeSubjects(grades: GradeRecord[]): SubjectAnalysis {
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
}

/** 构建趋势图数据（无考试时返回 null） */
export function buildTrendData(
  sortedExams: ExamDef[],
  gradesByExam: Record<string, GradeRecord[]>,
): TrendData | null {
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
}

/** 计算单场考试平均分（与原内联算法逐位一致,含全 null 时除零语义） */
export function computeExamAverage(examGrades: GradeRecord[]): number {
  if (examGrades.length === 0) return 0
  const scored = examGrades.filter((g) => g.score != null)
  return scored.reduce((sum, g) => sum + (g.score ?? 0), 0) / scored.length
}

/**
 * 构建两场考试的对比结果（纯函数）。
 * 只有当学生在事件数组中有匹配事件时才计算操行分变化;
 * 否则为 null(UI 不显示操行分),避免"无事件但显示 0"的误导。
 */
export function buildComparison(
  gradesByExam: Record<string, GradeRecord[]>,
  compareExamAId: string,
  compareExamBId: string,
  conductEvents: EAAEventRecord[] | null,
  studentName: string,
): StudentComparison | null {
  if (!compareExamAId || !compareExamBId || compareExamAId === compareExamBId) return null
  const gradesA = gradesByExam[compareExamAId] ?? []
  const gradesB = gradesByExam[compareExamBId] ?? []
  if (gradesA.length === 0 && gradesB.length === 0) return null
  const hasConductEvents = conductEvents?.some((e) => e.name === studentName)
  const conductDelta =
    hasConductEvents && conductEvents ? aggregateConductDelta(conductEvents, studentName) : null
  return compareStudentGrades(gradesA, gradesB, ACADEMIC_SUBJECT_MAP, conductDelta)
}
