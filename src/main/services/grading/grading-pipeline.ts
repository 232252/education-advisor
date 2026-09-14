// =============================================================
// Grading Pipeline — AI 批改执行管线
// 每份试卷一次视觉模型调用: 量规(题目/满分/评分标准)进 system prompt,
// 试卷扫描件(图片)以 ImageContent 直接送入,要求严格 JSON 输出,
// 解析+修复+越界钳制后经 gradingService.saveAiResult 落库。
// 进度经 IPC_GRADING_PROGRESS 推渲染层;per-task AbortController 中止。
// 纯函数(prompt 构造/解析/模型解析)单独导出以便测试。
// =============================================================

import fsp from 'node:fs/promises'
import { parseJsonWithRepair } from '@earendil-works/pi-ai'
import {
  type Api,
  type AssistantMessage,
  completeSimple,
  getEnvApiKey,
  type Message,
  type Model,
} from '@earendil-works/pi-ai/compat'
import {
  markScoreFromSelection,
  questionKind,
  type StudentCandidate,
} from '@shared/grading-helpers'
import * as IPC from '@shared/ipc-channels'
import type {
  AiGradeResult,
  AiQuestionResult,
  GradeAnnotationBox,
  GradingPaper,
  GradingStrictness,
  GradingTask,
  RubricQuestion,
  UnifiedSettings,
} from '@shared/types'
import type { BrowserWindow } from 'electron'
import { invalidateOnExamsWrite, invalidateOnGradesWrite } from '../../ipc/academic/cache'
import { sendToRenderer } from '../../ipc/broadcast'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import { keystoreService } from '../keystore-service'
import { KEYLESS_PROVIDERS } from '../ollama/constants'
import { resolveModel } from '../pi-ai/model-utils'
import { settingsService } from '../settings-service'
import { gradingService } from './grading-service'

/** 单份试卷批改的输出 token 上限(逐题 JSON+box+批注;每题都出 box 后上调) */
const GRADING_MAX_TOKENS = 8192

/** 批改进度事件负载(主→渲染) */
export interface GradingProgressPayload {
  taskId: string
  phase: 'start' | 'identify' | 'graded' | 'failed' | 'done'
  /** 当前/刚完成的试卷 */
  paperId?: string
  studentName?: string
  index?: number
  total?: number
  /** phase=graded: 本份得分; phase=failed: 错误; phase=done: 汇总 */
  score?: number
  error?: string
  gradedCount?: number
  failedCount?: number
  aborted?: boolean
}

// ===== 纯函数(测试覆盖) =====

/** 模型是否接受图像输入 */
export function isVisionModel(model: Model<Api>): boolean {
  return Array.isArray(model.input) && model.input.includes('image')
}

/**
 * 解析批改用的 provider/model:
 * settings.grading 显式配置优先;否则跟随 高质量模型 → 默认模型。
 */
export function resolveGradingModelIds(settings: Pick<UnifiedSettings, 'grading' | 'models'>): {
  providerId: string
  modelId: string
} {
  if (settings.grading?.provider && settings.grading?.model) {
    return { providerId: settings.grading.provider, modelId: settings.grading.model }
  }
  const m = settings.models
  return {
    providerId: m.defaultProvider,
    modelId: m.highQualityModel || m.defaultModel,
  }
}

function formatPresetMarks(q: RubricQuestion): string {
  const marks = q.presetMarks ?? []
  if (marks.length === 0) return ''
  const items = marks
    .map((m, i) => {
      const pts = m.points > 0 ? `+${m.points}` : String(m.points)
      return `[${i}] ${m.note.replace(/\s+/g, ' ').trim()} (${pts})`
    })
    .join('；')
  return ` | 评分点: ${items}`
}

/** 合法批改口径 */
const GRADING_MODES: GradingStrictness[] = ['strict', 'normal', 'lenient']

/** 口径名(日志/错误信息用) */
export function gradingModeLabel(mode: GradingStrictness): string {
  return mode === 'strict' ? '严格' : mode === 'lenient' ? '宽松' : '正常'
}

/** 三档批改口径的给分松紧规则(注入 prompt;normal 为基线,不另加松紧条目) */
const MODE_RULES: Record<GradingStrictness, string[]> = {
  strict: [
    '按评分标准逐点从严核对: 步骤缺失/跳步、符号或单位错误、表述不严谨、未化简到要求形式,每处都按评分点扣分',
    '结果正确但过程不完整的,只给结果对应的部分分,过程分不给',
    '字迹或表述不清的按未达标处理,保守给分,不做善意解读',
    '同一处错误在本题与后续题中重复传导的,后续题同样扣分(不重复豁免)',
  ],
  normal: [
    '按评分标准常规给分: 对给分、错扣分,过程分与结果分按标准划分,字迹不清时保守给分并在 comment 说明',
  ],
  lenient: [
    '思路和方法正确、结果正确即给该题绝大部分分数: 笔误、漏写单位、誊抄错误等小瑕疵每处最多扣 1 分',
    '结果错误但公式与思路正确的,给过程分为主,不因结果错全扣',
    '字迹不清时按最合理解读给分,不因卷面潦草减分',
    '给分处于两档之间时,向有利于学生的方向裁量,并在 comment 点出可改进处',
  ],
}

/** 构造批改 system prompt: 量规 + 批改口径 + 严格 JSON 契约(红笔痕迹口径) */
export function buildGradingPrompt(
  rubric: RubricQuestion[],
  mode: GradingStrictness = 'normal',
): string {
  // 历史任务/手改 JSON 可能缺字段或带非法值 — 一律回落正常口径
  const m: GradingStrictness = GRADING_MODES.includes(mode) ? mode : 'normal'
  const rubricLines = rubric
    .map(
      (q) =>
        `- id: ${q.id} | 题目: ${q.title} | 题类: ${
          questionKind(q) === 'objective' ? '客观' : '主观'
        } | 满分: ${q.fullMark}${
          q.referenceAnswer ? ` | 评分标准: ${q.referenceAnswer.replace(/\s+/g, ' ').trim()}` : ''
        }${formatPresetMarks(q)}`,
    )
    .join('\n')
  const hasMarks = rubric.some((q) => (q.presetMarks?.length ?? 0) > 0)
  return [
    '你是严格且公正的阅卷教师。按量规逐题批改图片中的试卷。',
    '只输出一个 JSON 对象，不要解释、不要 markdown、不要在 JSON 前后加字。',
    '',
    '量规（每题独立给分）:',
    rubricLines,
    '',
    `批改口径: ${gradingModeLabel(m)}模式`,
    ...MODE_RULES[m],
    '',
    '输出格式（questions 必须覆盖量规每一个 id）:',
    hasMarks
      ? '{"questions":[{"questionId":"q-1","score":25,"marks":[0,1],"evidence":"依据：学生第4题答案与评分标准…","comment":"评语(可选)","deductions":[{"points":2,"reason":"单位未换算"}],"box":{"page":0,"x":0.1,"y":0.4,"w":0.35,"h":0.12}}]}'
      : '{"questions":[{"questionId":"q-1","score":25,"evidence":"依据：学生第4题答案与评分标准…","comment":"评语(可选)","deductions":[{"points":2,"reason":"单位未换算"}],"box":{"page":0,"x":0.1,"y":0.4,"w":0.35,"h":0.12}}]}',
    '规则:',
    '- score 为数字，取值 [0, 该题满分]，按评分标准的有效分给分，不要凭空加减',
    '- evidence 写一句即可，引用学生卷面实际作答；字迹不清时保守给分并在 comment 说明',
    '- 全卷未作答的题 score 给 0 并在 comment 标注「未作答」',
    '- comment 像老师的红笔批注: 仅主观题(简答/计算/作文等)填写，30 字以内，面向学生，写清错因或给一句鼓励；客观题(选择/填空/判断)不要写 comment',
    '- deductions 扣分说明: 凡 score < 满分的题都要给，逐项列出扣分点；points 为该处扣掉的分数(正数，所有项合计 ≈ 满分 - score)，reason 一句话写清扣分原因(20 字以内，面向学生)；全对的题不要给 deductions',
    '- box 每题都要给: 框住该题作答区域，全对的题也要给（打勾定位用）；宽高宁小勿大，不要把相邻题目的作答一起框进来',
    '- box: page 从 0 起; x/y/w/h 为相对页宽高的 0–1。不确定位置也给个大概，不要省略',
    ...(hasMarks
      ? [
          '- 有评分点的题目: marks 填选中的评分点序号(可多选); score 必须等于 满分+所选评分点分值之和(钳制到[0,满分])',
        ]
      : []),
    '- 只输出上述 JSON，不要 markdown 代码块标记',
  ].join('\n')
}

/**
 * 解析模型返回的 JSON 为逐题结果:
 * 剥代码围栏 → JSON.parse → 截取首尾大括号重试(散文包裹) → 修复解析(截断/尾逗号);
 * 未知题目丢弃、越界分数钳制到 [0, 满分]；
 * 至少需一个有效题目，否则抛错(触发该份试卷失败路径)。
 */
export function parseGradeResponse(
  text: string,
  rubric: RubricQuestion[],
): { questions: AiQuestionResult[]; totalScore: number } {
  const rubricById = new Map(rubric.map((q) => [q.id, q]))
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  // 模型偶尔在 JSON 前后加说明文字 — 截取首个 { 到最后一个 } 之间的片段
  const braceStart = stripped.indexOf('{')
  const braceEnd = stripped.lastIndexOf('}')
  const candidates =
    braceStart >= 0 && braceEnd > braceStart
      ? [stripped, stripped.slice(braceStart, braceEnd + 1)]
      : [stripped]
  let parsed: unknown
  let parsedOk = false
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate)
      parsedOk = true
      break
    } catch {
      // 继续尝试下一个候选
    }
  }
  if (!parsedOk) {
    // 最后手段: 修复解析(截断/尾逗号等);仍失败按无有效输出处理
    try {
      parsed = parseJsonWithRepair(candidates[candidates.length - 1])
    } catch {
      throw new Error('批改输出不是有效 JSON')
    }
  }
  const rawQuestions = (parsed as { questions?: unknown })?.questions
  if (!Array.isArray(rawQuestions)) {
    throw new Error('批改输出缺少 questions 数组')
  }
  const questions: AiQuestionResult[] = []
  for (const raw of rawQuestions) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const questionId = typeof r.questionId === 'string' ? r.questionId : ''
    const qdef = rubricById.get(questionId)
    if (!qdef) continue // 未知题目: 丢弃
    const full = qdef.fullMark
    const preset = qdef.presetMarks ?? []
    const appliedMarks = Array.isArray(r.marks)
      ? [
          ...new Set(
            r.marks
              .map((x) => Number(x))
              .filter((i) => Number.isInteger(i) && i >= 0 && i < preset.length),
          ),
        ].sort((a, b) => a - b)
      : []
    let score = Number(r.score)
    if (appliedMarks.length > 0 && preset.length > 0) {
      score = markScoreFromSelection(full, preset, appliedMarks)
    } else if (!Number.isFinite(score)) {
      continue
    } else {
      score = Math.min(Math.max(score, 0), full) // 钳制到 [0, 满分]
    }
    questions.push({
      questionId,
      score,
      evidence: typeof r.evidence === 'string' ? r.evidence : undefined,
      comment: typeof r.comment === 'string' ? r.comment : undefined,
      appliedMarks: appliedMarks.length > 0 ? appliedMarks : undefined,
      box: parseAnnotationBox(r.box),
      deductions: parseDeductions(r.deductions, full, score),
    })
  }
  if (questions.length === 0) {
    throw new Error('批改输出没有可识别的题目得分')
  }
  // 同题多次出现以最后一次为准(防模型重复输出)
  const dedup = new Map(questions.map((q) => [q.questionId, q]))
  const finalQuestions = [...dedup.values()]
  return {
    questions: finalQuestions,
    totalScore: finalQuestions.reduce((sum, q) => sum + q.score, 0),
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/**
 * 解析扣分说明: points 取绝对值(模型偶给负数)、钳到 (0, 满分],
 * reason 非空裁 60 字,最多 8 项;满分题不保留(无扣分可述)。
 * 合计与 满分-score 不一致时不修正 — score 是权威值,扣分项仅作解释。
 */
export function parseDeductions(
  raw: unknown,
  fullMark: number,
  score: number,
): AiQuestionResult['deductions'] {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<AiQuestionResult['deductions']> = []
  for (const item of raw.slice(0, 8)) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const pts = Math.abs(Number(o.points))
    const reason = typeof o.reason === 'string' ? o.reason.trim() : ''
    if (!Number.isFinite(pts) || pts <= 0 || reason.length === 0) continue
    out.push({
      points: Math.min(Math.round(pts * 100) / 100, fullMark),
      reason: reason.slice(0, 60),
    })
  }
  if (out.length === 0 || score >= fullMark) return undefined
  return out
}

/** 解析卷面批注框;缺字段/非数字则丢弃(评语仍在右侧展示) */
export function parseAnnotationBox(raw: unknown): GradeAnnotationBox | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const o = raw as Record<string, unknown>
  const page = Number(o.page)
  const x = Number(o.x)
  const y = Number(o.y)
  const w = Number(o.w)
  const h = Number(o.h)
  if (![page, x, y, w, h].every(Number.isFinite)) return undefined
  if (!Number.isInteger(page) || page < 0 || page > 32) return undefined
  if (w <= 0 || h <= 0) return undefined
  return { page, x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) }
}

/** 从 AssistantMessage 抽取文本与用量 */
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

/** 读取试卷扫描件为 ImageContent parts */
async function buildPaperImages(taskId: string, files: GradingTask['papers'][number]['files']) {
  const parts: Array<{ type: 'image'; data: string; mimeType: string }> = []
  for (const f of files) {
    const buf = await fsp.readFile(gradingService.paperFilePath(taskId, f.storedName))
    parts.push({ type: 'image', data: buf.toString('base64'), mimeType: f.mime })
  }
  return parts
}

// ===== 编排(有状态) =====

/** 进行中的批改作业(per-task 中止句柄) */
const activeRuns = new Map<string, AbortController>()

function pushProgress(win: BrowserWindow | null, payload: GradingProgressPayload): void {
  sendToRenderer(win, IPC.IPC_GRADING_PROGRESS, payload)
}

/** 解析 provider 的 API key(keyless 本地 provider 给哨兵值);样卷识别等旁路复用 */
export function apiKeyFor(providerId: string): string | undefined {
  if (KEYLESS_PROVIDERS.has(providerId)) return 'local-no-key-needed'
  return keystoreService.getApiKey(providerId) ?? (getEnvApiKey(providerId) || undefined)
}

/** 单份试卷批改(一次视觉调用) */
async function gradePaperOnce(
  task: GradingTask,
  paperId: string,
  model: Model<Api>,
  apiKey: string,
  signal: AbortSignal,
): Promise<AiGradeResult> {
  const paper = task.papers.find((p) => p.id === paperId)
  if (!paper) throw new Error(`试卷不存在: ${paperId}`)
  const images = await buildPaperImages(task.id, paper.files)
  const messages: Message[] = [
    {
      role: 'user',
      content: [...images, { type: 'text', text: '请按量规批改这份试卷，只输出 JSON。' }],
      timestamp: Date.now(),
    },
  ]
  const assistant = await completeSimple(
    model,
    {
      systemPrompt: buildGradingPrompt(task.rubric, task.gradingMode ?? 'normal'),
      messages,
    },
    {
      apiKey,
      maxTokens: GRADING_MAX_TOKENS,
      signal,
      // 同一任务量规不变: 打开短缓存,整班 50–60 份时后续请求应大量 cacheRead
      cacheRetention: 'short',
      sessionId: `grading:${task.id}`,
    },
  )
  if (assistant.stopReason === 'aborted') throw new Error('已中止')
  const { text, usage } = extractResult(assistant)
  const { questions, totalScore } = parseGradeResponse(text, task.rubric)
  return {
    questions,
    totalScore,
    model: { provider: model.provider, model: model.id },
    usage,
    finishedAt: new Date().toISOString(),
  }
}

/**
 * 启动整批 AI 批改(异步作业,立即返回):
 * ready|review → grading → (可选)卷面归组 → 逐份 pending/failed 试卷 → review。
 * 失败试卷记录 error,可再次 run(仅重试 failed/pending)。
 * 识别与批改都在作业内执行,invoke 只做同步校验;进度经 grading:progress,可 abort。
 */
export async function startGrading(
  taskId: string,
  win: BrowserWindow | null,
  roster: StudentCandidate[] = [],
  opts?: { autoPublish?: boolean },
): Promise<void> {
  if (activeRuns.has(taskId)) {
    throw new Error('该任务已在批改中')
  }
  const task = await gradingService.getTask(taskId)
  if (task.status !== 'ready' && task.status !== 'review') {
    throw new Error(`任务状态 ${task.status} 不能开始批改(需先标记就绪)`)
  }
  if (task.rubric.length === 0) {
    throw new Error('量规为空,请先录入题目与评分标准')
  }
  const unassigned = task.papers.filter((p) => p.studentName === null)
  const pendingNow = task.papers.filter(
    (p) => p.studentName !== null && (p.status === 'pending' || p.status === 'failed'),
  )
  const willIdentify = unassigned.length > 0 && roster.length > 0
  if (pendingNow.length === 0 && !willIdentify) {
    throw new Error('没有待批改的试卷(请先归组,或保证卷面姓名在班级名单中能唯一对上)')
  }

  // 模型与鉴权(同步失败直接抛给调用方,任务不进入 grading 态)
  const ids = resolveGradingModelIds(settingsService.getSettings())
  const model = resolveModel(ids.providerId, ids.modelId)
  if (!model) {
    throw new Error(`批改模型不存在: ${ids.providerId}/${ids.modelId}(请在设置→模型中配置)`)
  }
  if (!isVisionModel(model)) {
    throw new Error(`模型 ${model.id} 不支持图像输入,请在设置→模型中选择视觉模型批改`)
  }
  const apiKey = apiKeyFor(ids.providerId)
  if (!apiKey) {
    throw new Error(`Provider ${ids.providerId} 未配置 API Key`)
  }

  await gradingService.setStatus(taskId, 'grading')
  const controller = new AbortController()
  activeRuns.set(taskId, controller)
  log(
    'info',
    'grading',
    `grading started: ${taskId} (pending=${pendingNow.length} identify=${willIdentify ? unassigned.length : 0}, ${model.provider}/${model.id})`,
  )

  // 异步作业: 不 await,完成/失败经进度事件与任务状态体现
  void (async () => {
    let gradedCount = 0
    let failedCount = 0
    let aborted = false
    let cacheRead = 0
    let cacheWrite = 0
    let inputTokens = 0
    let targets = pendingNow
    try {
      if (willIdentify) {
        const { identifyUnassignedPapers } = await import('./identify-papers')
        try {
          await identifyUnassignedPapers(taskId, roster, {
            signal: controller.signal,
            allowWhileGrading: true,
            onProgress: (p) => {
              pushProgress(win, {
                taskId,
                phase: 'identify',
                paperId: p.paperId,
                index: p.index,
                total: p.total,
              })
            },
          })
        } catch (err) {
          log('warn', 'grading', `identify failed: ${taskId}: ${errText(err)}`)
        }
        if (controller.signal.aborted) {
          aborted = true
        } else {
          const latest = await gradingService.getTask(taskId)
          targets = latest.papers.filter(
            (p) => p.studentName !== null && (p.status === 'pending' || p.status === 'failed'),
          )
        }
      }

      if (!aborted) {
        const taskForGrade = await gradingService.getTask(taskId)
        for (const [i, paper] of targets.entries()) {
          if (controller.signal.aborted) {
            aborted = true
            break
          }
          pushProgress(win, {
            taskId,
            phase: 'start',
            paperId: paper.id,
            studentName: paper.studentName ?? undefined,
            index: i + 1,
            total: targets.length,
          })
          try {
            const result = await gradePaperOnce(
              taskForGrade,
              paper.id,
              model,
              apiKey,
              controller.signal,
            )
            await gradingService.saveAiResult(taskId, paper.id, result)
            gradedCount++
            inputTokens += result.usage?.input ?? 0
            cacheRead += result.usage?.cacheRead ?? 0
            cacheWrite += result.usage?.cacheWrite ?? 0
            pushProgress(win, {
              taskId,
              phase: 'graded',
              paperId: paper.id,
              studentName: paper.studentName ?? undefined,
              index: i + 1,
              total: targets.length,
              score: result.totalScore,
            })
          } catch (err) {
            if (controller.signal.aborted) {
              aborted = true
              break
            }
            failedCount++
            const message = errText(err)
            await gradingService.savePaperError(taskId, paper.id, message)
            log('warn', 'grading', `paper failed: ${taskId}/${paper.id}: ${message}`)
            pushProgress(win, {
              taskId,
              phase: 'failed',
              paperId: paper.id,
              studentName: paper.studentName ?? undefined,
              index: i + 1,
              total: targets.length,
              error: message,
            })
          }
        }
      }
    } finally {
      activeRuns.delete(taskId)
      // 终态: 中止且无任何成功 → 回 ready; 识别后仍无试卷 → 回 ready; 否则进 review 复核
      try {
        if (
          (aborted && gradedCount === 0) ||
          (gradedCount === 0 && failedCount === 0 && targets.length === 0)
        ) {
          await gradingService.setStatus(taskId, 'ready')
        } else {
          await gradingService.setStatus(taskId, 'review')
          if (opts?.autoPublish && gradedCount > 0 && !aborted) {
            try {
              const published = await gradingService.publishTask(taskId)
              invalidateOnExamsWrite()
              invalidateOnGradesWrite(
                published.task.papers.map((p) => p.studentName ?? '').filter((n) => n.length > 0),
              )
              log(
                'info',
                'grading',
                `auto-published: ${taskId} (published=${published.published} skipped=${published.skipped.length})`,
              )
            } catch (err) {
              log('warn', 'grading', `auto-publish failed: ${taskId}: ${errText(err)}`)
            }
          }
        }
      } catch (err) {
        log('error', 'grading', `setStatus after grading failed: ${errText(err)}`)
      }
      pushProgress(win, {
        taskId,
        phase: 'done',
        total: targets.length,
        gradedCount,
        failedCount,
        aborted,
      })
      log(
        'info',
        'grading',
        `grading finished: ${taskId} (graded=${gradedCount} failed=${failedCount} aborted=${aborted} input=${inputTokens} cacheRead=${cacheRead} cacheWrite=${cacheWrite})`,
      )
    }
  })()
}

/** 中止指定任务的批改作业(进行中的那一份请求被 abort,已完成的结果保留) */
export function abortGrading(taskId: string): boolean {
  const controller = activeRuns.get(taskId)
  if (!controller) return false
  controller.abort()
  return true
}

/** 任务是否正在批改 */
export function isGradingActive(taskId: string): boolean {
  return activeRuns.has(taskId)
}

/**
 * 重改: 对指定试卷重新跑一次 AI 批改(覆盖上次结果与复核)。
 * 异步作业,与 startGrading 共用 activeRuns/进度通道/中止;结束回 review 态
 * (published 任务重改后需重新发布才进学业分析)。
 */
export async function regradePapers(
  taskId: string,
  paperIds: string[],
  win: BrowserWindow | null,
): Promise<void> {
  if (activeRuns.has(taskId)) throw new Error('该任务已在批改中')
  const ids = [...new Set(paperIds)].filter((id) => typeof id === 'string' && id.length > 0)
  if (ids.length === 0) throw new Error('没有要重改的试卷')
  const task = await gradingService.getTask(taskId)
  if (task.status === 'grading') throw new Error('任务正在批改中,不能重改')
  if (task.rubric.length === 0) throw new Error('量规为空,无法重改')

  // 模型与鉴权(同步失败直接抛,不改任务状态)
  const config = resolveGradingModelIds(settingsService.getSettings())
  const model = resolveModel(config.providerId, config.modelId)
  if (!model) {
    throw new Error(`批改模型不存在: ${config.providerId}/${config.modelId}(请在设置→模型中配置)`)
  }
  if (!isVisionModel(model)) {
    throw new Error(`模型 ${model.id} 不支持图像输入,请在设置→模型中选择视觉模型批改`)
  }
  const apiKey = apiKeyFor(config.providerId)
  if (!apiKey) throw new Error(`Provider ${config.providerId} 未配置 API Key`)

  // 重置前快照旧结果: 重改失败/中止时回滚,不因一次模型抽风丢掉旧分数与复核
  const snapshots = new Map<
    string,
    {
      ai: GradingPaper['ai']
      review: GradingPaper['review']
      error?: string
      status: GradingPaper['status']
    }
  >()
  for (const paperId of ids) {
    const paper = task.papers.find((p) => p.id === paperId)
    if (!paper) throw new Error(`试卷不存在: ${paperId}`)
    snapshots.set(paperId, {
      ai: paper.ai,
      review: paper.review,
      error: paper.error,
      status: paper.status,
    })
  }
  // 重置在状态迁移前逐份完成(无扫描件等校验失败直接抛,不进作业)
  for (const paperId of ids) {
    await gradingService.resetPaperForRegrade(taskId, paperId)
  }
  await gradingService.setStatus(taskId, 'grading')
  const controller = new AbortController()
  activeRuns.set(taskId, controller)
  log('info', 'grading', `regrade started: ${taskId} (papers=${ids.length})`)

  /** 回滚一份卷: 保留旧 ai/复核;本轮有新错误则标 failed 留错误信息,否则恢复原状态 */
  const rollbackPaper = async (paperId: string, newError?: string) => {
    const snap = snapshots.get(paperId)
    if (!snap) return
    try {
      await gradingService.applyPaperSnapshot(taskId, paperId, {
        ai: snap.ai,
        review: snap.review,
        error: newError ?? snap.error,
        status: newError ? 'failed' : snap.status,
      })
    } catch (err) {
      log('error', 'grading', `regrade rollback failed: ${taskId}/${paperId}: ${errText(err)}`)
    }
  }

  void (async () => {
    let gradedCount = 0
    let failedCount = 0
    let aborted = false
    try {
      const taskForGrade = await gradingService.getTask(taskId)
      for (const [i, paperId] of ids.entries()) {
        if (controller.signal.aborted) {
          aborted = true
          break
        }
        const paper = taskForGrade.papers.find((p) => p.id === paperId)
        pushProgress(win, {
          taskId,
          phase: 'start',
          paperId,
          studentName: paper?.studentName ?? undefined,
          index: i + 1,
          total: ids.length,
        })
        try {
          // 重试一次: 小模型偶发空输出/非 JSON(实测 0.5s 瞬时失败),重试通常即过
          let result: Awaited<ReturnType<typeof gradePaperOnce>> | null = null
          let lastErr: unknown = null
          for (let attempt = 0; attempt < 2 && !controller.signal.aborted; attempt++) {
            try {
              result = await gradePaperOnce(taskForGrade, paperId, model, apiKey, controller.signal)
              break
            } catch (err) {
              lastErr = err
              if (controller.signal.aborted) throw err
            }
          }
          if (!result) throw lastErr ?? new Error('批改未产出结果')
          await gradingService.saveAiResult(taskId, paperId, result)
          gradedCount++
          pushProgress(win, {
            taskId,
            phase: 'graded',
            paperId,
            studentName: paper?.studentName ?? undefined,
            index: i + 1,
            total: ids.length,
            score: result.totalScore,
          })
        } catch (err) {
          if (controller.signal.aborted) {
            aborted = true
            break
          }
          failedCount++
          const message = errText(err)
          await rollbackPaper(paperId, message)
          log('warn', 'grading', `regrade paper failed: ${taskId}/${paperId}: ${message}`)
          pushProgress(win, {
            taskId,
            phase: 'failed',
            paperId,
            studentName: paper?.studentName ?? undefined,
            index: i + 1,
            total: ids.length,
            error: message,
          })
        }
      }
      if (aborted) {
        // 未轮到的卷恢复重改前原状
        for (const paperId of ids.slice(gradedCount + failedCount)) {
          await rollbackPaper(paperId)
        }
      }
    } finally {
      activeRuns.delete(taskId)
      try {
        // 回 review(中止/失败也如此): 回滚的卷保留旧结果可复核,已发布的重新发布
        await gradingService.setStatus(taskId, 'review')
      } catch (err) {
        log('error', 'grading', `setStatus after regrade failed: ${taskId}: ${errText(err)}`)
      }
      pushProgress(win, {
        taskId,
        phase: 'done',
        total: ids.length,
        gradedCount,
        failedCount,
        aborted,
      })
      log(
        'info',
        'grading',
        `regrade finished: ${taskId} (graded=${gradedCount} failed=${failedCount} aborted=${aborted})`,
      )
    }
  })()
}
