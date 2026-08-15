// =============================================================
// 学业模块纯计算函数 — 过滤/排序/聚合/派生数据构造
// 供 AcademicsPage / OverviewTab / CompareTab 及其子组件与 hooks 共用
// (共享常量在 academics-shared.ts; 对比核心算法在 exam-comparison.ts)
// =============================================================

import type { EAAEventRecord, EAAStudent, ExamDef, GradeRecord, SubjectDef } from '@shared/types'
import { sortByDateDesc } from '../academics-shared'
import {
  aggregateConductDelta,
  compareClassGrades,
  type StudentComparison,
} from '../exam-comparison'

/** 图表配色 — 每个科目一种颜色 (趋势线图/科目柱状图共用) */
export const SUBJECT_COLORS = [
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

/** 与成绩记录关联的有效考试 (按日期升序) — OverviewTab */
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
