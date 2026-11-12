// =============================================================
// Extreme AI Grading Pipeline — 极致 AI 模式
//
// 全程依靠视觉模型自行批改(不用规则给分 / 模板-only 通路)。
// 初评后派出两个独立 DSH 子代理对齐核验;两份核验完全通过才给分。
// 不通过则重裁,再派一个子代理仲裁,以仲裁结果给分。
//
// 打印 PDF 仍走产品已有的 traces / exportAnnotatedPdf 通路,由提示词
// 要求 AI 自行判断并给出与现有红笔痕迹契约一致的 box / comment /
// deductions,不另起一套导出器。
//
// 子代理接线:教师 sdk 的 hardening 禁用了官方 dsh-tool-subagent,
// delegate_to 只注入主对话,批改子进程里不能用这两条工具派子代理。
// 本模式通过批改链路已有的官方钩子 completeGradingCall
// (completeSimpleViaDsh) 为每次核验 / 重裁 / 仲裁开独立 session 的
// DSH 调用——这是真实模型调用,不是写在提示词里的空文。
//
// 本模式上下文窗口固定 200K(不得再放大),超阈自动压缩文本
// (不丢卷面图片),以免费用失控。
// =============================================================

import fsp from 'node:fs/promises'
import type { Api, AssistantMessage, Message, Model } from '@main/services/llm-contracts'
import { normalizeGradingStrategy, questionKind } from '@shared/grading-helpers'
import type {
  AiGradeResult,
  AiQuestionResult,
  GradingPaper,
  GradingStrictness,
  GradingTask,
  RubricQuestion,
} from '@shared/types'
import { parseJsonWithRepair } from '../../utils/json-repair'
import { log } from '../../utils/logger'
import { buildGradingPrompt, fastGradeMaxTokens, parseGradeResponse } from './grading-pipeline'
import { gradingService } from './grading-service'
import { completeGradingCall } from './llm-call'
import type { StagedStageInfo } from './staged-pipeline'

/** 极致 AI 模式上下文上限:200K tokens,不使用更大窗口 */
export const EXTREME_CONTEXT_WINDOW = 200_000

/** 触发自动压缩的预留(窗口的 10%,且不少于 4096) */
const EXTREME_RESERVE_TOKENS = Math.max(4096, Math.floor(EXTREME_CONTEXT_WINDOW * 0.1))

function note(level: 'info' | 'warn', msg: string): void {
  const fn = log[level]
  if (typeof fn === 'function') fn(msg)
}

export interface ExtremeImagePart {
  type: 'image'
  data: string
  mimeType: string
}

export type ExtremeComplete = (
  model: Model<Api>,
  context: { systemPrompt?: string; messages: Message[] },
  options: {
    apiKey: string
    maxTokens: number
    signal?: AbortSignal
    cacheRetention?: 'none' | 'short' | 'long'
    sessionId?: string
  },
) => Promise<AssistantMessage>

export interface ExtremeGradeDeps {
  complete?: ExtremeComplete
  loadImages?: (taskId: string, files: GradingPaper['files']) => Promise<ExtremeImagePart[]>
}

export interface GradePaperExtremeOptions {
  task: GradingTask
  paperId: string
  model: Model<Api>
  apiKey: string
  signal: AbortSignal
  onStage?: (info: StagedStageInfo) => void
  deps?: ExtremeGradeDeps
}

export interface ExtremeVerification {
  passed: boolean
  summary?: string
  issues: Array<{ questionId?: string; reason: string }>
}

function estimateTextTokens(text: string): number {
  // 宁多估: CJK 约 1 token/字,其他约 4 字符/token
  let n = 0
  for (const ch of text) {
    n += ch.charCodeAt(0) > 0xff ? 1 : 0.25
  }
  return Math.ceil(n)
}

function imageTokenEstimate(data: string): number {
  // 粗估视觉占用;偏保守以便尽早压缩文本。不根据此丢弃图片。
  return Math.max(800, Math.ceil(data.length / 16))
}

function contentParts(content: Message['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (Array.isArray(content)) return content as Array<Record<string, unknown>>
  return []
}

/** 估算 system + messages(含图片)的 token,供 200K 预算判断 */
export function estimateExtremeTokens(systemPrompt: string, messages: Message[]): number {
  let n = estimateTextTokens(systemPrompt)
  for (const m of messages) {
    for (const p of contentParts(m.content)) {
      if (p.type === 'text' && typeof p.text === 'string') n += estimateTextTokens(p.text)
      else if (p.type === 'image' && typeof p.data === 'string') n += imageTokenEstimate(p.data)
    }
  }
  return n
}

/**
 * 将本模式上下文压进 200K:只压缩文本(提示词 / 初评 JSON / 核验意见),
 * 卷面图片一律保留。压缩是截断式的,不再另调模型做摘要,以免额外花钱。
 */
export function applyExtremeContextBudget(
  systemPrompt: string,
  messages: Message[],
): { systemPrompt: string; messages: Message[] } {
  const threshold = EXTREME_CONTEXT_WINDOW - EXTREME_RESERVE_TOKENS
  if (estimateExtremeTokens(systemPrompt, messages) <= threshold) {
    return { systemPrompt, messages }
  }

  let sys = systemPrompt
  const next: Message[] = messages.map((m) => ({ ...m, content: m.content }))

  const compactText = (text: string, cap: number): string => {
    if (text.length <= cap) return text
    const head = Math.floor(cap * 0.6)
    const tail = cap - head - 24
    return `${text.slice(0, head)}\n…(已自动压缩,上下文上限 200K)…\n${text.slice(-Math.max(tail, 0))}`
  }

  // 先压用户文本(核验材料通常最大),再压 system
  for (let i = 0; i < next.length; i++) {
    if (estimateExtremeTokens(sys, next) <= threshold) break
    const parts = contentParts(next[i].content)
    const compacted = parts.map((p) => {
      if (p.type !== 'text' || typeof p.text !== 'string') return p
      return { ...p, text: compactText(p.text, 12_000) }
    })
    const hasImage = compacted.some((p) => p.type === 'image')
    next[i] = {
      ...next[i],
      content:
        hasImage || compacted.length > 1
          ? (compacted as Message['content'])
          : String(compacted[0]?.text ?? ''),
    }
  }
  if (estimateExtremeTokens(sys, next) > threshold) {
    sys = compactText(sys, 8_000)
  }
  const after = estimateExtremeTokens(sys, next)
  if (after > threshold) {
    note(
      'warn',
      `极致 AI 上下文压缩后仍约 ${after} tokens(上限 ${EXTREME_CONTEXT_WINDOW};图片占用无法再压,已压文本)`,
    )
  } else {
    note('info', `极致 AI 已自动压缩上下文至约 ${after} tokens(上限 ${EXTREME_CONTEXT_WINDOW})`)
  }
  return { systemPrompt: sys, messages: next }
}

function formatRubric(rubric: RubricQuestion[]): string {
  return rubric
    .map((q) => {
      const kind = questionKind(q) === 'objective' ? '客观' : '主观'
      const ref = q.referenceAnswer
        ? ` | 评分标准: ${q.referenceAnswer.replace(/\s+/g, ' ').trim()}`
        : ''
      const marks =
        q.presetMarks && q.presetMarks.length > 0
          ? ` | 评分点: ${q.presetMarks.map((m, i) => `[${i}] ${m.note ?? ''}(${m.points})`).join('; ')}`
          : ''
      return `- id: ${q.id} | 题目: ${q.title} | 题类: ${kind} | 满分: ${q.fullMark}${ref}${marks}`
    })
    .join('\n')
}

function modeLabel(mode: GradingStrictness): string {
  if (mode === 'strict') return '严格'
  if (mode === 'lenient') return '宽松'
  return '正常'
}

/** 初评 / 重裁:纯视觉批改 + 打印痕迹契约 */
export function buildExtremeGradePrompt(
  rubric: RubricQuestion[],
  mode: GradingStrictness = 'normal',
): string {
  const base = buildGradingPrompt(rubric, mode)
  return [
    base,
    '',
    '【极致 AI 模式 — 必须遵守】',
    '- 你必须完全依靠自己的视觉能力审阅试卷图片来批改,不要假设有外部规则引擎、答题卡模板或程序自动给分。每一题(含选择/填空等客观题)都由你看卷面后判断。',
    '- 批改完成后,系统会派出两个子代理对照卷面做对齐核验;两份核验完全通过才会给学生记分。核验不通过将重裁,再由一个仲裁子代理裁定最终分数。请给足可核验的 evidence,并保证 score / deductions / box 自洽。',
    '- 打印 PDF / 套打红笔会直接使用你输出的 box、comment、deductions。请像在纸卷上用红笔批阅那样自行判断布局:每题都给 box 框住作答区;主观题 comment 写在可打印的评语位置(30 字以内,面向学生);未得满分的题给 deductions(points 为正,合计约等于 满分-score)。客观题不要写 comment,但仍要给 box 与(如有扣分的)deductions。',
    '- 只输出一个 JSON 对象,不要解释、不要 markdown。',
  ].join('\n')
}

/** 重裁提示:带上核验未通过的原因,仍是纯视觉重批 */
export function buildExtremeRegradePrompt(
  rubric: RubricQuestion[],
  mode: GradingStrictness,
  issues: Array<{ questionId?: string; reason: string }>,
): string {
  const issueLines =
    issues.length > 0
      ? issues
          .map((it) => `- ${it.questionId ? `题 ${it.questionId}: ` : ''}${it.reason}`)
          .join('\n')
      : '- (核验未通过,但未给出逐条原因,请重新完整审阅卷面)'
  return [
    buildExtremeGradePrompt(rubric, mode),
    '',
    '【重裁】上一轮初评未通过两个子代理的对齐核验,请重新只依据卷面视觉审阅并给出新的完整 JSON。以下是核验指出的问题,供参考但以你自己看见的卷面为准:',
    issueLines,
  ].join('\n')
}

export function buildExtremeVerifyPrompt(agentIndex: 1 | 2, rubric: RubricQuestion[]): string {
  return [
    `你是极致 AI 模式派出的第 ${agentIndex} 个对齐核验子代理。你必须独立工作,不要迎合初评。`,
    '请用自己的视觉能力对照学生试卷图片与初评 JSON,核验:给分是否与卷面作答对齐、是否符合量规、box/comment/deductions 是否与分数自洽、有无漏题或张冠李戴。',
    '只输出一个 JSON 对象,不要解释、不要 markdown。',
    '',
    '量规:',
    formatRubric(rubric),
    '',
    '输出格式:',
    '{"passed":true,"summary":"一句话结论","issues":[]}',
    '或核验不通过:',
    '{"passed":false,"summary":"一句话结论","issues":[{"questionId":"q-1","reason":"原因"}]}',
    '规则:',
    '- 只有初评与卷面完全对齐、没有实质性给分错误时 passed 才能为 true。',
    '- 任何明确的给分错误、漏评、证据与卷面不符,passed 必须为 false,并在 issues 列出。',
    '- 你只核验、不给分;不要输出 questions / score。',
  ].join('\n')
}

export function buildExtremeArbitratePrompt(
  rubric: RubricQuestion[],
  mode: GradingStrictness = 'normal',
): string {
  return [
    '你是极致 AI 模式派出的仲裁子代理。初评未通过两个核验子代理的对齐核验,系统已完成重裁。',
    '请综合:学生试卷图片(以你自己的视觉判断为准)、初评、两份核验意见、重裁结果,裁定每一题的最终分数。',
    '只输出一个 JSON 对象,不要解释、不要 markdown。格式与批改相同,questions 必须覆盖量规每一个 id。',
    '',
    '量规:',
    formatRubric(rubric),
    '',
    `批改口径: ${modeLabel(mode)}模式。最终给分以你的仲裁为准;核验意见与重裁供参考,卷面事实优先。`,
    '输出格式与红笔打印契约:',
    '{"questions":[{"questionId":"q-1","score":25,"evidence":"…","comment":"…","deductions":[{"points":2,"reason":"…"}],"box":{"page":0,"x":0.1,"y":0.4,"w":0.35,"h":0.12}}]}',
    '- score 取值 [0, 该题满分];每题都给 box;主观题 comment 30 字以内;未得满分给 deductions。',
    '- 你的输出将作为本卷最终记分,并用于打印 PDF。',
  ].join('\n')
}

export function parseVerificationResponse(text: string): ExtremeVerification {
  let raw: unknown
  try {
    raw = parseJsonWithRepair(stripFence(text))
  } catch {
    return {
      passed: false,
      summary: '核验结果无法解析',
      issues: [{ reason: '核验子代理输出不是合法 JSON' }],
    }
  }
  if (!raw || typeof raw !== 'object') {
    return {
      passed: false,
      summary: '核验结果无法解析',
      issues: [{ reason: '核验子代理输出不是对象' }],
    }
  }
  const obj = raw as Record<string, unknown>
  const issues: Array<{ questionId?: string; reason: string }> = []
  if (Array.isArray(obj.issues)) {
    for (const it of obj.issues) {
      if (!it || typeof it !== 'object') continue
      const rec = it as Record<string, unknown>
      const reason = typeof rec.reason === 'string' ? rec.reason.trim() : ''
      if (!reason) continue
      const questionId = typeof rec.questionId === 'string' ? rec.questionId : undefined
      issues.push({ questionId, reason })
    }
  }
  const passed = obj.passed === true && issues.length === 0
  const summary = typeof obj.summary === 'string' ? obj.summary : undefined
  return { passed, summary, issues }
}

function stripFence(text: string): string {
  const trimmed = text.trim()
  const m = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return m ? m[1].trim() : trimmed
}

/** 两个核验都明确通过才算完全通过 */
export function bothVerificationsPassed(a: ExtremeVerification, b: ExtremeVerification): boolean {
  return a.passed && b.passed
}

function extractResult(message: AssistantMessage): {
  text: string
  usage?: { input: number; output: number; cacheRead?: number; cacheWrite?: number }
} {
  const text = (message.content ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
  const u = message.usage
  return {
    text,
    usage: u
      ? {
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead || undefined,
          cacheWrite: u.cacheWrite || undefined,
        }
      : undefined,
  }
}

function mergeUsage(
  acc: AiGradeResult['usage'] | undefined,
  next: AiGradeResult['usage'] | undefined,
): AiGradeResult['usage'] | undefined {
  if (!acc) return next
  if (!next) return acc
  const cacheRead = (acc.cacheRead ?? 0) + (next.cacheRead ?? 0)
  const cacheWrite = (acc.cacheWrite ?? 0) + (next.cacheWrite ?? 0)
  return {
    input: acc.input + next.input,
    output: acc.output + next.output,
    cacheRead: cacheRead > 0 ? cacheRead : undefined,
    cacheWrite: cacheWrite > 0 ? cacheWrite : undefined,
  }
}

function serializeGrade(result: { questions: AiQuestionResult[]; totalScore: number }): string {
  return JSON.stringify({
    totalScore: result.totalScore,
    questions: result.questions.map((q) => ({
      questionId: q.questionId,
      score: q.score,
      evidence: q.evidence,
      comment: q.comment,
      deductions: q.deductions,
      box: q.box,
      appliedMarks: q.appliedMarks,
    })),
  })
}

async function defaultLoadImages(
  taskId: string,
  files: GradingPaper['files'],
): Promise<ExtremeImagePart[]> {
  const parts: ExtremeImagePart[] = []
  for (const f of files) {
    const buf = await fsp.readFile(gradingService.paperFilePath(taskId, f.storedName))
    parts.push({ type: 'image', data: buf.toString('base64'), mimeType: f.mime })
  }
  return parts
}

async function runChildSession(opts: {
  label: string
  model: Model<Api>
  apiKey: string
  systemPrompt: string
  userText: string
  images: ExtremeImagePart[]
  signal: AbortSignal
  sessionId: string
  maxTokens: number
  cacheRetention: 'none' | 'short'
  complete: ExtremeComplete
}): Promise<{ text: string; usage?: AiGradeResult['usage'] }> {
  if (opts.signal.aborted) throw new Error('已中止')
  const messages: Message[] = [
    {
      role: 'user',
      content: [...opts.images, { type: 'text', text: opts.userText }] as Message['content'],
      timestamp: Date.now(),
    },
  ]
  const budgeted = applyExtremeContextBudget(opts.systemPrompt, messages)
  const assistant = await opts.complete(
    opts.model,
    { systemPrompt: budgeted.systemPrompt, messages: budgeted.messages },
    {
      apiKey: opts.apiKey,
      maxTokens: opts.maxTokens,
      signal: opts.signal,
      cacheRetention: opts.cacheRetention,
      sessionId: opts.sessionId,
    },
  )
  if (assistant.stopReason === 'aborted') throw new Error('已中止')
  const extracted = extractResult(assistant)
  if (!extracted.text.trim()) {
    throw new Error(`${opts.label}未返回内容`)
  }
  return extracted
}

/**
 * 极致 AI 模式批改一份试卷:视觉初评 → 两个核验子代理 → (未通过则)重裁 + 仲裁子代理。
 * 只有核验完全通过或仲裁完成后才返回可落库的给分。
 */
export async function gradePaperExtreme(opts: GradePaperExtremeOptions): Promise<AiGradeResult> {
  const { task, paperId, model, apiKey, signal, onStage } = opts
  const complete = opts.deps?.complete ?? completeGradingCall
  const loadImages = opts.deps?.loadImages ?? defaultLoadImages
  const paper = task.papers.find((p) => p.id === paperId)
  if (!paper) throw new Error(`试卷不存在: ${paperId}`)
  if (normalizeGradingStrategy(task.gradingStrategy) !== 'extreme') {
    // 允许被直接调用(测试或显式走本管线);策略字段仅作日志
    note('info', `极致 AI 管线被调用(任务策略=${String(task.gradingStrategy ?? 'unset')})`)
  }

  const images = await loadImages(task.id, paper.files)
  if (images.length === 0) throw new Error('试卷没有可批改的扫描件')
  const mode: GradingStrictness = task.gradingMode ?? 'normal'
  const maxTokens = fastGradeMaxTokens(task.rubric.length, model.maxTokens)
  const verifyMax = Math.min(4096, model.maxTokens || 4096)
  let usage: AiGradeResult['usage'] | undefined

  const stage = (label: string, index: number, total: number) => {
    onStage?.({ label, index, total })
  }

  // 最多:初评 + 核验1 + 核验2 + 重裁 + 仲裁
  const totalStages = 5
  stage('极致 AI · 视觉初评', 1, totalStages)
  const firstRaw = await runChildSession({
    label: '极致 AI 初评',
    model,
    apiKey,
    systemPrompt: buildExtremeGradePrompt(task.rubric, mode),
    userText: '请按量规、仅凭卷面视觉批改这份试卷。只输出 JSON。系统随后会派出两个子代理对齐核验。',
    images,
    signal,
    sessionId: `grading-extreme-grade:${task.id}:${paperId}`,
    maxTokens,
    cacheRetention: 'short',
    complete,
  })
  usage = mergeUsage(usage, firstRaw.usage)
  const first = parseGradeResponse(firstRaw.text, task.rubric)

  stage('极致 AI · 子代理核验 1', 2, totalStages)
  const v1Raw = await runChildSession({
    label: '核验子代理 1',
    model,
    apiKey,
    systemPrompt: buildExtremeVerifyPrompt(1, task.rubric),
    userText: `以下是初评结果,请对照卷面独立核验,只输出 JSON。\n${serializeGrade(first)}`,
    images,
    signal,
    sessionId: `grading-extreme-verify1:${task.id}:${paperId}`,
    maxTokens: verifyMax,
    cacheRetention: 'none',
    complete,
  })
  usage = mergeUsage(usage, v1Raw.usage)
  const v1 = parseVerificationResponse(v1Raw.text)

  stage('极致 AI · 子代理核验 2', 3, totalStages)
  const v2Raw = await runChildSession({
    label: '核验子代理 2',
    model,
    apiKey,
    systemPrompt: buildExtremeVerifyPrompt(2, task.rubric),
    userText: `以下是初评结果,请对照卷面独立核验,只输出 JSON。你是第二个核验子代理,须独立判断,不要参考另一个核验代理。\n${serializeGrade(first)}`,
    images,
    signal,
    sessionId: `grading-extreme-verify2:${task.id}:${paperId}`,
    maxTokens: verifyMax,
    cacheRetention: 'none',
    complete,
  })
  usage = mergeUsage(usage, v2Raw.usage)
  const v2 = parseVerificationResponse(v2Raw.text)

  const awardedBase = {
    model: { provider: model.provider, model: model.id },
    usage,
    finishedAt: new Date().toISOString(),
  }

  if (bothVerificationsPassed(v1, v2)) {
    note('info', `极致 AI 双核验通过: task=${task.id} paper=${paperId}`)
    return { questions: first.questions, totalScore: first.totalScore, ...awardedBase }
  }

  const issues = [...v1.issues, ...v2.issues]
  note(
    'info',
    `极致 AI 核验未完全通过,进入重裁+仲裁: task=${task.id} paper=${paperId} v1=${v1.passed} v2=${v2.passed} issues=${issues.length}`,
  )

  stage('极致 AI · 重裁', 4, totalStages)
  const regradeRaw = await runChildSession({
    label: '极致 AI 重裁',
    model,
    apiKey,
    systemPrompt: buildExtremeRegradePrompt(task.rubric, mode, issues),
    userText: '请根据卷面重新批改这份试卷。只输出完整 JSON。随后会由一个仲裁子代理裁定最终分数。',
    images,
    signal,
    sessionId: `grading-extreme-regrade:${task.id}:${paperId}`,
    maxTokens,
    cacheRetention: 'none',
    complete,
  })
  usage = mergeUsage(usage, regradeRaw.usage)
  const regrade = parseGradeResponse(regradeRaw.text, task.rubric)

  stage('极致 AI · 子代理仲裁', 5, totalStages)
  const arbRaw = await runChildSession({
    label: '仲裁子代理',
    model,
    apiKey,
    systemPrompt: buildExtremeArbitratePrompt(task.rubric, mode),
    userText: [
      '请综合以下材料与卷面,裁定最终给分,只输出 JSON。',
      `初评: ${serializeGrade(first)}`,
      `核验子代理1: ${JSON.stringify(v1)}`,
      `核验子代理2: ${JSON.stringify(v2)}`,
      `重裁: ${serializeGrade(regrade)}`,
    ].join('\n'),
    images,
    signal,
    sessionId: `grading-extreme-arbitrate:${task.id}:${paperId}`,
    maxTokens,
    cacheRetention: 'none',
    complete,
  })
  usage = mergeUsage(usage, arbRaw.usage)
  const awarded = parseGradeResponse(arbRaw.text, task.rubric)
  return {
    questions: awarded.questions,
    totalScore: awarded.totalScore,
    model: awardedBase.model,
    usage,
    finishedAt: new Date().toISOString(),
  }
}
