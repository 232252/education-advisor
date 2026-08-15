// =============================================================
// 学业指标纯函数 — 从 AcademicsTab 的 useMemo 闭包提取
// 覆盖: 考试排序/成绩分组/偏科统计/趋势数据/考试对比构建/平均分计算
// =============================================================

import type { EAAEventRecord, ExamDef, GradeRecord } from '@shared/types'
import {
  aggregateConductDelta,
  compareStudentGrades,
  type StudentComparison,
} from '../../Academics/exam-comparison'

// 科目 ID → 中文名 (与学业模块保持一致)
export const ACADEMIC_SUBJECT_MAP: Record<string, string> = {
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

// 图表色板（本 Tab 数据系列自定义 10 色,保持不变以维持视觉行为）
export const ACADEMIC_CHART_COLORS = [
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

/** 按日期升序排列的考试 (有成绩的) */
export function sortExamsWithGrades(exams: ExamDef[], grades: GradeRecord[]): ExamDef[] {
  const examIdsWithGrades = new Set(grades.map((g) => g.examId))
  return exams
    .filter((e) => examIdsWithGrades.has(e.id))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
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
