// =============================================================
// Rubric Extract — 量规「从样卷识别」: 视觉模型抽取题目结构
// 批改管线(grading-pipeline)的旁路: 复用同一套批改模型配置与鉴权,
// 但无状态——样卷文件只读不拷贝(不进 grading/files/),不需要 taskId,
// 新建任务弹窗(任务尚不存在)也能用;结果返回后即弃,由教师校对。
// 输入支持 图片/PDF(出图) 与 docx/md/txt(出文本),见 sample-ingest。
// 纯函数(prompt 构造/解析)单独导出以便测试。
// =============================================================

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
import { ingestSampleFiles } from './sample-ingest'

/** 题目+参考答案草稿的输出比单份批改长,上限放大一倍;实际按模型上限钳制 */
const EXTRACT_MAX_TOKENS = 8192
/** 单次识别最多样卷文件数(防 token 爆炸;样卷通常 1~4 页) */
const MAX_EXTRACT_IMAGES = 8
/** 与 grading-service.MAX_FILE_BYTES 同值(其为私有,不跨文件导出) */
const MAX_EXTRACT_FILE_BYTES = 25 * 1024 * 1024

// ===== 纯函数(测试覆盖) =====

/** 构造样卷识别 system prompt: 拆题粒度 + 分值/参考答案规则 + 严格 JSON 契约 */
export function buildRubricExtractPrompt(): string {
  return [
    '你是试卷结构识别助手。从样卷（照片/PDF 页图，或从 Word/Markdown 提取的文本）中提取试卷的题目结构，只输出 JSON，不要任何解释或多余文字。',
    '',
    '拆题规则:',
    '- 按卷面最高层级题号拆题（「一、二、三」或「1、2、3」），大题内的小题不单独拆条，把小题说明并入题名或参考答案',
    '- 跨页的同一道题合并为一条',
    '- 只提取题目结构与参考答案，不要抄录任何学生的手写作答',
    '- 同时提供了文本与图片时，题目结构以文本为准，图片仅用于核对题号、分值与版式',
    '',
    '每题字段:',
    '- title: 题号与题干摘要（如「一、选择题（每小题 5 分，共 10 小题）」）',
    '- type: 题类。"objective"=客观（选择/判断/填空/连线），"subjective"=主观（简答/计算/解答/作文/论述/实验）',
    '- fullMark: 该题满分，数字。卷面有标注按标注；「每小题 x 分共 n 小题」自行相乘求和；无标注时按题型合理估计',
    '- referenceAnswer: 若样卷中有参考答案或评分标准则照录；没有则给出该题的答题要点草稿，并在末尾加上「（AI 草稿，请核对后删此标注）」',
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
 * 样卷文件(图片/PDF/docx/md/txt) → 量规题草稿(一次模型调用):
 * 摄取(见 sample-ingest) → 组装 text+image 混排消息 → completeSimple → 解析。
 * 抛出的错误经 IPC 信封返回,由 RubricEditor 内联展示。
 */
export async function extractRubricFromSamples(
  paths: string[],
): Promise<ExtractedRubricQuestion[]> {
  if (paths.length === 0) throw new Error('未选择样卷文件')
  if (paths.length > MAX_EXTRACT_IMAGES) {
    throw new Error(`样卷文件最多 ${MAX_EXTRACT_IMAGES} 个`)
  }
  const { images, text } = await ingestSampleFiles(paths, {
    maxImages: MAX_EXTRACT_IMAGES,
    maxFileBytes: MAX_EXTRACT_FILE_BYTES,
    maxPdfPages: MAX_EXTRACT_IMAGES,
  })
  if (images.length === 0 && text.trim().length === 0) {
    throw new Error('样卷中既没有图片也没有可读文本,无法识别')
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

  const content: Array<
    { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
  > = [
    ...images.map((im) => ({ type: 'image' as const, data: im.data, mimeType: im.mimeType })),
    ...(text.trim().length > 0
      ? [
          {
            type: 'text' as const,
            text: `以下是从样卷文件中提取的文本内容(Word/Markdown,与图片同源时以文本为准):\n${text.trim()}`,
          },
        ]
      : []),
    { type: 'text' as const, text: '请从这些样卷提取题目结构，只输出 JSON。' },
  ]
  const messages: Message[] = [{ role: 'user', content, timestamp: Date.now() }]
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
