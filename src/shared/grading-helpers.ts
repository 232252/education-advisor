// =============================================================
// 批改域纯函数(无 electron 依赖,渲染层/服务层/测试共用)
// - 生效分数合成: AI 分 + 教师覆盖(Submitty 口径: override 优先)
// - 文件名 → 学生匹配建议(上传归组用)
// =============================================================

import type {
  AiGradeResult,
  AiQuestionResult,
  GradingPaper,
  GradingStrategy,
  PresetMark,
  RubricQuestion,
} from './types'

/** 页边批注全文最长字数(边栏空间有限,超出截断) */
const MARK_NOTE_TEXT_MAX = 160

// ===== 题类推导(批注策略: 客观题只标符号/得分,主观题加页边批注) =====

export type QuestionKind = 'objective' | 'subjective'

const OBJECTIVE_TITLE_RE = /选择|单选|多选|判断|填空|连线|匹配/
const SUBJECTIVE_TITLE_RE = /作文|写作|论述|简答|问答|计算|解答|实验|证明|应用/

/**
 * 题类: 量规显式标注优先;缺省按标题关键词推导,仍无法判断按主观处理
 * (宁多一条批注,不漏一条)。旧任务无 type 字段也能直接受益。
 */
export function questionKind(q: Pick<RubricQuestion, 'title' | 'type'>): QuestionKind {
  if (q.type === 'objective' || q.type === 'subjective') return q.type
  if (OBJECTIVE_TITLE_RE.test(q.title)) return 'objective'
  if (SUBJECTIVE_TITLE_RE.test(q.title)) return 'subjective'
  return 'subjective'
}

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

// ===== 批改模式(流程档位)与双评合并 =====

/** 合法批改模式 */
export const GRADING_STRATEGIES: GradingStrategy[] = ['fast', 'standard', 'dual']

/** 校验/归一批改模式;非法或缺失一律回落 standard(推荐档) */
export function normalizeGradingStrategy(v: unknown): GradingStrategy {
  return typeof v === 'string' && (GRADING_STRATEGIES as string[]).includes(v)
    ? (v as GradingStrategy)
    : 'standard'
}

/**
 * 双评分差阈值(高考网上阅卷口径: 约题目分值的 1/6,至少 1 分):
 * 两次评分差 ≤ 阈值取均值,超阈值记分歧交教师仲裁。
 */
export function dualTolerance(fullMark: number): number {
  const full = Number.isFinite(fullMark) && fullMark > 0 ? fullMark : 0
  return Math.max(1, Math.round(full / 6))
}

/** 双评取分: 阈值内取两次均值(四舍五入),越界保留主模型分(分歧由教师仲裁) */
function dualEffectiveScore(a: number, b: number, fullMark: number): number {
  const tol = dualTolerance(fullMark)
  if (Math.abs(a - b) > tol) return a
  const avg = Math.floor((a + b) / 2 + 0.5) // 四舍五入到整数分
  return Math.min(Math.max(avg, 0), fullMark)
}

/**
 * 双评合并: 以主模型结果为基底,逐题与第二模型比对 —
 * 阈值内改写为均值分,超阈值保留主模型分并记入分歧清单。
 * 只在主结果中出现的题照抄(第二模型缺题不扩散);总分按合并后逐题重算。
 */
export function mergeDualResults(
  primary: AiGradeResult,
  secondary: AiGradeResult,
  rubric: RubricQuestion[],
): { merged: AiGradeResult; disputes: string[] } {
  const fullById = new Map(rubric.map((q) => [q.id, q.fullMark]))
  const secondById = new Map(secondary.questions.map((q) => [q.questionId, q]))
  const disputes: string[] = []
  const questions: AiQuestionResult[] = primary.questions.map((p) => {
    const full = fullById.get(p.questionId) ?? 0
    const s = secondById.get(p.questionId)
    if (!s || !Number.isFinite(s.score)) return p
    if (Math.abs(p.score - s.score) > dualTolerance(full)) {
      disputes.push(p.questionId)
      return p
    }
    const score = dualEffectiveScore(p.score, s.score, full)
    if (score === p.score) return p
    return { ...p, score }
  })
  return {
    merged: { ...primary, questions, totalScore: questions.reduce((sum, q) => sum + q.score, 0) },
    disputes,
  }
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
      (m) =>
        m && typeof m.note === 'string' && m.note.trim().length > 0 && Number.isFinite(m.points),
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

/** 打印/导出用的逐题得分行 */
export interface PaperMarkScoreRow {
  questionId: string
  title: string
  fullMark: number
  score: number | null
  /** 教师评语优先,否则 AI 评语 */
  comment: string
  /** AI 判分依据 */
  evidence: string
  /** 生效评分点说明(已点选) */
  markNotes: string[]
  /** 扣分说明(「-2 单位未换算」;AI 逐项给出,复核台/打印共用) */
  deductionNotes: string[]
}

/** 扣分项 → 展示文本(复核台/批阅报告/页边批注共用口径) */
export function formatDeductionNote(d: { points: number; reason: string }): string {
  return `-${d.points} ${d.reason}`
}

/**
 * 卷面批注痕迹(相对页宽高 0–1)。打印/屏幕共用同一份策略产物:
 * 卷面只落红笔符号/得分(✓/✗/12/28),页边批注全文放边栏,永不压作答。
 */
export interface PaperMarkOverlay {
  questionId: string
  title: string
  /** 题类: 客观题只落符号/得分,主观题才出页边批注 */
  kind: QuestionKind
  /** 判分结论(由生效分推导) */
  verdict: 'full' | 'zero' | 'partial'
  /** 卷面红笔短文: ✓(全对) / ✗(零分) / "12/28"(部分对) */
  mark: string
  /** 页边批注全文(题名+得分+评语);仅主观题且非全对时有值 */
  note: string
  page: number
  x: number
  y: number
  w: number
  h: number
}

function clipMarkText(s: string, max = MARK_NOTE_TEXT_MAX): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

function formatMarkNote(m: PresetMark): string {
  const sign = m.points > 0 ? '+' : ''
  return `${sign}${m.points} ${m.note}`.trim()
}

/**
 * 按量规列出逐题生效分/评语(教师覆盖优先)。
 * 无 AI 结果时仍输出量规行,分数为 null。
 */
export function paperMarkScoreRows(
  paper: Pick<GradingPaper, 'ai' | 'review'>,
  rubric: RubricQuestion[],
): PaperMarkScoreRow[] {
  const aiById = aiResultByQuestion(paper.ai)
  return rubric.map((q) => {
    const ai = aiById.get(q.id)
    const override = paper.review?.questions[q.id]
    const markIdx = override?.marks ?? ai?.appliedMarks ?? []
    const markNotes = (q.presetMarks ?? [])
      .filter((_, i) => markIdx.includes(i))
      .map(formatMarkNote)
    return {
      questionId: q.id,
      title: q.title,
      fullMark: q.fullMark,
      score: effectiveQuestionScore(paper, q.id),
      comment: (override?.comment ?? ai?.comment ?? '').trim(),
      evidence: (ai?.evidence ?? '').trim(),
      markNotes,
      deductionNotes: (ai?.deductions ?? []).map(formatDeductionNote),
    }
  })
}

/**
 * 有卷面 box 的题 → 卷面痕迹(阅卷红笔口径,按量规题序稳定输出):
 * - 全对 → ✓(不打分、无批注,省墨省纸);
 * - 零分 → ✗,主观题仍给页边批注(解释原因);
 * - 部分对 → 红笔得分(如 12/28),仅主观题出页边批注(题名+得分+评语);
 * - 客观题一律不占页边批注;无生效分或无 box 的题不落痕迹(得分表里已有)。
 */
export function paperMarkOverlays(
  paper: Pick<GradingPaper, 'ai' | 'review'>,
  rubric: RubricQuestion[],
): PaperMarkOverlay[] {
  const aiById = aiResultByQuestion(paper.ai)
  const out: PaperMarkOverlay[] = []
  for (const row of paperMarkScoreRows(paper, rubric)) {
    const box = aiById.get(row.questionId)?.box
    if (!box || row.score === null) continue
    const kind = questionKind(rubric.find((q) => q.id === row.questionId) ?? { title: row.title })
    const scoreText = `${row.score}/${row.fullMark}`
    let verdict: PaperMarkOverlay['verdict']
    let mark: string
    if (row.fullMark > 0 && row.score >= row.fullMark) {
      verdict = 'full'
      mark = '✓'
    } else if (row.score <= 0) {
      verdict = 'zero'
      mark = '✗'
    } else {
      verdict = 'partial'
      mark = scoreText
    }
    // 页边批注: 仅主观题且非全对;评语(教师覆盖优先)缺省用 AI 判分依据;扣分说明紧跟得分
    const comment = row.comment || row.evidence || ''
    const deductionText = row.deductionNotes.join('；')
    const note =
      kind === 'subjective' && verdict !== 'full'
        ? clipMarkText(
            [row.title, scoreText, ...(deductionText.length > 0 ? [deductionText] : []), comment]
              .filter((s) => s.length > 0)
              .join(' '),
          )
        : ''
    out.push({
      questionId: row.questionId,
      title: row.title,
      kind,
      verdict,
      mark,
      note,
      page: box.page ?? 0,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    })
  }
  return out
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
 * 编号归一:仅纯数字参与编号比较,去前导零后等价(01 ≡ 1)。
 * 非数字别名(如 entity_id 十六进制、班级/角色名)一律不进编号匹配,
 * 防止「考号 01」被 ent_xxx01 之类的尾巴误命中(2026-09-13 实测案例)。
 */
function normalizeNumberForMatch(s: string): string | null {
  const t = s.replace(/[\s.]/g, '')
  if (!/^\d+$/.test(t)) return null
  return t.replace(/^0+(?=\d)/, '')
}

/**
 * 把卷面姓名/编号对到学生名单。
 * 姓名唯一命中优先;否则编号对纯数字别名精确(含前导零等价)唯一命中;
 * 都歧义则 suggested=null,candidates 供人工指认。
 */
export function matchIdentityToStudents(
  identity: PaperIdentity,
  students: StudentCandidate[],
): { suggested: string | null; candidates: string[] } {
  const nameNorm = normalizeForMatch(identity.name)
  const num = normalizeNumberForMatch(identity.number)
  const nameHits = new Set<string>()
  const numberHits = new Set<string>()
  for (const s of students) {
    const labels = [s.name, ...(s.aliases ?? [])]
    for (const lab of labels) {
      const ln = normalizeForMatch(lab)
      if (
        nameNorm.length >= 2 &&
        ln.length >= 2 &&
        (nameNorm.includes(ln) || ln.includes(nameNorm))
      ) {
        nameHits.add(s.name)
      }
      if (num !== null) {
        const labNum = normalizeNumberForMatch(lab)
        if (labNum !== null && labNum === num) {
          numberHits.add(s.name)
        }
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
