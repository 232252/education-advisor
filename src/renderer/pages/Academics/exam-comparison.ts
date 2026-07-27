// =============================================================
// 考试对比计算工具 — 纯函数(零依赖,可单测)
//
// 用途:计算两次考试之间(单学生或全班)的成绩/名次/操行分变化。
// 设计原则沿用 dashboard-stats.ts:
//   - 不修改输入数组
//   - 空数组返回稳定空结果
//   - 任一数据缺失时 delta 为 null(UI 显示"未录入")
//   - 除零返回 0 避免 NaN
//
// 名次语义约定:
//   - 名次数值变小 = 上升(进步);数值变大 = 下降(退步)
//   - 因此 rankDelta = rankB - rankA:负=上升,正=下降
//   - 这与分数 delta(正=进步)符号相反,UI 渲染时需用 rankDeltaColor
// =============================================================

import type { EAAEventRecord, GradeRecord } from '@shared/types'

// ---------------------------------------------------------------
// 结果类型
// ---------------------------------------------------------------

/** 单个科目的对比结果 */
export interface SubjectComparison {
  subjectId: string
  subjectName: string
  /** examA 的分数(null = 未参考 / 未录入) */
  scoreA: number | null
  /** examB 的分数 */
  scoreB: number | null
  fullMark: number
  /** scoreB - scoreA;null 当任一分数为 null */
  scoreDelta: number | null
  /** examA 的班级排名(undefined = 未录入) */
  classRankA: number | null
  classRankB: number | null
  /** 班级名次变化:rankB - rankA;负=上升,正=下降,null = 未录入 */
  classRankDelta: number | null
  gradeRankA: number | null
  gradeRankB: number | null
  gradeRankDelta: number | null
}

/** 单个学生的对比结果 */
export interface StudentComparison {
  studentName: string
  subjects: SubjectComparison[]
  /** 总分(所有科目分数之和);null 当任一科目缺考 */
  totalScoreA: number | null
  totalScoreB: number | null
  totalScoreDelta: number | null
  /** 两场考试日期间的操行分净变化(null = 无 EAA 数据) */
  conductDelta: number | null
  /** 进步科目数(分数提高) */
  improvedSubjects: number
  /** 退步科目数(分数下降) */
  declinedSubjects: number
  /** 持平科目数(分数不变,且两次都有分) */
  unchangedSubjects: number
}

/** 班级对比汇总统计 */
export interface ClassComparisonSummary {
  totalStudents: number
  /** 班级总分平均变化(所有学生 totalScoreDelta 的平均;0 当空) */
  avgScoreDelta: number
  /** 总分进步最多的学生名(null 当无学生有有效 delta) */
  mostImprovedStudent: string | null
  mostImprovedDelta: number | null
  /** 总分退步最多的学生名 */
  mostDeclinedStudent: string | null
  mostDeclinedDelta: number | null
  /** 各科平均分变化 */
  subjectDeltas: Array<{
    subjectId: string
    subjectName: string
    /** 该科目所有有有效分数的学生的平均 scoreDelta */
    avgDelta: number
    sampleCount: number
  }>
}

// ---------------------------------------------------------------
// 辅助纯函数
// ---------------------------------------------------------------

/**
 * 计算分数差(scoreB - scoreA)。
 * 任一为 null/undefined 时返回 null(表示无法计算)。
 */
export function computeScoreDelta(a: number | null, b: number | null): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null
  return b - a
}

/**
 * 计算名次差(rankB - rankA)。
 * 名次语义:数值小 = 排名靠前 = 进步。
 * 因此 delta 为负 = 上升,delta 为正 = 下降。
 * 任一为 null/undefined 时返回 null。
 */
export function computeRankDelta(a: number | null, b: number | null): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null
  return b - a
}

/** 把可选排名字段统一成 number | null(便于后续计算) */
function normalizeRank(value: number | undefined): number | null {
  return value === undefined ? null : value
}

/**
 * 汇总科目进退步统计。
 * - improved: scoreDelta > 0 的科目数
 * - declined: scoreDelta < 0 的科目数
 * - unchanged: scoreDelta === 0 的科目数(两次都有分且相等)
 * - scoreDelta === null 的科目不计入任何一项
 */
export function summarizeSubjects(subjects: SubjectComparison[]): {
  improved: number
  declined: number
  unchanged: number
} {
  let improved = 0
  let declined = 0
  let unchanged = 0
  for (const s of subjects) {
    if (s.scoreDelta === null) continue
    if (s.scoreDelta > 0) improved++
    else if (s.scoreDelta < 0) declined++
    else unchanged++
  }
  return { improved, declined, unchanged }
}

// ---------------------------------------------------------------
// 操行分聚合
// ---------------------------------------------------------------

/**
 * 聚合两次考试日期之间的操行分净变化。
 * 只累加 is_valid === true 且 reverted_by 为空的事件的 score_delta。
 *
 * @param events eaa.range 返回的事件列表(可能包含多个学生)
 * @param studentName 目标学生姓名(EAAEventRecord 用 name 字段匹配)
 * @returns 净变化值(正=加分多,负=扣分多);无匹配事件返回 0
 */
export function aggregateConductDelta(events: EAAEventRecord[], studentName: string): number {
  if (!events || events.length === 0 || !studentName) return 0
  return events
    .filter(
      (e) =>
        e.name === studentName &&
        e.is_valid === true &&
        (e.reverted_by === null || e.reverted_by === undefined || e.reverted_by === ''),
    )
    .reduce((sum, e) => sum + (e.score_delta ?? 0), 0)
}

// ---------------------------------------------------------------
// 核心对比函数
// ---------------------------------------------------------------

/**
 * 对比单个学生在两场考试的成绩。
 *
 * @param gradesA examA 中该学生的 GradeRecord[](可能多科)
 * @param gradesB examB 中该学生的 GradeRecord[]
 * @param subjectMap subjectId → 科目中文名(缺失时回退用 subjectId)
 * @param conductDelta 操行分净变化(可选,null = 无数据;由调用方先 aggregateConductDelta 算好传入)
 */
export function compareStudentGrades(
  gradesA: GradeRecord[],
  gradesB: GradeRecord[],
  subjectMap: Record<string, string>,
  conductDelta: number | null = null,
): StudentComparison {
  const studentName = gradesA[0]?.studentName ?? gradesB[0]?.studentName ?? ''

  // 按 subjectId 索引,方便配对
  const mapA = new Map<string, GradeRecord>()
  for (const g of gradesA) mapA.set(g.subjectId, g)
  const mapB = new Map<string, GradeRecord>()
  for (const g of gradesB) mapB.set(g.subjectId, g)

  // 合并所有出现过的 subjectId(保持 A 的顺序优先,B 新增的追加在后)
  const allSubjectIds: string[] = []
  const seen = new Set<string>()
  for (const g of gradesA) {
    if (!seen.has(g.subjectId)) {
      allSubjectIds.push(g.subjectId)
      seen.add(g.subjectId)
    }
  }
  for (const g of gradesB) {
    if (!seen.has(g.subjectId)) {
      allSubjectIds.push(g.subjectId)
      seen.add(g.subjectId)
    }
  }

  const subjects: SubjectComparison[] = allSubjectIds.map((subjectId) => {
    const gA = mapA.get(subjectId)
    const gB = mapB.get(subjectId)
    const scoreA = gA ? gA.score : null
    const scoreB = gB ? gB.score : null
    const classRankA = gA ? normalizeRank(gA.classRank) : null
    const classRankB = gB ? normalizeRank(gB.classRank) : null
    const gradeRankA = gA ? normalizeRank(gA.gradeRank) : null
    const gradeRankB = gB ? normalizeRank(gB.gradeRank) : null
    const fullMark = gA?.fullMark ?? gB?.fullMark ?? 0
    return {
      subjectId,
      subjectName: subjectMap[subjectId] ?? subjectId,
      scoreA,
      scoreB,
      fullMark,
      scoreDelta: computeScoreDelta(scoreA, scoreB),
      classRankA,
      classRankB,
      classRankDelta: computeRankDelta(classRankA, classRankB),
      gradeRankA,
      gradeRankB,
      gradeRankDelta: computeRankDelta(gradeRankA, gradeRankB),
    }
  })

  // 总分:任一科目缺考(分数 null)则总分为 null
  const hasNullA = subjects.some((s) => s.scoreA === null)
  const hasNullB = subjects.some((s) => s.scoreB === null)
  const totalScoreA =
    subjects.length === 0 || hasNullA ? null : subjects.reduce((sum, s) => sum + (s.scoreA ?? 0), 0)
  const totalScoreB =
    subjects.length === 0 || hasNullB ? null : subjects.reduce((sum, s) => sum + (s.scoreB ?? 0), 0)

  const { improved, declined, unchanged } = summarizeSubjects(subjects)

  return {
    studentName,
    subjects,
    totalScoreA,
    totalScoreB,
    totalScoreDelta: computeScoreDelta(totalScoreA, totalScoreB),
    conductDelta,
    improvedSubjects: improved,
    declinedSubjects: declined,
    unchangedSubjects: unchanged,
  }
}

/**
 * 对比全班学生在两场考试的成绩。
 *
 * @param classGradesA examA 中 Record<studentName, GradeRecord[]>
 * @param classGradesB examB 中 Record<studentName, GradeRecord[]>
 * @param subjectMap subjectId → 科目中文名
 * @param conductDeltas 可选:Record<studentName, conductDelta>(由调用方先聚合 range 事件)
 */
export function compareClassGrades(
  classGradesA: Record<string, GradeRecord[]>,
  classGradesB: Record<string, GradeRecord[]>,
  subjectMap: Record<string, string>,
  conductDeltas: Record<string, number> = {},
): StudentComparison[] {
  // 合并所有出现过的学生名(A 顺序优先)
  const allNames: string[] = []
  const seen = new Set<string>()
  for (const name of Object.keys(classGradesA)) {
    if (!seen.has(name)) {
      allNames.push(name)
      seen.add(name)
    }
  }
  for (const name of Object.keys(classGradesB)) {
    if (!seen.has(name)) {
      allNames.push(name)
      seen.add(name)
    }
  }

  return allNames.map((name) => {
    const gradesA = classGradesA[name] ?? []
    const gradesB = classGradesB[name] ?? []
    const conduct = name in conductDeltas ? conductDeltas[name] : null
    return compareStudentGrades(gradesA, gradesB, subjectMap, conduct)
  })
}

/**
 * 汇总全班对比统计:平均分变化、进步/退步最多学生、各科平均变化。
 * 只基于有效(非 null)的 totalScoreDelta 计算。
 */
export function summarizeClassComparison(students: StudentComparison[]): ClassComparisonSummary {
  const validDeltaStudents = students.filter((s) => s.totalScoreDelta !== null)
  const totalStudents = students.length

  // 平均分变化
  const avgScoreDelta =
    validDeltaStudents.length > 0
      ? validDeltaStudents.reduce((sum, s) => sum + (s.totalScoreDelta ?? 0), 0) /
        validDeltaStudents.length
      : 0

  // 进步最多 / 退步最多(基于 totalScoreDelta)
  let mostImprovedStudent: string | null = null
  let mostImprovedDelta: number | null = null
  let mostDeclinedStudent: string | null = null
  let mostDeclinedDelta: number | null = null
  for (const s of validDeltaStudents) {
    const delta = s.totalScoreDelta ?? 0
    if (mostImprovedDelta === null || delta > mostImprovedDelta) {
      mostImprovedDelta = delta
      mostImprovedStudent = s.studentName
    }
    if (mostDeclinedDelta === null || delta < mostDeclinedDelta) {
      mostDeclinedDelta = delta
      mostDeclinedStudent = s.studentName
    }
  }

  // 各科目平均变化:收集所有 subjectId
  const subjectMap = new Map<string, { subjectName: string; deltas: number[] }>()
  for (const s of students) {
    for (const sub of s.subjects) {
      if (sub.scoreDelta === null) continue
      if (!subjectMap.has(sub.subjectId)) {
        subjectMap.set(sub.subjectId, { subjectName: sub.subjectName, deltas: [] })
      }
      subjectMap.get(sub.subjectId)?.deltas.push(sub.scoreDelta)
    }
  }
  const subjectDeltas = Array.from(subjectMap.entries()).map(
    ([subjectId, { subjectName, deltas }]) => ({
      subjectId,
      subjectName,
      avgDelta: deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0,
      sampleCount: deltas.length,
    }),
  )

  return {
    totalStudents,
    avgScoreDelta,
    mostImprovedStudent,
    mostImprovedDelta,
    mostDeclinedStudent,
    mostDeclinedDelta,
    subjectDeltas,
  }
}
