// =============================================================
// Rubric Refine — 评分标准「自动细化」: 参考答案 → 逐题扣分点
// 从量规的参考答案/评分标准出发,让模型为每题生成一组扣分点
// (presetMarks,负分值),落到现有评分点体系(复核台点选/分数合成/
// 打印 markNotes 全部自动接上)。纯文本调用,不需要视觉,不落盘 —
// 结果返回给 RubricEditor 作为草稿,教师校对后才随量规保存。
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
import type { PresetMark, RubricQuestion } from '@shared/types'
import { log } from '../../utils/logger'
import { resolveModel } from '../pi-ai/model-utils'
import { settingsService } from '../settings-service'
import { apiKeyFor, resolveGradingModelIds } from './grading-pipeline'

/** 细化输出上限: 逐题扣分点 JSON,与样卷识别同档;实际按模型上限钳制 */
const REFINE_MAX_TOKENS = 8192
/** 每题扣分点上限(防模型倾倒;客观大题按小题拆也能容纳) */
const MAX_MARKS_PER_QUESTION = 12

/** 细化结果: 每题一组扣分点(只有成功细化的题出现) */
export interface RefinedRubricMarks {
  id: string
  presetMarks: PresetMark[]
}

/** 可参与细化的题: 必须有参考答案/评分标准可依 */
export function refineTargets(rubric: RubricQuestion[]): RubricQuestion[] {
  return rubric.filter(
    (q) => typeof q.referenceAnswer === 'string' && q.referenceAnswer.trim().length > 0,
  )
}

/** 构造细化 system prompt: 输入题清单 + 扣分点规则 + 严格 JSON 契约 */
export function buildRefinePrompt(targets: RubricQuestion[]): string {
  const lines = targets
    .map(
      (q) =>
        `- id: ${q.id} | 题目: ${q.title} | 满分: ${q.fullMark} | 参考答案/评分标准: ${(
          q.referenceAnswer ?? ''
        )
          .replace(/\s+/g, ' ')
          .trim()}`,
    )
    .join('\n')
  return [
    '你是资深命题教师。把每题的参考答案细化为逐项扣分点，只输出 JSON，不要任何解释。',
    '',
    '题目清单:',
    lines,
    '',
    '扣分点规则:',
    '- points 一律为负数(扣分制); 同题所有扣分点绝对值合计 ≤ 该题满分',
    '- note ≤ 25 字，写清「什么情况扣几分」，面向学生能看懂',
    '- 客观大题(选择/填空/判断含多个小题)按小题拆: 每小题一个扣分点、分值=该小题分值(如 10 小题×5 分 → 10 个 -5 的点，note 写「第 N 小题错」)',
    '- 主观题按常见失分方式拆(步骤缺失/公式错误/计算错误/单位漏写/结论错误/表述不全等)，分值按评分标准划分，无明确标准时按满分合理比例估计',
    '- 每题 2~12 个扣分点; 满分极小(≤2 分)的题给 1~2 个点即可',
    '',
    '输出格式(items 必须覆盖清单每一个 id):',
    '{"items":[{"id":"q-1","marks":[{"points":-2,"note":"单位未换算或漏写"}]}]}',
    '- 只输出上述 JSON，不要 markdown 代码块标记',
  ].join('\n')
}

/** 同题扣分点清洗: 负数化/去重/钳制/封顶,并保证绝对值合计 ≤ 满分(超出丢弃尾部) */
export function cleanRefinedMarks(raw: PresetMark[], fullMark: number): PresetMark[] {
  const seen = new Set<string>()
  const out: PresetMark[] = []
  let total = 0
  for (const m of raw.slice(0, MAX_MARKS_PER_QUESTION)) {
    const abs = Math.abs(Number(m?.points))
    const note = typeof m?.note === 'string' ? m.note.trim() : ''
    if (!Number.isFinite(abs) || abs <= 0 || note.length === 0) continue
    const points = -Math.min(Math.round(abs * 100) / 100, fullMark) // 模型偶给正数 — 统一负数化
    const clipped = { points, note: note.slice(0, 60) }
    const key = `${clipped.points}|${clipped.note}`
    if (seen.has(key)) continue // 完全同点去重(防重复倾倒)
    seen.add(key)
    if (total + Math.abs(points) > fullMark) continue // 合计越界 — 丢弃而非截断分值,保持点语义完整
    total += Math.abs(points)
    out.push(clipped)
  }
  return out
}

/**
 * 解析模型返回的 JSON 为逐题扣分点:
 * 剥围栏 → parse → 截取首尾大括号重试 → 修复解析(与批改/识别同一容错阶梯);
 * 未知题目丢弃、单题清洗(cleanRefinedMarks);无任何有效题则抛错。
 */
export function parseRefineResponse(text: string, targets: RubricQuestion[]): RefinedRubricMarks[] {
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
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
    try {
      parsed = parseJsonWithRepair(candidates[candidates.length - 1] ?? stripped)
    } catch {
      throw new Error('细化输出不是有效 JSON')
    }
  }
  const rawItems = (parsed as { items?: unknown })?.items
  if (!Array.isArray(rawItems)) {
    throw new Error('细化输出缺少 items 数组')
  }
  const byId = new Map(targets.map((q) => [q.id, q]))
  const out: RefinedRubricMarks[] = []
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    const q = byId.get(id)
    if (!q) continue // 未知题目: 丢弃
    const marks = Array.isArray(r.marks) ? (r.marks as PresetMark[]) : []
    const cleaned = cleanRefinedMarks(marks, q.fullMark)
    if (cleaned.length === 0) continue
    byId.delete(id) // 同题多次出现以首次为准
    out.push({ id, presetMarks: cleaned })
  }
  if (out.length === 0) {
    throw new Error('细化输出没有可用的扣分点')
  }
  return out
}

// ===== 编排(有状态) =====

function extractText(message: AssistantMessage): string {
  return (message.content ?? [])
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

/**
 * 量规 → 逐题扣分点(一次文本模型调用):
 * 只细化有参考答案的题;结果由教师校对后随量规保存,这里不落盘。
 * 抛出的错误经 IPC 信封返回,由 RubricEditor 内联展示。
 */
export async function refineRubricStandards(
  rubric: RubricQuestion[],
): Promise<RefinedRubricMarks[]> {
  if (!Array.isArray(rubric) || rubric.length === 0) throw new Error('量规为空,无法细化')
  const targets = refineTargets(rubric)
  if (targets.length === 0) {
    throw new Error('没有可细化的题目: 请先填写参考答案/评分标准')
  }

  // 模型与鉴权(与批改同一套配置;纯文本调用,不要求视觉)
  const ids = resolveGradingModelIds(settingsService.getSettings())
  const model: Model<Api> | undefined = resolveModel(ids.providerId, ids.modelId)
  if (!model) {
    throw new Error(`批改模型不存在: ${ids.providerId}/${ids.modelId}(请在设置→模型中配置)`)
  }
  const apiKey = apiKeyFor(ids.providerId)
  if (!apiKey) {
    throw new Error(`Provider ${ids.providerId} 未配置 API Key`)
  }

  const messages: Message[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: '请把以上每题的评分标准细化为扣分点，只输出 JSON。' }],
      timestamp: Date.now(),
    },
  ]
  const assistant = await completeSimple(
    model,
    { systemPrompt: buildRefinePrompt(targets), messages },
    {
      apiKey,
      maxTokens: Math.min(REFINE_MAX_TOKENS, model.maxTokens || REFINE_MAX_TOKENS),
      // 题清单进 system prompt,同任务重复细化可命中缓存
      cacheRetention: 'short',
      sessionId: 'rubric-refine',
    },
  )
  const result = parseRefineResponse(extractText(assistant), targets)
  log(
    'info',
    'grading',
    `rubric refined: ${result.length}/${targets.length} questions (${model.provider}/${model.id})`,
  )
  return result
}
