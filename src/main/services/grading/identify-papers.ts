// =============================================================
// Identify Papers — 从卷面手写姓名/编号识别归属
// 看每份试卷首页页眉(仅顶部放大小图,一次调用),对班级名单做唯一匹配后:
// 未占用 → assignPaper;该生名下已有卷且可并 → appendPaperPages 合并续页
// (多学生 PDF 每页一批拆份后的单学生多页归组);已批改 → duplicates 告警。
// 主循环后跑续页兜底: 姓名只写在首页的卷,空身份续页按「同源文件名+连续
// 页号」链式并入前一页学生的卷。复用批改模型(必须视觉);与样卷识别一样
// 无流式。不从 grading-pipeline 反向 import 编排,避免循环依赖。
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
  /** 单学生多页: 续页并入该生名下 anchor 卷的份数 */
  merged: number
  /** 续页兜底并入的份数(姓名只写在首页,空身份续页按连续页号链式并入) */
  continuationMerged: number
  /** 唯一命中但该生名下卷已批改(补录场景)的学生名,留人工处理 */
  duplicates: string[]
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
/** 可做页眉裁剪的首页格式(loadImage 可解码,重绘后统一输出 JPEG) */
const HEADER_CROP_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp'])

/**
 * 用 @napi-rs/canvas 把首页顶部裁出来放大成 JPEG(识别辅助图)。
 * 失败(解码不了/无 canvas)返回 null,调用方(readIdentity 轻量模式)
 * 以无图 content 只调一次模型 — 增强永不阻断。
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

/** 对一份试卷读身份(轻量模式): 只发首页顶部放大小图一次。
 * 页眉 crop 失败(解码不了/无 canvas)→ 图片列表为空,仍只调一次模型,
 * 读不出即空身份 —— 不读整页、不翻次页(50 人×3 页场景省下约 100 次
 * 注定 unresolved 的整页调用;姓名不在页眉的卷进人工归组队列)。 */
export async function readIdentity(
  taskId: string,
  files: GradingPaper['files'],
  model: NonNullable<ReturnType<typeof resolveModel>>,
  apiKey: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<PaperIdentity> {
  const first = files[0]
  if (!first) return { name: '', number: '' }
  const buf = await fsp.readFile(gradingService.paperFilePath(taskId, first.storedName))
  // @napi-rs/canvas 的 loadImage 同样支持 webp/bmp(白底重绘后输出 JPEG)
  const header = HEADER_CROP_MIMES.has(first.mime) ? await buildHeaderCrop(buf) : null
  const content: Array<
    { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
  > = []
  if (header) {
    content.push({ type: 'image', data: header.toString('base64'), mimeType: 'image/jpeg' })
  }
  content.push({
    type: 'text',
    text: header
      ? '这是试卷首页顶部的放大截图(页眉/姓名栏/考号栏),从中读出姓名和编号。只输出 JSON。'
      : '首页顶部截图不可用。只输出 JSON。',
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
  return parseIdentifyResponse(text)
}

// ===== 逐份判定(纯函数): 唯一身份 → assign / merge / duplicates / unresolved =====

/** classifyPaperIdentity 的四值口径(互斥) */
export type PaperIdentityClass = 'assign' | 'merge' | 'duplicates' | 'unresolved'

/** 该生名下 anchor 卷(已归组试卷)的判定所需状态快照 */
export interface AnchorState {
  hasAi: boolean
  status: GradingPaper['status']
}

/**
 * 四分支互斥统一口径:
 * - 空身份或 match.suggested===null(歧义/未命中) → unresolved(人工);
 * - 唯一命中且未占用 → assign;
 * - 唯一命中且已占用,anchor 卷无 AI 结果且 status∈{unassigned,pending} → merge
 *   (单学生多页: 续页按导入顺序并入 anchor);
 * - 唯一命中但 anchor 已有 AI 结果(补录场景)或状态不可并 → duplicates 告警。
 */
export function classifyPaperIdentity(
  identity: PaperIdentity,
  match: { suggested: string | null },
  taken: ReadonlySet<string>,
  anchorState: AnchorState | null,
): PaperIdentityClass {
  const empty = identity.name.trim().length === 0 && identity.number.trim().length === 0
  if (empty) return 'unresolved'
  const suggested = match.suggested
  if (!suggested) return 'unresolved'
  if (!taken.has(suggested)) return 'assign'
  if (
    anchorState &&
    !anchorState.hasAi &&
    (anchorState.status === 'unassigned' || anchorState.status === 'pending')
  ) {
    return 'merge'
  }
  return 'duplicates'
}

// ===== 续页兜底(纯函数): 姓名只写在首页的多页卷 =====

/** 从导入文件名解析「同源页号」: `9ban1-p3.jpg` → { base:'9ban1', page:3 }。
 * 页号规则由 archive-import 的 PDF 拆页命名产生(`${原卷名}-p${N}.jpg`)。 */
export function parsePageKey(fileName: string): { base: string; page: number } | null {
  const match = fileName.trim().match(/^(.*)-p(\d+)(?:\.[^.]+)?$/)
  if (!match) return null
  const page = Number(match[2])
  if (!Number.isInteger(page) || page < 1) return null
  return { base: match[1], page }
}

/** 续页并入判定所需的 anchor 卷状态 */
export interface ContinuationAnchorState {
  /** anchor 卷 id */
  id: string
  /** anchor 最后一页的页号(与待并页同源;非同源页混入则调用方不传) */
  lastPage: number
}

/**
 * 无姓名续页是否并入前一页学生(保守口径):
 * - 身份记录存在且姓名/编号都为空(模型看过该页、什么都没读到);
 *   没有身份记录(识别调用失败/未跑过)不并 —— 读失败≠卷面没写;
 * - 读出过姓名或编号的页绝不自动并 —— 可能是名册外学生,留人工;
 * - 同源前一页已归属某学生,且该生 anchor 最后一页正好是前一页
 *   (连续页链,链中间断档不跨并)。
 */
export function shouldMergeContinuation(args: {
  identity: { name: string; number: string } | undefined
  /** 同源前一页(page-1)已归属的学生名;无则不并 */
  prevOwner: string | undefined
  /** 待并页前一页的页号 */
  prevPage: number
  /** prevOwner 名下 anchor 卷状态;不存在/不可并不传 */
  anchor: ContinuationAnchorState | undefined
}): boolean {
  const identity = args.identity
  if (identity === undefined) return false
  if (identity.name.trim().length > 0 || identity.number.trim().length > 0) return false
  if (!args.prevOwner || !args.anchor) return false
  return args.anchor.lastPage === args.prevPage
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
    return { assigned: 0, unresolved: 0, merged: 0, continuationMerged: 0, duplicates: [] }
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
  let merged = 0
  const duplicates: string[] = []
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
      // 唯一命中且已被占用: 取该生名下 anchor 卷状态(循环内 assign/merge 会改任务,
      // 现取现读保证 anchor 是最新卷集里的)
      let anchor: { id: string; state: AnchorState } | null = null
      if (match.suggested && taken.has(match.suggested)) {
        const current = await gradingService.getTask(taskId)
        const found = current.papers.find(
          (p) => p.studentName === match.suggested && p.id !== paper.id,
        )
        if (found) {
          anchor = {
            id: found.id,
            state: { hasAi: found.ai !== undefined, status: found.status },
          }
        }
      }
      const action = classifyPaperIdentity(identity, match, taken, anchor ? anchor.state : null)
      if (action === 'assign' && match.suggested) {
        await gradingService.assignPaper(taskId, paper.id, match.suggested)
        taken.add(match.suggested)
        assigned++
      } else if (action === 'merge' && anchor && match.suggested) {
        // 单学生多页: 续页按导入顺序(=PDF 页序)并入 anchor,source 记录转移、物理文件保留
        await gradingService.appendPaperPages(taskId, anchor.id, paper.id)
        merged++
        log(
          'info',
          'grading',
          `identify merge: ${paper.id} → anchor ${anchor.id} (${match.suggested})`,
        )
      } else if (action === 'duplicates' && match.suggested) {
        // 补录场景: 该生名下卷已批改,不能自动并入,留人工处理
        duplicates.push(match.suggested)
        log(
          'warn',
          'grading',
          `identify duplicate: ${paper.id} matches graded paper of ${match.suggested}, left unassigned`,
        )
      } else {
        unresolved++
      }
    } catch (err) {
      if (opts?.signal?.aborted) break
      unresolved++
      log('warn', 'grading', `identify failed: ${paper.id} ${errText(err)}`)
    }
  }
  // ===== 续页兜底: 姓名只写在首页的多页卷 =====
  // 主循环按卷面身份归组;身份为空的续页(学生只在首页写姓名)落 unresolved。
  // 这里按「同源文件名+连续页号」链式并入: 同源前一页已归属、该生 anchor
  // 无 AI 结果且最后一页正好是前一页 → 并入该生(逐页推进,3 页以上可链)。
  // 目标卷全部来自本轮 targets(开始快照后无新增),unresolved→merged 转移
  // 不破坏下方计数守恒。
  let continuationMerged = 0
  if (!opts?.signal?.aborted) {
    const current = await gradingService.getTask(taskId)
    const pageOwners = new Map<string, string>()
    for (const p of current.papers) {
      if (!p.studentName) continue
      for (const f of p.files) {
        const key = parsePageKey(f.name)
        if (key) pageOwners.set(`${key.base}::${key.page}`, p.studentName)
      }
    }
    const leftovers = current.papers
      .filter((p) => p.studentName === null && p.files.length > 0)
      .map((p) => ({ paper: p, key: parsePageKey(p.files[0]?.name ?? '') }))
      .filter(
        (x): x is { paper: GradingPaper; key: { base: string; page: number } } => x.key !== null,
      )
      .sort((a, b) => a.key.base.localeCompare(b.key.base) || a.key.page - b.key.page)
    for (const { paper, key } of leftovers) {
      if (opts?.signal?.aborted) break
      const prevOwner = pageOwners.get(`${key.base}::${key.page - 1}`)
      let anchor: ContinuationAnchorState | undefined
      if (prevOwner) {
        const anchorPaper = current.papers.find((p) => {
          if (p.studentName !== prevOwner || p.id === paper.id || p.ai) return false
          const lastKey = parsePageKey(p.files[p.files.length - 1]?.name ?? '')
          return lastKey !== null && lastKey.base === key.base
        })
        const lastKey = anchorPaper
          ? parsePageKey(anchorPaper.files[anchorPaper.files.length - 1]?.name ?? '')
          : null
        if (anchorPaper && lastKey) anchor = { id: anchorPaper.id, lastPage: lastKey.page }
      }
      if (
        !shouldMergeContinuation({
          identity: paper.identity,
          prevOwner,
          prevPage: key.page - 1,
          anchor,
        }) ||
        !prevOwner ||
        !anchor
      ) {
        continue
      }
      try {
        await gradingService.appendPaperPages(taskId, anchor.id, paper.id)
      } catch (err) {
        // 并入失败(如 anchor 刚被批改):保持 unresolved 留人工,不中断其余页
        log('warn', 'grading', `identify continuation failed: ${paper.id} ${errText(err)}`)
        continue
      }
      // 本地镜像同步: 移除已并卷、登记页主,后续页才能链式接上
      const idx = current.papers.indexOf(paper)
      if (idx >= 0) current.papers.splice(idx, 1)
      pageOwners.set(`${key.base}::${key.page}`, prevOwner)
      continuationMerged++
      merged++
      unresolved--
      log(
        'info',
        'grading',
        `identify continuation: ${paper.id} (${key.base} p${key.page}) → ${prevOwner} anchor ${anchor.id}`,
      )
    }
  }
  // 计数守恒核验: 仅在未被 signal 中止且循环完整跑完时校验
  // (三处 abort break 中途停止必然不守恒,不得误报 error)。
  if (!opts?.signal?.aborted) {
    const total = assigned + merged + unresolved + duplicates.length
    if (total !== targets.length) {
      log(
        'error',
        'grading',
        `identify conservation broken: ${taskId} targets ${targets.length}` +
          ` != assigned ${assigned} + merged ${merged} unresolved ${unresolved} + duplicates ${duplicates.length}`,
      )
    }
  }
  log(
    'info',
    'grading',
    `identify done: ${taskId} assigned ${assigned}, merged ${merged}` +
      ` (continuation ${continuationMerged}), unresolved ${unresolved}, duplicates ${duplicates.length}`,
  )
  return { assigned, unresolved, merged, continuationMerged, duplicates }
}
