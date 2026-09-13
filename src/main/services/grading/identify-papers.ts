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
import type { GradingPaper } from '@shared/types'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import { resolveModel } from '../pi-ai/model-utils'
import { profileService } from '../profile-service'
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
    '考号经常不等于学号：number 原样抄卷面上的编号，不要改成你以为的学号。',
    '编号原样保留所有位数和前导零：卷面写 01 就输出 "01"，不要写成 "1"。',
    '先读姓名；姓名看不清再读编号。字迹不清宁可空着，不要猜。',
    '',
    '输出格式:',
    '{"name":"张三","number":"12"}',
    '- name: 卷面上的姓名,没有则空字符串',
    '- number: 学号/座号/考号数字或编号(原样含前导零),没有则空字符串',
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

/** 把档案里的学号/考号并进别名。考号常与学号不同，两列都要能命中。 */
export async function enrichRosterWithProfiles(
  roster: StudentCandidate[],
): Promise<StudentCandidate[]> {
  return Promise.all(
    roster.map(async (s) => {
      const profile = await profileService.get(s.name)
      const extra = [profile.studentNumber, profile.examNumber].filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      )
      if (extra.length === 0) return s
      return { name: s.name, aliases: [...new Set([...(s.aliases ?? []), ...extra])] }
    }),
  )
}

// ===== 首页顶部放大截图(姓名/考号栏通常在页眉,整页缩小后手写小字难读) =====

/** 顶部裁剪高度占整页比例(页眉+姓名栏+考号栏一般在前 1/4) */
const HEADER_CROP_RATIO = 0.28
/** 裁剪区放大后目标宽度(px):够读手写,又不至于把图撑太大 */
const HEADER_TARGET_WIDTH_PX = 1400

/**
 * 用 @napi-rs/canvas 把首页顶部裁出来放大成 JPEG(识别辅助图)。
 * 失败(解码不了/无 canvas)返回 null,调用方退回仅整页识别 — 增强永不阻断。
 */
export async function buildHeaderCrop(buf: Buffer): Promise<Buffer | null> {
  try {
    const { loadImage, createCanvas } = await import('@napi-rs/canvas')
    const img = await loadImage(buf)
    const cropH = Math.max(1, Math.floor(img.height * HEADER_CROP_RATIO))
    const scale = Math.min(4, Math.max(1, HEADER_TARGET_WIDTH_PX / img.width))
    const outW = Math.floor(img.width * scale)
    const outH = Math.floor(cropH * scale)
    const canvas = createCanvas(outW, outH)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, img.width, cropH, 0, 0, outW, outH)
    return canvas.toBuffer('image/jpeg', 0.9)
  } catch (err) {
    log('warn', 'grading', `header crop skipped: ${errText(err)}`)
    return null
  }
}

/** 对一份试卷读身份:首页为主,顶部放大图优先;两图都空再试次页(最多 2 张) */
async function readIdentity(
  taskId: string,
  files: GradingPaper['files'],
  model: NonNullable<ReturnType<typeof resolveModel>>,
  apiKey: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<PaperIdentity> {
  const lookAt = files.slice(0, 2)
  for (const [i, f] of lookAt.entries()) {
    const buf = await fsp.readFile(gradingService.paperFilePath(taskId, f.storedName))
    const header =
      i === 0 && (f.mime === 'image/jpeg' || f.mime === 'image/png')
        ? await buildHeaderCrop(buf)
        : null
    const content: Array<
      { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
    > = []
    if (header) {
      content.push({ type: 'image', data: header.toString('base64'), mimeType: 'image/jpeg' })
    }
    content.push({ type: 'image', data: buf.toString('base64'), mimeType: f.mime })
    content.push({
      type: 'text',
      text: header
        ? '第 1 张图是试卷首页顶部的放大截图(优先从中读姓名/编号)；第 2 张是整页原图。只输出 JSON。'
        : '请读出这份试卷页面上的姓名和编号，只输出 JSON。',
    })
    const messages: Message[] = [{ role: 'user', content, timestamp: Date.now() }]
    const assistant = await completeSimple(
      model,
      { systemPrompt: prompt, messages },
      {
        apiKey,
        maxTokens: Math.min(IDENTIFY_MAX_TOKENS, model.maxTokens || IDENTIFY_MAX_TOKENS),
        signal,
        cacheRetention: 'short',
        sessionId: `identify:${taskId}`,
      },
    )
    if (assistant.stopReason === 'aborted') throw new Error('已中止')
    const text = (assistant.content ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    const identity = parseIdentifyResponse(text)
    // 读到任一字段就不再翻下一张
    if (identity.name.length > 0 || identity.number.length > 0) return identity
  }
  return { name: '', number: '' }
}

export async function identifyUnassignedPapers(
  taskId: string,
  roster: StudentCandidate[],
  opts?: IdentifyPapersOptions,
): Promise<IdentifyPapersResult> {
  if (roster.length === 0) {
    throw new Error('学生名单为空,无法从卷面归组')
  }
  const rosterWithIds = await enrichRosterWithProfiles(roster)
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
    if (paper.files.length === 0) {
      unresolved++
      continue
    }
    opts?.onProgress?.({ paperId: paper.id, index: i + 1, total: targets.length })
    try {
      const identity = await readIdentity(taskId, paper.files, model, apiKey, prompt, opts?.signal)
      if (opts?.signal?.aborted) break
      const match = matchIdentityToStudents(identity, rosterWithIds)
      // 读到什么记什么:归组成功与否都留痕,试卷表回显 + 排查有据
      await gradingService.savePaperIdentity(taskId, paper.id, {
        name: identity.name,
        number: identity.number,
        candidates: match.candidates,
        ...(match.suggested ? { matched: match.suggested } : {}),
        readAt: new Date().toISOString(),
      })
      log(
        'info',
        'grading',
        `identify read: ${paper.id} name="${identity.name}" number="${identity.number}"` +
          ` → ${match.suggested ? `matched ${match.suggested}` : `unresolved(candidates: ${match.candidates.join('/') || '无'})`}`,
      )
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
