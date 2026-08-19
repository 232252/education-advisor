// =============================================================
// grade-sheet — 班级成绩单纯数据构建(可单测)
// 从 getClassGrades 的 Record<学生名, GradeRecord[]> 构建
// 成绩单行(总分/排名)与科目统计(平均/最高/最低)。
// =============================================================

import type { EAAStudent, GradeRecord } from '@shared/types'

export interface GradeSheetRow {
  name: string
  classId: string | null
  /** subjectId → 分数(null=缺考/无记录) */
  scores: Record<string, number | null>
  /** 有成绩科目的总分;全部缺考为 null */
  total: number | null
  /** 按总分降序的排名;无总分不参与排名 */
  rank: number | null
}

export interface SubjectStat {
  subjectId: string
  /** 参与统计的人数(有分数者) */
  count: number
  average: number | null
  max: number | null
  min: number | null
}

/**
 * 构建成绩单行。
 * - students 提供名单与班级;gradesByStudent 提供成绩(按学生名索引)
 * - rank 按总分降序,同分同名次(1,2,2,4 竞争排名)
 */
export function buildGradeSheetRows(
  students: Pick<EAAStudent, 'name' | 'class_id'>[],
  gradesByStudent: Record<string, GradeRecord[]>,
  subjectIds: string[],
): GradeSheetRow[] {
  const rows: GradeSheetRow[] = students.map((s) => {
    const records = gradesByStudent[s.name] ?? []
    const scores: Record<string, number | null> = {}
    let total = 0
    let hasScore = false
    for (const sid of subjectIds) {
      const g = records.find((r) => r.subjectId === sid)
      if (g && g.score != null) {
        scores[sid] = g.score
        total += g.score
        hasScore = true
      } else {
        scores[sid] = null
      }
    }
    return {
      name: s.name,
      classId: s.class_id ?? null,
      scores,
      total: hasScore ? total : null,
      rank: null,
    }
  })

  // 排名: 总分降序,同分同名次
  const ranked = rows
    .filter((r): r is GradeSheetRow & { total: number } => r.total != null)
    .sort((a, b) => b.total - a.total)
  let prevTotal: number | null = null
  let prevRank = 0
  ranked.forEach((r, i) => {
    if (prevTotal != null && r.total === prevTotal) {
      r.rank = prevRank
    } else {
      r.rank = i + 1
      prevRank = r.rank
    }
    prevTotal = r.total
  })

  // 输出顺序: 有成绩的按排名在前,无成绩的按姓名排后
  const withRank = rows
    .filter((r): r is GradeSheetRow & { rank: number } => r.rank != null)
    .sort((a, b) => a.rank - b.rank)
  const noRank = rows
    .filter((r) => r.rank == null)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return [...withRank, ...noRank]
}

/** 科目统计: 平均/最高/最低(仅统计有分数者) */
export function computeSubjectStats(rows: GradeSheetRow[], subjectIds: string[]): SubjectStat[] {
  return subjectIds.map((subjectId) => {
    const values = rows.map((r) => r.scores[subjectId]).filter((v): v is number => v != null)
    if (values.length === 0) {
      return { subjectId, count: 0, average: null, max: null, min: null }
    }
    const sum = values.reduce((a, b) => a + b, 0)
    return {
      subjectId,
      count: values.length,
      average: Math.round((sum / values.length) * 10) / 10,
      max: Math.max(...values),
      min: Math.min(...values),
    }
  })
}
