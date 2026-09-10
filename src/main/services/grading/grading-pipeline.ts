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
import { markScoreFromSelection, type StudentCandidate } from '@shared/grading-helpers'
import * as IPC from '@shared/ipc-channels'
import type {
  AiGradeResult,
  AiQuestionResult,
  GradeAnnotationBox,
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

/** 单份试卷批改的输出 token 上限(逐题 JSON + 依据,余量充足) */
const GRADING_MAX_TOKENS = 4096

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

/** 构造批改 system prompt: 量规 + 严格 JSON 契约 */
export function buildGradingPrompt(rubric: RubricQuestion[]): string {
  const rubricLines = rubric
    .map(
      (q) =>
        `- id: ${q.id} | 题目: ${q.title} | 满分: ${q.fullMark}${
          q.referenceAnswer ? ` | 评分标准: ${q.referenceAnswer.replace(/\s+/g, ' ').trim()}` : ''
        }${formatPresetMarks(q)}`,
    )
    .join('\n')
  const hasMarks = rubric.some((q) => (q.presetMarks?.length ?? 0) > 0)
  return [
    '你是严格且公正的阅卷教师。按量规逐题批改图片中的试卷，只输出 JSON，不要任何解释或多余文字。',
    '',
    '量规（每题独立给分）:',
    rubricLines,
    '',
    '输出格式（questions 数组必须覆盖量规中的每一个题目 id）:',
    hasMarks
      ? '{"questions":[{"questionId":"q-1","score":25,"marks":[0,1],"evidence":"依据：学生第4题答案与评分标准…","comment":"评语(可选)","box":{"page":0,"x":0.1,"y":0.4,"w":0.35,"h":0.12}}]}'
      : '{"questions":[{"questionId":"q-1","score":25,"evidence":"依据：学生第4题答案与评分标准…","comment":"评语(可选)","box":{"page":0,"x":0.1,"y":0.4,"w":0.35,"h":0.12}}]}',
    '规则:',
    '- score 为数字，取值 [0, 该题满分]，按评分标准的有效分给分，不要凭空加减',
    '- evidence 引用学生答卷的实际作答内容作为判分依据；字迹不清时保守给分并在 comment 说明',
    '- 全卷未作答的题 score 给 0 并在 comment 标注「未作答」',
    '- box: 该题在卷面图片上的位置。page 为图片序号(从 0 起); x/y/w/h 为相对该页宽高的比例,取值 [0,1]。扣分或有评语的题必须给 box,便于在卷面上叠字批注',
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
    { systemPrompt: buildGradingPrompt(task.rubric), messages },
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
