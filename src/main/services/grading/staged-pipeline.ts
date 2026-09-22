import type { Api, Message, Model } from '@main/services/llm-contracts'
// =============================================================
// Staged Pipeline — 分阶段批改(标准档/双评档的执行引擎)
// 流程: 版面定位(一次) → 按题裁剪(外扩防截断) → 分题型分批批改
//   (单选/判断=转写+规则判分,其余=逐题聚焦批改) → 条件复验
//   (字迹不清复读/主观题贴边界二次采样,分歧取中位)。
// 设计依据: docs/research/2026-09-15-staged-grading-pipeline-research.md
//   - 输出预算按批配给(整卷一次调用的 8192 挤兑是准确率下降主因)
//   - 裁剪图 token≈整页 1/8~1/10,聚焦输入换认读精度
//   - 客观题"只转写不判分",判分由规则比对完成(错误清零)
// 纯函数(规划/解析/判分/几何)单独导出以便测试。
// =============================================================

import fsp from 'node:fs/promises'
import { parseJsonWithRepair } from '@earendil-works/pi-ai'
import { dualTolerance, markScoreFromSelection, questionKind } from '@shared/grading-helpers'
import type {
  AiGradeResult,
  AiQuestionResult,
  GradeAnnotationBox,
  GradingPaper,
  GradingStrictness,
  GradingTask,
  PresetMark,
  RubricQuestion,
} from '@shared/types'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import {
  gradingModeLabel,
  isGradingParseError,
  MODE_RULES,
  parseAnnotationBox,
  parseDeductions,
} from './grading-pipeline'
import { gradingService } from './grading-service'
import { completeGradingCall } from './llm-call'

// ===== 纯函数: 批次规划 =====

export type StagedBatchKind = 'transcribe' | 'grade'

/** 一个批次 = 一道量规大题;transcribe=转写+规则判分,grade=聚焦批改 */
export interface StagedBatch {
  question: RubricQuestion
  kind: StagedBatchKind
}

/** 题型排序权重: 单选/判断(1) → 多选(2) → 填空(3) → 其他(4);量规序为并列稳定器 */
function batchRank(q: RubricQuestion): number {
  const title = q.title
  if (/多选/.test(title)) return 2
  if (/填空/.test(title)) return 3
  if (/单选|判断/.test(title)) return 1
  if (/选择/.test(title)) return 1 // 泛「选择题」按单选口径(多选一般会写明)
  return 4
}

/**
 * 该题能否走"转写+规则判分": 客观题 + 题名是单选/判断(多选的少选给分
 * 政策因考试而异,交模型按评分标准裁量) + 参考答案能解析出逐小题答案
 * (带题名推导的期望小题数收紧: 部分解析不再静默按缺省对错判分)。
 */
export function isRuleScoreable(q: RubricQuestion): boolean {
  if (questionKind(q) !== 'objective') return false
  if (/多选/.test(q.title)) return false
  if (!/单选|判断|选择/.test(q.title)) return false
  return parseReferenceAnswers(q.referenceAnswer, expectedSubCountOf(q)) !== null
}

/** 量规 → 批次序列(按题型排序;转写批需参考答案可解析) */
export function planStagedBatches(rubric: RubricQuestion[]): StagedBatch[] {
  return rubric
    .map((question, i) => ({
      question,
      i,
      kind: (isRuleScoreable(question) ? 'transcribe' : 'grade') as StagedBatchKind,
    }))
    .sort((a, b) => batchRank(a.question) - batchRank(b.question) || a.i - b.i)
    .map(({ question, kind }) => ({ question, kind }))
}

// ===== 纯函数: 参考答案逐小题解析 =====

/** 作答归一: 判断符号统一 √/×(T/F 单字符按判断口径,参考/学生两侧对称转换);
 * 选项字母大写;空串原样 */
export function normalizeObjectiveValue(raw: string): string {
  const v = raw.trim()
  if (v.length === 0) return ''
  if (['对', '√', 'T', 't', '是', 'true', 'True'].includes(v)) return '√'
  if (['错', '×', 'x', 'X', 'F', 'f', '否', 'false', 'False'].includes(v)) return '×'
  if (/^[A-Ha-h]{1,8}$/.test(v)) return v.toUpperCase() // 单选字母 / 多选字母组
  return v // 无法归一的原文(比对时大概率判错,由复读复验兜底)
}

const TRUE_FALSE_SEQ_RE = /^[√×对错TFtf]+$/
const LETTER_SEQ_RE = /^[A-Ha-h]+$/

/**
 * 从题名推导期望小题数: 「共 N 小题」直接取 N;否则「每小题 X 分」按
 * round(满分/X) 推导。推导不出返回 undefined(调用方按单参口径放行兜底,
 * 不因正则误读把可判分的题回落模型)。
 */
export function expectedSubCountOf(
  q: Pick<RubricQuestion, 'title' | 'fullMark'>,
): number | undefined {
  const countMatch = q.title.match(/共\s*(\d{1,3})\s*小题/)
  if (countMatch?.[1]) {
    const n = Number(countMatch[1])
    if (Number.isInteger(n) && n > 0 && n <= 200) return n
  }
  const perMatch = q.title.match(/每小题\s*([\d.]+)\s*分/)
  if (perMatch?.[1]) {
    const per = Number(perMatch[1])
    if (Number.isFinite(per) && per > 0 && Number.isFinite(q.fullMark) && q.fullMark > 0) {
      const n = Math.round(q.fullMark / per)
      if (Number.isInteger(n) && n > 0 && n <= 200) return n
    }
  }
  return undefined
}

/**
 * 解析参考答案为「小题号 → 标准作答」:
 * 支持 "BACDA" / "1-5 BACDA 6-10 CCDAB" / "1.B" / "1:B,2:A" / 判断题
 * "√×√" "对错对" "TTFF"。区段与逐题对两轮都跑、合并进同一 Map(混排形态
 * 如 "1.B 2.A 3.C 4.D 5.B 6-10 CCDAB" / "1-5 BACDA 6.B 7.C";长度对不上
 * 的半坏区段跳过不计命中)。裸序列维持兜底地位: 仅当前两形态零命中才尝试。
 * 解析不出或题号冲突 → null(该题回落模型批改)。
 *
 * expectedSubCount(可选,题名可推导时传入): 裸序列仅接受判断符号序列或
 * 长度恰等于期望的字母序列;最终条目数 ≠ 期望 → null——部分解析直接
 * 回落模型批改,不再静默按"缺省=对"改错分。不传时与单参调用完全一致。
 */
export function parseReferenceAnswers(
  ref: string | undefined,
  expectedSubCount?: number,
): Map<number, string> | null {
  if (typeof ref !== 'string') return null
  const text = ref.replace(/\s+/g, ' ').trim()
  if (text.length === 0 || text.length > 2000) return null
  const expect =
    expectedSubCount !== undefined &&
    Number.isInteger(expectedSubCount) &&
    expectedSubCount > 0 &&
    expectedSubCount <= 200
      ? expectedSubCount
      : undefined
  const out = new Map<number, string>()
  const put = (no: number, value: string): boolean => {
    const v = normalizeObjectiveValue(value)
    if (v.length === 0) return true
    const prev = out.get(no)
    if (prev !== undefined && prev !== v) return false // 题号冲突 → 放弃
    out.set(no, v)
    return true
  }

  // 形态一: 区段 "1-5 BACDA"(每字符一题)
  const segmentRe = /(\d{1,3})\s*[-–—~至]\s*(\d{1,3})\s*[.、:：)）]?\s*([A-Ha-h√×对错TFtf]{2,})/g
  let structuredHits = 0
  for (const m of text.matchAll(segmentRe)) {
    const start = Number(m[1])
    const end = Number(m[2])
    const seq = m[3] ?? ''
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) continue
    if (end - start + 1 !== seq.length) continue // 长度对不上 → 形态误匹配
    structuredHits++
    for (let i = 0; i < seq.length; i++) {
      if (!put(start + i, seq[i])) return null
    }
  }

  // 形态二: 逐题对 "1.B" / "2、A" / "3:√"(值限单字符: 选项/判断符)
  const pairRe = /(\d{1,3})\s*[.、:：)）]?\s*([A-Ha-h√×对错TF])(?![A-Ha-h√×对错TF])/g
  for (const m of text.matchAll(pairRe)) {
    structuredHits++
    if (!put(Number(m[1]), m[2])) return null
  }

  // 形态三: 裸序列 "BACDA" / "√×√×" / "TTFF"(前两形态零命中才尝试)
  if (structuredHits === 0) {
    const bare = text.replace(/[\s,，、;；/|.]+/g, '')
    const acceptable =
      expect !== undefined
        ? TRUE_FALSE_SEQ_RE.test(bare) || bare.length === expect
        : LETTER_SEQ_RE.test(bare) || TRUE_FALSE_SEQ_RE.test(bare)
    if (acceptable) {
      for (let i = 0; i < bare.length && i < 200; i++) {
        if (!put(i + 1, bare[i])) return null
      }
    }
  }
  if (out.size === 0) return null
  if (expect !== undefined && out.size !== expect) return null
  return out
}

// ===== 纯函数: 转写批(客观题只读不判) =====

export interface TranscribedItem {
  no: number
  value: string
  uncertain: boolean
}

export function buildTranscribePrompt(q: RubricQuestion, subCount: number): string {
  return [
    '你是阅卷助手。只认读图中该大题每个小题学生填写的作答，不判分。',
    `大题: ${q.title}(共 ${subCount} 小题)。`,
    '逐小题读出学生选择的选项字母(大写)或判断结果；涂改/未作答也要给出条目。',
    '',
    '输出格式(answers 必须覆盖全部小题号):',
    '{"answers":[{"no":1,"value":"B","uncertain":false}]}',
    '- no: 小题号(数字); value: 选项字母(如 "B")或判断(对/错); 未作答为 ""',
    '- value 原样照抄学生写的,不要替学生纠错',
    '- 字迹不清/涂改难辨时 uncertain: true,并在 value 给最可能的读法',
    '- 只输出上述 JSON，不要 markdown 代码块标记',
  ].join('\n')
}

/** 解析转写输出;answers 支持数组或 {小题号:值} 对象;清洗/归一;解析失败抛错 */
export function parseTranscribeResponse(text: string): TranscribedItem[] {
  const parsed = parseLooseJson(text)
  const rawAnswers = (parsed as { answers?: unknown })?.answers
  const items: TranscribedItem[] = []
  const push = (no: unknown, value: unknown, uncertain: unknown) => {
    const n = Number(no)
    if (!Number.isInteger(n) || n < 1 || n > 200) return
    const v =
      typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
    items.push({ no: n, value: normalizeObjectiveValue(v), uncertain: uncertain === true })
  }
  if (Array.isArray(rawAnswers)) {
    for (const raw of rawAnswers) {
      if (typeof raw !== 'object' || raw === null) continue
      const o = raw as Record<string, unknown>
      push(o.no, o.value, o.uncertain)
    }
  } else if (typeof rawAnswers === 'object' && rawAnswers !== null) {
    for (const [no, value] of Object.entries(rawAnswers as Record<string, unknown>)) {
      push(no, value, undefined)
    }
  }
  if (items.length === 0) throw new Error('转写输出没有可用的小题作答')
  // 同题号去重(保留最后一个)
  const byNo = new Map(items.map((i) => [i.no, i]))
  return [...byNo.values()].sort((a, b) => a.no - b.no)
}

// ===== 纯函数: 规则判分 =====

/** 每小题分值: 优先取评分点里「第N小题」条目的绝对值,否则 满分/小题数。
 *  除法分支返回精确值(前置舍入会让"错 N 题后的总分"在第 2 位小数漂移,
 *  如 10 分 3 小题全错得 0.01);残差由得分处统一 round+clamp 消化,
 *  扣分项展示时才 round 到 2 位。 */
export function perSubQuestionMark(q: RubricQuestion, subCount: number): number {
  for (const m of q.presetMarks ?? []) {
    if (typeof m?.note === 'string' && /第\s*\d+\s*(小题|题|空)/.test(m.note)) {
      const abs = Math.abs(Number(m.points))
      if (Number.isFinite(abs) && abs > 0) return abs
    }
  }
  if (!Number.isInteger(subCount) || subCount <= 0) return q.fullMark
  return q.fullMark / subCount
}

export interface RuleScoreOutcome {
  result: AiQuestionResult
  /** 模型自报读不准的小题号(触发复读复验) */
  uncertainNos: number[]
}

/** 单选/判断规则判分: 逐小题与参考答案严格比对;未作答/读不出按错计 */
export function ruleScoreQuestion(
  q: RubricQuestion,
  ref: Map<number, string>,
  items: TranscribedItem[],
): RuleScoreOutcome {
  const per = perSubQuestionMark(q, ref.size)
  const byNo = new Map(items.map((i) => [i.no, i]))
  const deductions: NonNullable<AiQuestionResult['deductions']> = []
  const uncertainNos: number[] = []
  let errors = 0
  const refNos = [...ref.keys()].sort((a, b) => a - b)
  for (const no of refNos) {
    const expect = ref.get(no) ?? ''
    const item = byNo.get(no)
    const got = item ? normalizeObjectiveValue(item.value) : ''
    if (got === expect) continue
    errors++
    if (item?.uncertain) uncertainNos.push(no)
    deductions.push({
      points: Math.round(per * 100) / 100, // 展示文本舍入到 2 位;score 才是权威值
      reason: got.length > 0 ? `第${no}小题选${got},应为${expect}` : `第${no}小题未作答`,
    })
  }
  const score = Math.min(
    Math.max(Math.round((q.fullMark - errors * per) * 100) / 100, 0),
    q.fullMark,
  )
  return {
    result: {
      questionId: q.id,
      score,
      evidence: `按参考答案逐小题比对: ${refNos.length - errors}/${refNos.length} 对`,
      ...(errors > 0 && deductions.length > 0 ? { deductions: deductions.slice(0, 8) } : {}),
    },
    uncertainNos,
  }
}

// ===== 纯函数: 逐题聚焦批改 =====

function formatMarks(q: RubricQuestion): string {
  const marks: PresetMark[] = q.presetMarks ?? []
  if (marks.length === 0) return ''
  const items = marks
    .map((m, i) => {
      const pts = m.points > 0 ? `+${m.points}` : String(m.points)
      return `[${i}] ${m.note.replace(/\s+/g, ' ').trim()} (${pts})`
    })
    .join('；')
  return ` | 评分点: ${items}`
}

const GRADING_MODES: GradingStrictness[] = ['strict', 'normal', 'lenient']

/** 单题聚焦批改 prompt: 该题量规 + 口径规则 + 单对象 JSON 契约 */
export function buildStagedGradePrompt(q: RubricQuestion, mode: GradingStrictness): string {
  const m: GradingStrictness = GRADING_MODES.includes(mode) ? mode : 'normal'
  const hasMarks = (q.presetMarks?.length ?? 0) > 0
  return [
    '你是严格且公正的阅卷教师。图片只包含这一道题(若是整卷,请只批改题目清单指定的这一题)。',
    `题目: ${q.title} | 满分: ${q.fullMark}${
      q.referenceAnswer ? ` | 评分标准: ${q.referenceAnswer.replace(/\s+/g, ' ').trim()}` : ''
    }${formatMarks(q)}`,
    '',
    `批改口径: ${gradingModeLabel(m)}模式`,
    ...MODE_RULES[m],
    '',
    '输出格式(只输出一个 JSON 对象):',
    hasMarks
      ? '{"score":6,"marks":[0,1],"evidence":"依据：学生…","comment":"评语(可选)","deductions":[{"points":2,"reason":"单位未换算"}],"box":{"page":0,"x":0.1,"y":0.4,"w":0.8,"h":0.3}}'
      : '{"score":6,"evidence":"依据：学生…","comment":"评语(可选)","deductions":[{"points":2,"reason":"单位未换算"}],"box":{"page":0,"x":0.1,"y":0.4,"w":0.8,"h":0.3}}',
    '规则:',
    '- score 为数字,取值 [0, 满分],按评分标准的有效分给分,不要凭空加减',
    '- evidence 写一句,引用学生卷面实际作答;字迹不清保守给分并说明',
    '- 未作答 score 给 0,comment 标注「未作答」',
    '- comment 像老师红笔批注: 30 字以内,面向学生;客观题(选择/填空/判断)不要写',
    '- deductions: score < 满分时逐项列出扣分点(points 为正数,合计 ≈ 满分 - score);全对不给',
    '- box 框住该题作答区域(相对所给图片,0–1);宽高宁小勿大,不要框进相邻题',
    ...(hasMarks
      ? [
          '- marks 填选中的评分点序号(可多选); score 必须等于 满分+所选评分点分值之和(钳制到[0,满分])',
        ]
      : []),
    '- 只输出上述 JSON，不要 markdown 代码块标记',
  ].join('\n')
}

/** 解析单题批改输出(支持裸对象/{"question":{}}/questions 数组取首个);失败抛错 */
export function parseStagedGradeResponse(text: string, q: RubricQuestion): AiQuestionResult {
  const parsed = parseLooseJson(text)
  let r = parsed
  const wrapped = (parsed as { questions?: unknown[]; question?: unknown }) ?? {}
  if (Array.isArray(wrapped.questions) && wrapped.questions.length > 0) {
    r = (wrapped.questions[0] ?? {}) as Record<string, unknown>
  } else if (typeof wrapped.question === 'object' && wrapped.question !== null) {
    r = wrapped.question as Record<string, unknown>
  }
  const preset: PresetMark[] = q.presetMarks ?? []
  const appliedMarks = Array.isArray(r.marks)
    ? [
        ...new Set(
          (r.marks as unknown[])
            .map((x) => Number(x))
            .filter((i) => Number.isInteger(i) && i >= 0 && i < preset.length),
        ),
      ].sort((a, b) => a - b)
    : []
  let score = Number(r.score)
  if (appliedMarks.length > 0 && preset.length > 0) {
    score = markScoreFromSelection(q.fullMark, preset, appliedMarks)
  } else if (!Number.isFinite(score)) {
    throw new Error('单题批改输出缺少有效 score')
  } else {
    score = Math.min(Math.max(score, 0), q.fullMark)
  }
  return {
    questionId: q.id,
    score,
    evidence: typeof r.evidence === 'string' ? r.evidence : undefined,
    comment: typeof r.comment === 'string' ? r.comment : undefined,
    appliedMarks: appliedMarks.length > 0 ? appliedMarks : undefined,
    box: parseAnnotationBox(r.box),
    deductions: parseDeductions(r.deductions, q.fullMark, score),
  }
}

// ===== 纯函数: 版面定位 =====

export function buildLocatePrompt(rubric: RubricQuestion[]): string {
  const lines = rubric.map((q) => `- id: ${q.id} | 题目: ${q.title}`).join('\n')
  return [
    '你是试卷版面定位助手。在图片中找到题目清单里每道大题的学生作答区域。',
    '',
    '题目清单:',
    lines,
    '',
    '输出格式(boxes 必须覆盖清单每一个 id):',
    '{"boxes":[{"questionId":"q-1","page":0,"x":0.05,"y":0.3,"w":0.9,"h":0.2}]}',
    '- page 从 0 起,按图片顺序; x/y/w/h 为相对该页宽高的 0–1',
    '- 框住该大题全部小题的作答区域(含小题题号行)',
    '- 宽高宁可偏大,不可截断任何手写作答;跨页的题框主要作答所在页',
    '- 只输出上述 JSON，不要 markdown 代码块标记',
  ].join('\n')
}

/** 解析定位输出;未知题丢弃、同题取首个、坐标经既有钳制;失败返回空 Map(回落整页) */
export function parseLocateResponse(
  text: string,
  rubric: RubricQuestion[],
): Map<string, GradeAnnotationBox> {
  const out = new Map<string, GradeAnnotationBox>()
  try {
    const parsed = parseLooseJson(text)
    const rawBoxes = (parsed as { boxes?: unknown })?.boxes
    if (!Array.isArray(rawBoxes)) return out
    const ids = new Set(rubric.map((q) => q.id))
    for (const raw of rawBoxes) {
      if (typeof raw !== 'object' || raw === null) continue
      const o = raw as Record<string, unknown>
      const questionId = typeof o.questionId === 'string' ? o.questionId : ''
      if (!ids.has(questionId) || out.has(questionId)) continue
      const box = parseAnnotationBox(o.box ?? o)
      if (box) out.set(questionId, box)
    }
  } catch (err) {
    log('warn', 'grading', `locate parse failed: ${errText(err)}`)
  }
  return out
}

// ===== 纯函数: 裁剪几何 =====

/** 四边各外扩 box 边长的 20%(防定位抖动截断作答),钳制在页内 */
export function expandBox(box: GradeAnnotationBox, margin = 0.2): GradeAnnotationBox {
  const w = Math.min(1, box.w * (1 + margin * 2))
  const h = Math.min(1, box.h * (1 + margin * 2))
  const x = Math.min(Math.max(box.x - box.w * margin, 0), Math.max(1 - w, 0))
  const y = Math.min(Math.max(box.y - box.h * margin, 0), Math.max(1 - h, 0))
  return { page: box.page, x, y, w, h }
}

/** 裁剪图内的相对 box → 整页相对 box(线性映射) */
export function mapCropBoxToPage(
  crop: GradeAnnotationBox,
  inner: GradeAnnotationBox,
): GradeAnnotationBox {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
  return {
    page: crop.page,
    x: clamp01(crop.x + inner.x * crop.w),
    y: clamp01(crop.y + inner.y * crop.h),
    w: Math.min(crop.w * inner.w, 1),
    h: Math.min(crop.h * inner.h, 1),
  }
}

/**
 * 多采样取中位挑选(主观题贴边界复验口径): 样本间最大分差 ≤ tolerance
 * 视为一致,返回首采;否则返回分数居中的样本(并列时取采样原序首个命中者;
 * 调用方固定三采样)。返回的是被选中的原样本,box 仍是裁剪图口径,
 * 由调用方在选定后统一 mapCropBoxToPage 一次。
 */
export function pickMedianSample<T extends { score: number }>(
  samples: T[],
  tolerance = 0,
): T | null {
  if (samples.length === 0) return null
  const first = samples[0]
  if (!first) return null
  if (samples.length === 1) return first
  const scores = samples.map((s) => s.score)
  const spread = Math.max(...scores) - Math.min(...scores)
  if (spread <= tolerance) return first
  const sorted = [...scores].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median === undefined) return first
  return samples.find((s) => s.score === median) ?? first
}

// ===== 共用: 松散 JSON 解析(剥围栏→截取大括号→修复) =====

function parseLooseJson(text: string): Record<string, unknown> {
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  const braceStart = stripped.indexOf('{')
  const braceEnd = stripped.lastIndexOf('}')
  const candidates =
    braceStart >= 0 && braceEnd > braceStart
      ? [stripped.slice(braceStart, braceEnd + 1), stripped]
      : [stripped]
  let parsed: unknown
  let ok = false
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate)
      ok = true
      break
    } catch {
      // 下一个候选
    }
  }
  if (!ok) {
    // 修复解析也失败: 归一为解析类错误消息(isGradingParseError 分类闭环,
    // 不让 pi-ai 的内部错误消息逃逸成不可分类的传输类)
    try {
      parsed = parseJsonWithRepair(candidates[candidates.length - 1] ?? stripped)
    } catch {
      throw new Error('输出不是 JSON 对象')
    }
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('输出不是 JSON 对象')
  return parsed as Record<string, unknown>
}

// ===== 编排(有状态) =====

/** 批次进度回调(渲染层 stage 进度条) */
export interface StagedStageInfo {
  label: string
  index: number
  total: number
}

export interface GradePaperStagedOptions {
  task: GradingTask
  paperId: string
  model: Model<Api>
  apiKey: string
  signal: AbortSignal
  /** 同模型条件复验(标准档 true;双评档 false,由跨模型比对替代) */
  selfVerify?: boolean
  onStage?: (info: StagedStageInfo) => void
  /**
   * 双评共享上下文(同卷两模型复用页缓存与一次 locate): 几何定位与读盘
   * 不是评分判断,共享不损双评独立性;两个模型各自的 grade/transcribe
   * 调用照常独立计数。由调用方(dual 分支)创建并先后传入两次调用。
   */
  shared?: StagedSharedContext
}

/** 双评共享上下文: 首个模型读盘/定位后填充,第二模型直接复用 */
export interface StagedSharedContext {
  /** 页图缓存(与 paper.files 同序;首模型读盘填充) */
  pages?: Buffer[]
  /** locate 结果(questionId → box;母版模板复用或首模型定位成功后填充) */
  boxes?: Map<string, GradeAnnotationBox>
}

/** 用 @napi-rs/canvas 按整页相对 box 裁剪(只缩不放,长边≤2200px);失败返回 null 回落整页 */
async function cropPaperImage(buf: Buffer, box: GradeAnnotationBox): Promise<Buffer | null> {
  try {
    const { loadImage, createCanvas } = await import('@napi-rs/canvas')
    const img = await loadImage(buf)
    const x = Math.max(0, Math.min(img.width - 1, Math.floor(img.width * box.x)))
    const y = Math.max(0, Math.min(img.height - 1, Math.floor(img.height * box.y)))
    const w = Math.max(1, Math.min(img.width - x, Math.floor(img.width * box.w)))
    const h = Math.max(1, Math.min(img.height - y, Math.floor(img.height * box.h)))
    const scale = Math.min(1, 2200 / Math.max(w, h))
    const outW = Math.max(1, Math.floor(w * scale))
    const outH = Math.max(1, Math.floor(h * scale))
    const canvas = createCanvas(outW, outH)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, x, y, w, h, 0, 0, outW, outH)
    return canvas.toBuffer('image/jpeg', 0.9)
  } catch (err) {
    log('warn', 'grading', `crop skipped: ${errText(err)}`)
    return null
  }
}

interface UsageAcc {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * 分阶段批改一份试卷:
 * 定位(1 次) → 裁剪(本地) → 逐题批次(转写+规则判分 / 聚焦批改)
 * → 条件复验(uncertain 复读 / 主观题贴边界二采三采取中位)。
 * 任何批次重试一次后仍失败 → 抛错(该卷 failed);中止即时抛出。
 */
export async function gradePaperStaged(opts: GradePaperStagedOptions): Promise<AiGradeResult> {
  const { task, paperId, model, apiKey, signal, selfVerify = true, onStage } = opts
  const paper: GradingPaper | undefined = task.papers.find((p) => p.id === paperId)
  if (!paper) throw new Error(`试卷不存在: ${paperId}`)
  if (paper.files.length === 0) throw new Error('该试卷没有扫描件')

  // 页图: 双评共享缓存优先(第二模型免读盘),否则读盘并写回共享上下文
  const pages =
    opts.shared?.pages ??
    (await Promise.all(
      paper.files.map((f) => fsp.readFile(gradingService.paperFilePath(task.id, f.storedName))),
    ))
  if (opts.shared) opts.shared.pages = pages
  const fullParts = pages.map((buf, i) => ({
    type: 'image' as const,
    data: buf.toString('base64'),
    mimeType: paper.files[i]?.mime ?? 'image/jpeg',
  }))
  const batches = planStagedBatches(task.rubric)
  const stageTotal = 1 + batches.length
  const usage: UsageAcc = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

  /** 单次模型调用(文本抽取+用量累计) */
  async function call(
    systemPrompt: string,
    parts: Array<{ type: 'image'; data: string; mimeType: string }>,
    userText: string,
    maxTokens: number,
  ): Promise<string> {
    if (signal.aborted) throw new Error('已中止')
    const messages: Message[] = [
      {
        role: 'user',
        content: [...parts, { type: 'text' as const, text: userText }],
        timestamp: Date.now(),
      },
    ]
    const assistant = await completeGradingCall(
      model,
      { systemPrompt, messages },
      {
        apiKey,
        maxTokens,
        signal,
        cacheRetention: 'short',
        sessionId: `grading:${task.id}`,
      },
    )
    if (assistant.stopReason === 'aborted') throw new Error('已中止')
    const u = assistant.usage
    if (u) {
      usage.input += u.input
      usage.output += u.output
      usage.cacheRead += u.cacheRead || 0
      usage.cacheWrite += u.cacheWrite || 0
    }
    return (assistant.content ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
  }

  /** 调用+解析重试一次(仅传输类瞬时失败);中止与解析类错误直接上抛——
   * 解析类错误(isGradingParseError,与 regrade 外层同一分类器)重试大概率
   * 原样复现,徒增一次全量输入词耗 */
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (signal.aborted || errText(err).includes('已中止')) throw err
      if (isGradingParseError(err)) throw err
      return await fn()
    }
  }

  // 1) 版面定位(失败回落整页,不阻断):
  //    优先级 双评共享缓存 → 母版模板复用 → 逐卷 locate。
  //    模板复用条件: overlayTemplate.boxes 覆盖全部量规题且该卷页数与
  //    标定页数一致——同版式全班卷的作答区坐标可复用(省每卷一次全页
  //    图输入);任一条件不满足回落逐卷 locate。
  onStage?.({ label: '定位每题作答区域', index: 1, total: stageTotal })
  let boxes = new Map<string, GradeAnnotationBox>()
  const templateBoxes = task.overlayTemplate?.boxes
  const templatePages = task.overlayTemplate?.files.length ?? 0
  const templateUsable =
    templateBoxes !== undefined &&
    templatePages > 0 &&
    paper.files.length === templatePages &&
    task.rubric.every((q) => {
      const b = templateBoxes[q.id]
      return b !== undefined && Number.isFinite(b.x) && Number.isFinite(b.w) && b.w > 0
    })
  if (opts.shared?.boxes && opts.shared.boxes.size > 0) {
    boxes = opts.shared.boxes
  } else if (templateUsable && templateBoxes) {
    for (const q of task.rubric) {
      const b = templateBoxes[q.id]
      if (b) boxes.set(q.id, b)
    }
    log('info', 'grading', `locate reused overlay template: ${task.id}/${paperId}`)
  } else {
    try {
      const text = await withRetry(() =>
        call(
          buildLocatePrompt(task.rubric),
          fullParts,
          '请定位每道大题的作答区域，只输出 JSON。',
          2048,
        ),
      )
      boxes = parseLocateResponse(text, task.rubric)
    } catch (err) {
      if (signal.aborted || errText(err).includes('已中止')) throw err
      log('warn', 'grading', `locate failed (fallback to full pages): ${paperId}: ${errText(err)}`)
    }
  }
  // 定位成功(含模板复用)写回共享上下文,双评第二模型免再定位
  if (opts.shared && !opts.shared.boxes && boxes.size > 0) opts.shared.boxes = boxes

  // 2) 逐题裁剪(本地,零调用)
  const cropByQuestion = new Map<string, { buf: Buffer; box: GradeAnnotationBox }>()
  for (const q of task.rubric) {
    const box = boxes.get(q.id)
    if (!box) continue
    const pageIdx = Math.min(Math.max(box.page, 0), pages.length - 1)
    const expanded = expandBox(box)
    const jpeg = await cropPaperImage(pages[pageIdx], expanded)
    if (jpeg) cropByQuestion.set(q.id, { buf: jpeg, box: expanded })
  }

  // 3) 分批批改
  const results: AiQuestionResult[] = []
  const rubricOrder = task.rubric.map((q) => q.id)
  for (const [bi, batch] of batches.entries()) {
    if (signal.aborted) throw new Error('已中止')
    const q = batch.question
    const crop = cropByQuestion.get(q.id)
    const parts = crop
      ? [{ type: 'image' as const, data: crop.buf.toString('base64'), mimeType: 'image/jpeg' }]
      : fullParts
    onStage?.({ label: `批改 ${q.title}`, index: bi + 2, total: stageTotal })

    if (batch.kind === 'transcribe') {
      const ref = parseReferenceAnswers(q.referenceAnswer, expectedSubCountOf(q))
      if (!ref) continue // 规划后仍解析不出(理论不可达):跳过,末尾校验兜底
      const readOnce = (): Promise<TranscribedItem[]> =>
        withRetry(async () =>
          parseTranscribeResponse(
            await call(
              buildTranscribePrompt(q, ref.size),
              parts,
              '请逐小题读出学生作答，只输出 JSON。',
              1024,
            ),
          ),
        )
      let items = await readOnce()
      let outcome = ruleScoreQuestion(q, ref, items)
      // 条件复验: 只对模型自报读不准的小题复读一次,复读结果覆盖原读法
      if (selfVerify && outcome.uncertainNos.length > 0) {
        try {
          const secondText = await call(
            buildTranscribePrompt(q, ref.size),
            parts,
            `请再次仔细认读第 ${outcome.uncertainNos.join('、')} 小题的学生作答，只输出 JSON。`,
            512,
          )
          const second = parseTranscribeResponse(secondText)
          const secondByNo = new Map(second.map((i) => [i.no, i]))
          const merged = items
            .map((i) =>
              outcome.uncertainNos.includes(i.no) && secondByNo.has(i.no)
                ? (secondByNo.get(i.no) as TranscribedItem)
                : i,
            )
            .filter((i) => !outcome.uncertainNos.includes(i.no) || secondByNo.has(i.no))
          for (const no of outcome.uncertainNos) {
            if (!merged.some((i) => i.no === no) && secondByNo.has(no)) {
              merged.push(secondByNo.get(no) as TranscribedItem)
            }
          }
          items = merged
          outcome = ruleScoreQuestion(q, ref, items)
        } catch (err) {
          log('warn', 'grading', `transcribe re-read failed: ${q.id}: ${errText(err)}`)
        }
      }
      // 复验后仍读不准(selfVerify 复读覆盖后重判仍 uncertain,或复验失败
      // 保留首轮): 判分照常采信,标 medium 登记待复核(参考包 M 级口径)
      results.push({
        ...outcome.result,
        box: boxes.get(q.id),
        ...(outcome.uncertainNos.length > 0 ? { confidence: 'medium' as const } : {}),
      })
      continue
    }

    // 聚焦批改批(主观/填空/多选/未解析客观)
    const gradeOnce = (): Promise<AiQuestionResult> =>
      withRetry(async () =>
        parseStagedGradeResponse(
          await call(
            buildStagedGradePrompt(q, task.gradingMode ?? 'normal'),
            parts,
            '请批改这道题，只输出 JSON。',
            Math.min(4096, model.maxTokens || 4096),
          ),
          q,
        ),
      )
    let result = await gradeOnce()
    // 条件复验: 主观题 0/满分边界(高风险给分)二次采样,分歧大取三采中位。
    // 触发只看 score;box 映射统一后置,复验选中二/三采时以其原始裁剪图
    // 坐标为基准,不再出现"中位落在非首采时 box 未映射"的口径漂移。
    if (
      selfVerify &&
      questionKind(q) === 'subjective' &&
      (result.score <= 0 || result.score >= q.fullMark)
    ) {
      try {
        const second = await gradeOnce()
        if (Math.abs(second.score - result.score) > dualTolerance(q.fullMark)) {
          const third = await gradeOnce()
          const picked = pickMedianSample([result, second, third])
          if (picked) {
            result = {
              ...picked,
              evidence: `${(picked.evidence ?? '').slice(0, 160)}(复验取中位)`,
              // 分歧大到要三采取中位: 采信中位分但登记待复核
              confidence: 'medium' as const,
            }
          }
        }
      } catch (err) {
        log('warn', 'grading', `boundary verify failed: ${q.id}: ${errText(err)}`)
      }
    }
    // box 坐标换算(选定后统一一次): 裁剪图内的相对 box → 整页;
    // 无裁剪时模型 box 已是整页口径
    if (crop) {
      result = {
        ...result,
        box: mapCropBoxToPage(crop.box, result.box ?? { page: 0, x: 0, y: 0, w: 1, h: 1 }),
      }
    }
    results.push(result)
  }

  // 按量规序输出;缺失题(理论不可达)由 saveAiResult 按量规校验兜底
  const ordered = rubricOrder
    .map((id) => results.find((r) => r.questionId === id))
    .filter((r): r is AiQuestionResult => r !== undefined)
  if (ordered.length === 0) throw new Error('分阶段批改没有产出任何题目结果')
  return {
    questions: ordered,
    totalScore: ordered.reduce((sum, r) => sum + r.score, 0),
    model: { provider: model.provider, model: model.id },
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead || undefined,
      cacheWrite: usage.cacheWrite || undefined,
    },
    finishedAt: new Date().toISOString(),
  }
}
