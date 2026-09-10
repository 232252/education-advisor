// =============================================================
// 批改域纯函数(无 electron 依赖,渲染层/服务层/测试共用)
// - 生效分数合成: AI 分 + 教师覆盖(Submitty 口径: override 优先)
// - 文件名 → 学生匹配建议(上传归组用)
// =============================================================

import type { AiGradeResult, GradingPaper, PresetMark, RubricQuestion } from './types'

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

/**
 * Submitty 评分点合成: 从满分起加减所选 gcm_points,钳制到 [0, 满分]。
 * 下标越界/空选 → 满分(未点等于全对起点,由调用方决定是否写覆盖)。
 */
export function markScoreFromSelection(
  fullMark: number,
  marks: PresetMark[],
  selected: number[],
): number {
  let delta = 0
  for (const i of selected) {
    const m = marks[i]
    if (m && Number.isFinite(m.points)) delta += m.points
  }
  const cap = Number.isFinite(fullMark) && fullMark > 0 ? fullMark : 0
  return Math.min(Math.max(cap + delta, 0), cap)
}

/** 清洗量规评分点: 去掉空备注,保留有限分值 */
export function cleanPresetMarks(marks: PresetMark[] | undefined): PresetMark[] | undefined {
  if (!Array.isArray(marks) || marks.length === 0) return undefined
  const cleaned = marks
    .filter(
      (m) => m && typeof m.note === 'string' && m.note.trim().length > 0 && Number.isFinite(m.points),
    )
    .map((m) => ({ points: m.points, note: m.note.trim() }))
  return cleaned.length > 0 ? cleaned : undefined
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

/** 卷面识别抽出的身份(姓名栏 / 学号或座号) */
export interface PaperIdentity {
  name: string
  number: string
}

/**
 * 把卷面姓名/编号对到学生名单。
 * 姓名唯一命中优先;否则编号(对 name/aliases 精确或后缀)唯一命中;
 * 都歧义则 suggested=null,candidates 供人工指认。
 */
export function matchIdentityToStudents(
  identity: PaperIdentity,
  students: StudentCandidate[],
): { suggested: string | null; candidates: string[] } {
  const nameNorm = normalizeForMatch(identity.name)
  const numRaw = identity.number.replace(/\s+/g, '').toLowerCase()
  const nameHits = new Set<string>()
  const numberHits = new Set<string>()
  for (const s of students) {
    const labels = [s.name, ...(s.aliases ?? [])]
    for (const lab of labels) {
      const ln = normalizeForMatch(lab)
      if (nameNorm.length >= 2 && ln.length >= 2 && (nameNorm.includes(ln) || ln.includes(nameNorm))) {
        nameHits.add(s.name)
      }
      if (numRaw.length === 0) continue
      const labCompact = lab.replace(/\s+/g, '').toLowerCase()
      if (labCompact === numRaw || ln === numRaw) {
        numberHits.add(s.name)
        continue
      }
      // 编号至少 2 位才允许后缀命中,避免「3」误中一串 id
      if (numRaw.length >= 2 && (labCompact.endsWith(numRaw) || ln.endsWith(numRaw))) {
        numberHits.add(s.name)
      }
    }
  }
  if (nameHits.size === 1) {
    const [only] = [...nameHits]
    return { suggested: only ?? null, candidates: [...nameHits] }
  }
  if (numberHits.size === 1) {
    const [only] = [...numberHits]
    return { suggested: only ?? null, candidates: [...numberHits] }
  }
  const both = [...nameHits].filter((n) => numberHits.has(n))
  if (both.length === 1) {
    return { suggested: both[0] ?? null, candidates: both }
  }
  return { suggested: null, candidates: [...new Set([...nameHits, ...numberHits])] }
}

// ===== 多页扫描件归组(≈ electronic_gradeable 一次提交多个文件) =====

function fileNameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** 去掉扩展名 */
function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '')
}

/**
 * 从文件名抽出「同一份试卷」的归组键。
 * 明确页码标记(第N页 / pageN / pN)一律剥掉; trailing _1/_2 仅在剩余部分
 * 含中文名或非相机流水前缀时才归组,避免把 IMG_001/IMG_002 合成一份。
 */
export function paperGroupKey(fileName: string): string {
  const base = stripExt(fileName)
  const explicit = base
    .replace(/(?:[\s_\-·.]*(?:第\s*\d{1,3}\s*页|_?p(?:age|g)?\s*\d{1,3}))$/i, '')
    .replace(/[\s_\-·.]+$/g, '')
  if (explicit !== base && explicit.length > 0) return explicit.toLowerCase()
  const indexMatch = base.match(/(?:[\s_\-·.]+)(\d{1,2})$/)
  if (indexMatch) {
    const rest = base.slice(0, base.length - indexMatch[0].length)
    const camera = /^(img|scan|dsc|photo|pic|image|screenshot)/i.test(rest)
    if (rest.length > 0 && (/[\u4e00-\u9fff]/.test(rest) || (rest.length >= 2 && !camera))) {
      return rest.toLowerCase()
    }
  }
  return base.toLowerCase()
}

/**
 * 把选中的扫描件路径分成「一份试卷一批文件」。
 * 同名多页归到同一批,组间/组内保持原选择顺序。
 */
export function groupPaperImportPaths(paths: string[]): Array<{ files: Array<{ path: string }> }> {
  const groups = new Map<string, string[]>()
  const order: string[] = []
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) continue
    const key = paperGroupKey(fileNameOf(p))
    let list = groups.get(key)
    if (!list) {
      list = []
      groups.set(key, list)
      order.push(key)
    }
    list.push(p)
  }
  return order.map((key) => ({
    files: (groups.get(key) ?? []).map((path) => ({ path })),
  }))
}
