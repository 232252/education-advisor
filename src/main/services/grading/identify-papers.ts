// =============================================================
// Identify Papers — 从卷面手写姓名/编号识别归属
// 看每份试卷首页(页眉/姓名栏),对班级名单做唯一匹配后 assignPaper。
// 复用批改模型(必须视觉);与样卷识别一样无流式。
// 不从 grading-pipeline 反向 import 编排,避免循环依赖。
// =============================================================

import fsp from 'node:fs/promises'
import { parseJsonWithRepair } from '@earendil-works/pi-ai'
import { completeSimple, type Message } from '@earendil-works/pi-ai/compat'
import {
  matchIdentityToStudents,
  type PaperIdentity,
  type StudentCandidate,
} from '@shared/grading-helpers'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import { resolveModel } from '../pi-ai/model-utils'
import { settingsService } from '../settings-service'
import { apiKeyFor, isVisionModel, resolveGradingModelIds } from './grading-pipeline'
import { gradingService } from './grading-service'

const IDENTIFY_MAX_TOKENS = 256

export interface IdentifyPapersResult {
  assigned: number
  unresolved: number
}

export interface IdentifyPapersOptions {
  signal?: AbortSignal
  /** 批改作业内调用: 任务已进入 grading 态 */
  allowWhileGrading?: boolean
  onProgress?: (p: { paperId: string; index: number; total: number }) => void
}

export function buildIdentifyPrompt(): string {
  return [
    '你是试卷身份识别助手。只看首页页眉、姓名栏、学号栏、座位号、考号，读出考生是谁。',
    '只输出 JSON，不要解释。不要把题目、选项、分数当成姓名。',
    '',
    '输出格式:',
    '{"name":"张三","number":"12"}',
    '- name: 卷面上的姓名,没有则空字符串',
    '- number: 学号/座号/考号数字或编号,没有则空字符串',
    '- 字迹不清时宁可空着,不要猜',
    '- 只输出上述 JSON，不要 markdown 代码块标记',
  ].join('\n')
}

function parseJsonObject(text: string): Record<string, unknown> {
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
      /* 下一个候选 */
    }
  }
  if (!parsedOk) {
    parsed = parseJsonWithRepair(candidates[candidates.length - 1] ?? stripped)
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('身份识别输出不是对象')
  }
  return parsed as Record<string, unknown>
}

/** 解析模型返回的姓名/编号;非法则空串(该份保持未归组) */
export function parseIdentifyResponse(text: string): PaperIdentity {
  try {
    const r = parseJsonObject(text)
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    const number =
      typeof r.number === 'number' && Number.isFinite(r.number)
        ? String(Math.trunc(r.number))
        : typeof r.number === 'string'
          ? r.number.trim()
          : ''
    return { name, number }
  } catch {
    return { name: '', number: '' }
  }
}

export async function identifyUnassignedPapers(
  taskId: string,
  roster: StudentCandidate[],
  opts?: IdentifyPapersOptions,
): Promise<IdentifyPapersResult> {
  if (roster.length === 0) {
    throw new Error('学生名单为空,无法从卷面归组')
  }
  const task = await gradingService.getTask(taskId)
  if (task.status === 'published') {
    throw new Error(`任务状态 ${task.status} 不可识别归属`)
  }
  if (task.status === 'grading' && !opts?.allowWhileGrading) {
    throw new Error(`任务状态 ${task.status} 不可识别归属`)
  }
  const targets = task.papers.filter((p) => p.studentName === null && p.files.length > 0)
  if (targets.length === 0) {
    return { assigned: 0, unresolved: 0 }
  }
  const taken = new Set(
    task.papers
      .map((p) => p.studentName)
      .filter((n): n is string => typeof n === 'string' && n.length > 0),
  )

  const ids = resolveGradingModelIds(settingsService.getSettings())
  const model = resolveModel(ids.providerId, ids.modelId)
  if (!model) {
    throw new Error(`批改模型不存在: ${ids.providerId}/${ids.modelId}`)
  }
  if (!isVisionModel(model)) {
    throw new Error(`模型 ${model.id} 不支持图像输入,请在设置→模型中选择视觉模型`)
  }
  const apiKey = apiKeyFor(ids.providerId)
  if (!apiKey) {
    throw new Error(`Provider ${ids.providerId} 未配置 API Key`)
  }

  let assigned = 0
  let unresolved = 0
  const prompt = buildIdentifyPrompt()
  for (const [i, paper] of targets.entries()) {
    if (opts?.signal?.aborted) break
    const first = paper.files[0]
    if (!first) {
      unresolved++
      continue
    }
    opts?.onProgress?.({ paperId: paper.id, index: i + 1, total: targets.length })
    try {
      const buf = await fsp.readFile(gradingService.paperFilePath(taskId, first.storedName))
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            { type: 'image', data: buf.toString('base64'), mimeType: first.mime },
            { type: 'text', text: '请读出这份试卷首页上的姓名和编号，只输出 JSON。' },
          ],
          timestamp: Date.now(),
        },
      ]
      const assistant = await completeSimple(
        model,
        { systemPrompt: prompt, messages },
        {
          apiKey,
          maxTokens: Math.min(IDENTIFY_MAX_TOKENS, model.maxTokens || IDENTIFY_MAX_TOKENS),
          signal: opts?.signal,
          cacheRetention: 'short',
          sessionId: `identify:${taskId}`,
        },
      )
      if (assistant.stopReason === 'aborted' || opts?.signal?.aborted) break
      const text = (assistant.content ?? [])
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
      const identity = parseIdentifyResponse(text)
      const match = matchIdentityToStudents(identity, roster)
      if (match.suggested && !taken.has(match.suggested)) {
        await gradingService.assignPaper(taskId, paper.id, match.suggested)
        taken.add(match.suggested)
        assigned++
      } else {
        unresolved++
      }
    } catch (err) {
      if (opts?.signal?.aborted) break
      unresolved++
      log('warn', 'grading', `identify failed: ${paper.id} ${errText(err)}`)
    }
  }
  log('info', 'grading', `identify done: ${taskId} assigned ${assigned}, unresolved ${unresolved}`)
  return { assigned, unresolved }
}
