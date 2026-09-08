// =============================================================
// 批改域纯函数(无 electron 依赖,渲染层/服务层/测试共用)
// - 生效分数合成: AI 分 + 教师覆盖(Submitty 口径: override 优先)
// - 文件名 → 学生匹配建议(上传归组用)
// =============================================================

import type { AiGradeResult, GradingPaper, RubricQuestion } from './types'

/** 单题生效分: 教师覆盖 > AI 分; 两者皆无 → null */
export function effectiveQuestionScore(
  paper: Pick<GradingPaper, 'ai' | 'review'>,
  questionId: string,
): number | null {
  const override = paper.review?.questions[questionId]
  if (override && typeof override.score === 'number') return override.score
  const ai = paper.ai?.questions.find((q) => q.questionId === questionId)
  return typeof ai?.score === 'number' ? ai.score : null
}

/**
 * 整卷生效分: 逐题合成后求和; 任一题目无生效分 → null(未批完/未覆盖完)。
 * 发布(P4)以非 null 为门槛。
 */
export function effectiveTotalScore(paper: Pick<GradingPaper, 'ai' | 'review'>): number | null {
  if (!paper.ai) return null
  let total = 0
  for (const q of paper.ai.questions) {
    const score = effectiveQuestionScore(paper, q.questionId)
    if (score === null) return null
    total += score
  }
  return total
}

/** 量规满分合计 */
export function rubricFullMark(rubric: RubricQuestion[]): number {
  return rubric.reduce((sum, q) => sum + (Number.isFinite(q.fullMark) ? q.fullMark : 0), 0)
}

/** AI 结果按 questionId 索引(复核工作台渲染用) */
export function aiResultByQuestion(
  ai: AiGradeResult | undefined,
): Map<string, AiGradeResult['questions'][number]> {
  return new Map((ai?.questions ?? []).map((q) => [q.questionId, q]))
}

// ===== 文件名 → 学生匹配 =====

/** 归一化: 去扩展名/空白/分隔符,转小写(匹配用) */
function normalizeForMatch(s: string): string {
  return s
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\s_\-·.()()[\]【】,，、]+/g, '')
    .toLowerCase()
}

export interface StudentCandidate {
  name: string
  aliases?: string[]
}

export interface PaperMatchResult {
  paperId: string
  fileName: string
  /** 建议归属(唯一命中才有); 多命中/未命中 → null */
  suggested: string | null
  /** 多命中时的全部候选(人工指认) */
  candidates: string[]
}

/**
 * 按文件名猜测归属学生: 文件名(归一化后)包含学生姓名/别名即视为命中。
 * 唯一命中 → suggested; 多命中 → suggested=null + candidates; 未命中 → 两者皆空。
 * 纯函数,不上姓名字典之外的外部依赖;最终归属永远由人工确认后落库。
 */
export function matchPaperFilesToStudents(
  files: Array<{ paperId: string; fileName: string }>,
  students: StudentCandidate[],
): PaperMatchResult[] {
  const pool = students.flatMap((s) =>
    [s.name, ...(s.aliases ?? [])].map((n) => ({ n, name: s.name })),
  )
  return files.map(({ paperId, fileName }) => {
    const normalized = normalizeForMatch(fileName)
    const hits = new Set<string>()
    for (const { n, name } of pool) {
      const nn = normalizeForMatch(n)
      if (nn.length > 0 && normalized.includes(nn)) hits.add(name)
    }
    const candidates = [...hits]
    return {
      paperId,
      fileName,
      suggested: candidates.length === 1 ? candidates[0] : null,
      candidates,
    }
  })
}
