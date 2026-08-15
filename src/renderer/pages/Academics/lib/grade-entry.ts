// =============================================================
// 成绩录入纯函数 — 分数/记录变换、AI 文本解析 (零副作用,可单测)
//
// 从 GradeEntryTab 原样提取的纯逻辑,设计原则沿用 exam-comparison.ts:
//   - 不修改输入数组/对象
//   - 缺失数据回退空串/空对象,由 UI 层决定展示
//   - AI 解析失败返回结构化原因,不直接触发 toast/setState
// =============================================================

import type { EAAStudent, GradeRecord, SubjectDef } from '@shared/types'

/** 录入单元格值: 字符串便于受控输入,空串 = 未录入 */
export interface ScoreEntry {
  score: string
  rank: string
}

/** AI 解析结果: format = 未找到 JSON 数组;json = JSON 解析报错 */
export type AIParseResult =
  | { ok: true; scores: Record<string, ScoreEntry>; matched: number }
  | { ok: false; reason: 'format' | 'json' }

/** GradeRecord → 录入单元格 (score/classRank 缺失时回退空串) */
export function gradeToEntry(g: GradeRecord): ScoreEntry {
  return {
    score: g.score != null ? String(g.score) : '',
    rank: g.classRank != null ? String(g.classRank) : '',
  }
}

/** 单科模式: 从已有成绩构建 学生名 → 单元格 映射 (指定考试+科目) */
export function buildSingleScores(
  grades: GradeRecord[],
  examId: string,
  subjectId: string,
): Record<string, ScoreEntry> {
  const scores: Record<string, ScoreEntry> = {}
  for (const g of grades) {
    if (g.examId === examId && g.subjectId === subjectId) {
      // grades 可能只包含当前学生, 其他学生的需要通过 getClassGrades 补充加载
      scores[g.studentName] = gradeToEntry(g)
    }
  }
  return scores
}

/** 全科模式: 从已有成绩构建 科目ID → 单元格 映射 (指定考试+学生) */
export function buildAllScores(
  grades: GradeRecord[],
  examId: string,
  studentName: string,
): Record<string, ScoreEntry> {
  const scores: Record<string, ScoreEntry> = {}
  for (const g of grades) {
    if (g.examId === examId && g.studentName === studentName) {
      scores[g.subjectId] = gradeToEntry(g)
    }
  }
  return scores
}

/** 从 getClassGrades 返回值构建 学生名 → 单元格 映射 (取每个学生首条记录) */
export function buildScoresFromClassGrades(
  classGrades: Record<string, GradeRecord[]>,
): Record<string, ScoreEntry> {
  const scores: Record<string, ScoreEntry> = {}
  for (const [name, gradeList] of Object.entries(classGrades)) {
    const g = gradeList?.[0]
    if (g) {
      scores[name] = gradeToEntry(g)
    }
  }
  return scores
}

/** 过滤未删除学生并按姓名排序 (filter 产生新数组,不修改输入) */
export function getActiveStudentsSorted(students: EAAStudent[]): EAAStudent[] {
  return students
    .filter((s) => s.status !== 'Deleted')
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/** 过滤未删除学生的姓名列表 */
export function getActiveStudentNames(students: EAAStudent[]): string[] {
  return students.filter((s) => s.status !== 'Deleted').map((s) => s.name)
}

/** AI 智能解析 system prompt (学生名单内嵌,只解析名单内学生) */
export function buildAIGradeSystemPrompt(studentNames: string[]): string {
  return `你是一个成绩录入助手。用户会粘贴成绩文本,请将其解析为JSON数组。
格式要求: [{"name":"学生姓名","score":分数,"rank":排名可选}]
学生名单(只解析这些学生): ${studentNames.join('、')}
规则:
1. 尝试模糊匹配文本中的姓名到学生名单
2. score 必须是数字
3. rank 如果文本中有则填数字,没有则不填
4. 只返回JSON数组,不要任何其他文字、不要markdown代码块标记`
}

/**
 * 从 AI 流式全量文本中提取 JSON 数组并模糊匹配学生姓名。
 * - 未匹配到 JSON 数组 → { ok: false, reason: 'format' }
 * - JSON.parse 抛错 → { ok: false, reason: 'json' }
 * - 成功 → 匹配到的 学生名 → 单元格 映射 + 匹配数
 */
export function parseAIGradesText(fullText: string, studentNames: string[]): AIParseResult {
  const jsonMatch = fullText.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    return { ok: false, reason: 'format' }
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      name: string
      score?: number
      rank?: number
    }>
    const scores: Record<string, ScoreEntry> = {}
    let matched = 0
    for (const item of parsed) {
      if (!item.name || item.score == null) continue
      // 模糊匹配学生姓名
      const matchedName = studentNames.find(
        (n) => n === item.name || n.includes(item.name) || item.name.includes(n),
      )
      if (matchedName) {
        scores[matchedName] = {
          score: String(item.score),
          rank: item.rank != null ? String(item.rank) : '',
        }
        matched++
      }
    }
    return { ok: true, scores, matched }
  } catch {
    return { ok: false, reason: 'json' }
  }
}

/**
 * 单科模式: 构建待保存记录 (examId 为占位空串,由调用方解析考试后统一填充)。
 * 只保留分数非空的条目。
 */
export function buildSingleSaveRecords(
  singleScores: Record<string, ScoreEntry>,
  subjectId: string,
  subject: SubjectDef,
): Array<Omit<GradeRecord, 'updatedAt'>> {
  return Object.entries(singleScores)
    .filter(([, v]) => v.score !== '')
    .map(([name, v]) => ({
      examId: '', // 占位,下面填充
      subjectId,
      studentName: name,
      score: parseFloat(v.score) || null,
      fullMark: subject.fullMark,
      classRank: v.rank ? parseInt(v.rank, 10) || undefined : undefined,
    }))
}

/**
 * 全科模式: 构建待保存记录 (examId 为占位空串,由调用方解析考试后统一填充)。
 * 科目缺失时满分回退 100。
 */
export function buildAllSaveRecords(
  allScores: Record<string, ScoreEntry>,
  studentName: string,
  subjectMap: Record<string, SubjectDef>,
): Array<Omit<GradeRecord, 'updatedAt'>> {
  return Object.entries(allScores)
    .filter(([, v]) => v.score !== '')
    .map(([subjectId, v]) => {
      const subject = subjectMap[subjectId]
      return {
        examId: '', // 占位,下面填充
        subjectId,
        studentName,
        score: parseFloat(v.score) || null,
        fullMark: subject?.fullMark ?? 100,
        classRank: v.rank ? parseInt(v.rank, 10) || undefined : undefined,
      }
    })
}
