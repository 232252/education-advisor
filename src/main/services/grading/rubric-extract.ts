// =============================================================
// Rubric Extract — 量规「从样卷识别」: 视觉模型抽取题目结构
// 批改管线(grading-pipeline)的旁路: 复用同一套批改模型配置与鉴权,
// 但无状态——样卷图片只读不拷贝(不进 grading/files/),不需要 taskId,
// 新建任务弹窗(任务尚不存在)也能用;结果返回后即弃,由教师校对。
// 纯函数(prompt 构造/解析)单独导出以便测试。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { parseJsonWithRepair } from '@earendil-works/pi-ai'
import {
  type Api,
  type AssistantMessage,
  completeSimple,
  type Message,
  type Model,
} from '@earendil-works/pi-ai/compat'
import type { ExtractedRubricQuestion } from '@shared/api/grading'
import { log } from '../../utils/logger'
import { resolveModel } from '../pi-ai/model-utils'
import { settingsService } from '../settings-service'
import { apiKeyFor, isVisionModel, resolveGradingModelIds } from './grading-pipeline'

/** 题目+参考答案草稿的输出比单份批改长,上限放大一倍;实际按模型上限钳制 */
const EXTRACT_MAX_TOKENS = 8192
/** 单次识别最多张数(防 token 爆炸;样卷通常 1~4 页) */
const MAX_EXTRACT_IMAGES = 8
/** 与 grading-service.ALLOWED_IMAGE_EXTS 同值(其为私有,不跨文件导出) */
const ALLOWED_EXTRACT_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
/** 与 grading-service.MAX_FILE_BYTES 同值(其为私有,不跨文件导出) */
const MAX_EXTRACT_FILE_BYTES = 25 * 1024 * 1024

/** MIME 由扩展名推导(白名单已保证;与 grading-service.mimeFromExt 同逻辑) */
function mimeFromExt(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'image/jpeg'
  }
}

// ===== 纯函数(测试覆盖) =====

/** 构造样卷识别 system prompt: 拆题粒度 + 分值/参考答案规则 + 严格 JSON 契约 */
export function buildRubricExtractPrompt(): string {
  return [
    '你是试卷结构识别助手。从样卷照片中提取试卷的题目结构，只输出 JSON，不要任何解释或多余文字。',
    '',
    '拆题规则:',
    '- 按卷面最高层级题号拆题（「一、二、三」或「1、2、3」），大题内的小题不单独拆条，把小题说明并入题名或参考答案',
    '- 跨页的同一道题合并为一条',
    '- 只提取题目结构与参考答案，不要抄录任何学生的手写作答',
    '',
    '每题字段:',
    '- title: 题号与题干摘要（如「一、选择题（每小题 5 分，共 10 小题）」）',
    '- type: 题类。"objective"=客观（选择/判断/填空/连线），"subjective"=主观（简答/计算/解答/作文/论述/实验）',
    '- fullMark: 该题满分，数字。卷面有标注按标注；「每小题 x 分共 n 小题」自行相乘求和；无标注时按题型合理估计',
    '- referenceAnswer: 若照片中有参考答案或评分标准则照录；没有则给出该题的答题要点草稿，并在末尾加上「（AI 草稿，请核对后删此标注）」',
    '',
    '输出格式:',
    '{"questions":[{"title":"一、选择题（每小题 5 分，共 10 小题）","type":"objective","fullMark":50,"referenceAnswer":"…"}]}',
    '- 只输出上述 JSON，不要 markdown 代码块标记',
  ].join('\n')
}

/**
 * 解析模型返回的 JSON 为量规题草稿:
 * 剥代码围栏 → JSON.parse → 截取首尾大括号重试(散文包裹) → 修复解析(截断/尾逗号);
 * title 空白/非字符串丢弃、同名去重保留首个、fullMark 非法默认 10 并钳制 ≤1000;
 * 至少需一个有效题目,否则抛错。
 */
export function parseRubricExtractResponse(text: string): ExtractedRubricQuestion[] {
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
      throw new Error('识别输出不是有效 JSON')
    }
  }
  const rawQuestions = (parsed as { questions?: unknown })?.questions
  if (!Array.isArray(rawQuestions)) {
    throw new Error('识别输出缺少 questions 数组')
  }
  const seenTitles = new Set<string>()
  const questions: ExtractedRubricQuestion[] = []
  for (const raw of rawQuestions) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title.trim() : ''
    if (title.length === 0) continue
    if (seenTitles.has(title)) continue // 同名题去重(防模型重复输出),保留首个
    seenTitles.add(title)
    let fullMark = Number(r.fullMark)
    if (!Number.isFinite(fullMark) || fullMark <= 0) fullMark = 10 // 与「添加题目」默认一致
    fullMark = Math.min(fullMark, 1000)
    // 题类白名单校验;非法值丢弃(渲染层 questionKind 会按标题推导兜底)
    const type: ExtractedRubricQuestion['type'] =
      r.type === 'objective' || r.type === 'subjective' ? r.type : undefined
    const referenceAnswer =
      typeof r.referenceAnswer === 'string' && r.referenceAnswer.trim().length > 0
        ? r.referenceAnswer.trim()
        : undefined
    questions.push({ title, fullMark, type, referenceAnswer })
  }
  if (questions.length === 0) {
    throw new Error('未识别出题目')
  }
  return questions
}

// ===== 编排(有状态) =====

/** 从 AssistantMessage 抽取文本(与 grading-pipeline.extractResult 同逻辑的精简版) */
function extractText(message: AssistantMessage): string {
  return (message.content ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

/**
 * 样卷照片 → 量规题草稿(一次视觉模型调用):
 * 校验(格式/大小/张数) → 读图 base64 → completeSimple → 解析。
 * 抛出的错误经 IPC 信封返回,由 RubricEditor 内联展示。
 */
export async function extractRubricFromImages(paths: string[]): Promise<ExtractedRubricQuestion[]> {
  if (paths.length === 0) throw new Error('未选择样卷图片')
  if (paths.length > MAX_EXTRACT_IMAGES) {
    throw new Error(`样卷照片最多 ${MAX_EXTRACT_IMAGES} 张`)
  }
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = []
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase()
    if (!ALLOWED_EXTRACT_EXTS.has(ext)) {
      throw new Error(`不支持的图片格式: ${path.basename(p)}`)
    }
    // IO 错误转可读提示,不把 ENOENT 等原始系统错误漏给教师
    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(p)
    } catch {
      throw new Error(`样卷图片不存在或无法访问: ${path.basename(p)}`)
    }
    if (!stat.isFile()) throw new Error(`不是文件: ${path.basename(p)}`)
    if (stat.size > MAX_EXTRACT_FILE_BYTES) {
      throw new Error(
        `文件超过 ${MAX_EXTRACT_FILE_BYTES / 1024 / 1024}MB 上限: ${path.basename(p)}`,
      )
    }
    let buf: Buffer
    try {
      buf = await fsp.readFile(p)
    } catch {
      throw new Error(`无法读取样卷图片: ${path.basename(p)}`)
    }
    images.push({ type: 'image', data: buf.toString('base64'), mimeType: mimeFromExt(ext) })
  }

  // 模型与鉴权(与批改同一套配置;同步失败直接抛给调用方)
  const ids = resolveGradingModelIds(settingsService.getSettings())
  const model: Model<Api> | undefined = resolveModel(ids.providerId, ids.modelId)
  if (!model) {
    throw new Error(`批改模型不存在: ${ids.providerId}/${ids.modelId}(请在设置→模型中配置)`)
  }
  if (!isVisionModel(model)) {
    throw new Error(`模型 ${model.id} 不支持图像输入,请在设置→模型中选择视觉模型`)
  }
  const apiKey = apiKeyFor(ids.providerId)
  if (!apiKey) {
    throw new Error(`Provider ${ids.providerId} 未配置 API Key`)
  }

  const messages: Message[] = [
    {
      role: 'user',
      content: [...images, { type: 'text', text: '请从这些样卷照片提取题目结构，只输出 JSON。' }],
      timestamp: Date.now(),
    },
  ]
  const assistant = await completeSimple(
    model,
    { systemPrompt: buildRubricExtractPrompt(), messages },
    { apiKey, maxTokens: Math.min(EXTRACT_MAX_TOKENS, model.maxTokens || EXTRACT_MAX_TOKENS) },
  )
  const questions = parseRubricExtractResponse(extractText(assistant))
  log(
    'info',
    'grading',
    `rubric extracted: ${questions.length} questions (${model.provider}/${model.id})`,
  )
  return questions
}
