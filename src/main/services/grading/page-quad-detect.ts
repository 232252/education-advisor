// =============================================================
// Page Quad Detect — 套打定位四点检测编排(主进程)
// 自动链: ①定位点■/纸角 CV(本地毫秒级) → ②AI 视觉四点(CV 失手/低置信
// 时自动兜底,用户无感) → ③人工四点(渲染层逃生门,不在本流程)。
// 结果逐页落库到 task.papers[].overlayQuads。
// =============================================================

import fsp from 'node:fs/promises'
import { completeSimple, type Message } from '@earendil-works/pi-ai/compat'
import { type PageQuad, rescaleQuad } from '@shared/grading-geometry'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import { resolveModel } from '../pi-ai/model-utils'
import { settingsService } from '../settings-service'
import { apiKeyFor, isVisionModel, resolveGradingModelIds } from './grading-pipeline'
import { gradingService } from './grading-service'
import { buildQuadPrompt, detectQuadInGray, parseQuadResponse, rgbaToGray } from './quad-cv'

/** 分析分辨率上限(长边),CV 在此尺度跑,结果换算回原图 */
const MAX_ANALYSIS_PX = 1000
/** 送 AI 的图长边上限(控制 token) */
const MAX_AI_IMAGE_PX = 1400
/** CV 置信度低于此值自动升级 AI 四点 */
const CV_CONFIDENCE_AI_THRESHOLD = 0.55

export interface OverlayQuadPageResult {
  page: number
  ok: boolean
  source?: PageQuad['source']
  confidence?: number
  error?: string
}

export interface OverlayQuadDetectResult {
  paperId: string
  studentName: string | null
  pages: OverlayQuadPageResult[]
}

/** 图片 buffer → 灰度分析图(降采样);解码失败抛错 */
async function toAnalysisGray(buf: Buffer): Promise<{
  gray: ReturnType<typeof rgbaToGray>
  origWidth: number
  origHeight: number
}> {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas')
  const img = await loadImage(buf)
  const scale = Math.min(1, MAX_ANALYSIS_PX / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data
  return {
    gray: rgbaToGray(data, w, h),
    origWidth: img.width,
    origHeight: img.height,
  }
}

/**
 * 单图四点检测(CV→AI 自动链): 母版标定/单页补检共用。
 * useAi=false 只跑本地 CV。
 */
export async function detectQuadForBuffer(
  buf: Buffer,
  taskId: string,
  useAi = true,
): Promise<{ quad: PageQuad | null; error?: string }> {
  let quad = await detectQuadFromImage(buf)
  if ((!quad || quad.confidence < CV_CONFIDENCE_AI_THRESHOLD) && useAi) {
    const ai = await aiDetectQuad(buf, taskId)
    if (ai.quad) quad = ai.quad
    else if (!quad) return { quad: null, error: ai.error ?? 'CV 未定位,AI 兜底失败' }
  }
  return { quad }
}

/** CV 检测一张图(结果换算回原图像素坐标);失败返回 null */
export async function detectQuadFromImage(buf: Buffer): Promise<PageQuad | null> {
  try {
    const { gray, origWidth, origHeight } = await toAnalysisGray(buf)
    const quad = detectQuadInGray(gray)
    if (!quad) return null
    return rescaleQuad(quad, origWidth, origHeight)
  } catch (err) {
    log('warn', 'grading', `quad detect skipped: ${errText(err)}`)
    return null
  }
}

/** 图片 buffer → 送 AI 的 JPEG buffer(降采样控 token) */
async function toAiJpeg(buf: Buffer): Promise<Buffer> {
  const { loadImage, createCanvas } = await import('@napi-rs/canvas')
  const img = await loadImage(buf)
  const scale = Math.min(1, MAX_AI_IMAGE_PX / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toBuffer('image/jpeg', 0.85)
}

/** AI 视觉四点(0-1 输出 → 原图像素);未配置视觉模型/调用失败返回 null */
async function aiDetectQuad(
  buf: Buffer,
  taskId: string,
): Promise<{ quad: PageQuad | null; error?: string }> {
  const ids = resolveGradingModelIds(settingsService.getSettings())
  const model = resolveModel(ids.providerId, ids.modelId)
  if (!model) return { quad: null, error: '批改模型不存在' }
  if (!isVisionModel(model)) return { quad: null, error: '模型不支持图像输入' }
  const apiKey = apiKeyFor(ids.providerId)
  if (!apiKey) return { quad: null, error: '未配置 API Key' }
  try {
    const jpeg = await toAiJpeg(buf)
    const content: Array<
      { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
    > = [
      { type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' },
      { type: 'text', text: '找出试卷纸张的四个角,只输出 JSON。' },
    ]
    const messages: Message[] = [{ role: 'user', content, timestamp: Date.now() }]
    const assistant = await completeSimple(
      model,
      { systemPrompt: buildQuadPrompt(), messages },
      {
        apiKey,
        maxTokens: Math.min(256, model.maxTokens || 256),
        cacheRetention: 'short',
        sessionId: `quad:${taskId}`,
      },
    )
    const text = (assistant.content ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    const { loadImage } = await import('@napi-rs/canvas')
    const img = await loadImage(buf)
    const quad = parseQuadResponse(text, img.width, img.height)
    if (!quad) return { quad: null, error: 'AI 输出无法解析' }
    return { quad }
  } catch (err) {
    return { quad: null, error: errText(err) }
  }
}

/**
 * 全任务逐份逐页检测四点(CV → 置信度低/失败自动 AI),结果落库。
 * useAiFallback=false 时只跑本地 CV(不花模型调用)。
 */
export async function detectQuadsForTask(
  taskId: string,
  opts?: { useAiFallback?: boolean },
): Promise<OverlayQuadDetectResult[]> {
  const task = await gradingService.getTask(taskId)
  const useAi = opts?.useAiFallback !== false
  const results: OverlayQuadDetectResult[] = []
  for (const paper of task.papers) {
    if (paper.files.length === 0) continue
    const pages: OverlayQuadPageResult[] = []
    const quads: Array<PageQuad | null> = []
    for (const [i, f] of paper.files.entries()) {
      let quad: PageQuad | null = null
      let error: string | undefined
      try {
        const buf = await fsp.readFile(gradingService.paperFilePath(taskId, f.storedName))
        const r = await detectQuadForBuffer(buf, taskId, useAi)
        quad = r.quad
        if (!quad) error = r.error ?? '未检出'
      } catch (err) {
        error = errText(err)
      }
      quads.push(quad)
      pages.push(
        quad
          ? { page: i, ok: true, source: quad.source, confidence: quad.confidence }
          : { page: i, ok: false, error: error ?? '未检出' },
      )
      log(
        'info',
        'grading',
        `quad detect: ${taskId}/${paper.id}#${i} → ${quad ? `${quad.source}(${quad.confidence.toFixed(2)})` : `fail(${error ?? '?'})`}`,
      )
    }
    await gradingService.saveOverlayQuads(taskId, paper.id, quads)
    results.push({ paperId: paper.id, studentName: paper.studentName, pages })
  }
  return results
}
