// =============================================================
// Template Calibrate — 套打母版标定(Tier B)
// 样卷留档(files/<taskId>/template/) → 每页四点(CV→AI) →
// AI 版面定位逐题作答区(复用 staged-pipeline 的 locate 纯函数)。
// 标定后全班痕迹位统一走模板坐标,学生卷不再需要自己的四点。
// 方案: docs/research/2026-09-15-overlay-print-annotation-research.md P2
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { completeSimple, type Message } from '@earendil-works/pi-ai/compat'
import type { PageQuad } from '@shared/grading-geometry'
import type { GradeAnnotationBox, PaperFile } from '@shared/types'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import { resolveModel } from '../pi-ai/model-utils'
import { settingsService } from '../settings-service'
import { apiKeyFor, isVisionModel, resolveGradingModelIds } from './grading-pipeline'
import { gradingService } from './grading-service'
import { detectQuadForBuffer } from './page-quad-detect'
import { buildLocatePrompt, parseLocateResponse } from './staged-pipeline'

/** 允许的样卷图片扩展名(与试卷导入一致) */
const ALLOWED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
/** 样卷页数上限 */
const MAX_TEMPLATE_PAGES = 8
/** 送 AI 的图长边上限(控 token) */
const MAX_AI_IMAGE_PX = 1600
/** 定位输出预算 */
const LOCATE_MAX_TOKENS = 2048

export interface TemplateCalibrateResult {
  located: number
  missing: string[]
  pages: number
  quadsOk: number
}

/** 图片 buffer → 送 AI 的 JPEG(降采样控 token) */
async function toAiJpeg(buf: Buffer): Promise<{ data: string; mimeType: string }> {
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
  return { data: canvas.toBuffer('image/jpeg', 0.85).toString('base64'), mimeType: 'image/jpeg' }
}

/**
 * 母版标定: 样卷图片留档 → 四点检测 → AI 逐题定位 → 落库 task.overlayTemplate。
 * 重复标定覆盖旧档(template/ 目录先清)。
 */
export async function calibrateOverlayTemplate(
  taskId: string,
  imagePaths: string[],
): Promise<TemplateCalibrateResult> {
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new Error('样卷图片不能为空')
  }
  if (imagePaths.length > MAX_TEMPLATE_PAGES) {
    throw new Error(`样卷最多 ${MAX_TEMPLATE_PAGES} 页`)
  }
  const task = await gradingService.getTask(taskId)
  if (task.rubric.length === 0) throw new Error('量规为空,无法标定母版')

  const ids = resolveGradingModelIds(settingsService.getSettings())
  const model = resolveModel(ids.providerId, ids.modelId)
  if (!model) throw new Error(`批改模型不存在: ${ids.providerId}/${ids.modelId}`)
  if (!isVisionModel(model)) throw new Error('模型不支持图像输入,请在设置→模型中选择视觉模型')
  const apiKey = apiKeyFor(ids.providerId)
  if (!apiKey) throw new Error(`Provider ${ids.providerId} 未配置 API Key`)

  // 1) 留档: 校验 + 拷贝进 files/<taskId>/template/
  const destDir = gradingService.templateDirPath(taskId)
  await fsp.rm(destDir, { recursive: true, force: true })
  await fsp.mkdir(destDir, { recursive: true })
  const files: PaperFile[] = []
  const buffers: Buffer[] = []
  for (const [i, p] of imagePaths.entries()) {
    const ext = path.extname(p).toLowerCase()
    if (!ALLOWED_EXTS.has(ext)) throw new Error(`不支持的样卷类型 ${ext}(支持 jpg/png/webp/bmp)`)
    const stat = await fsp.stat(p)
    if (!stat.isFile()) throw new Error(`不是文件: ${p}`)
    const buf = await fsp.readFile(p)
    // 存档名 = 序号 + basename 白名单净化;目标路径必须落在 template/ 内(防穿越)
    const safeName = path
      .basename(p)
      .replace(/[^-\w.\u4e00-\u9fff]+/g, '_')
      .slice(-100)
    const storedName = `tpl-${i + 1}-${safeName}`
    const target = path.resolve(destDir, storedName)
    if (!target.startsWith(destDir + path.sep)) throw new Error('非法样卷文件名')
    await fsp.writeFile(target, buf)
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.bmp'
            ? 'image/bmp'
            : 'image/jpeg'
    files.push({ name: path.basename(p), storedName, mime, bytes: stat.size })
    buffers.push(buf)
  }

  // 2) 每页四点(CV→AI 自动链;失败页存 null 不阻断)
  const quads: Array<PageQuad | null> = []
  let quadsOk = 0
  for (const [i, buf] of buffers.entries()) {
    const r = await detectQuadForBuffer(buf, taskId, true)
    quads.push(r.quad)
    if (r.quad) quadsOk++
    else log('warn', 'grading', `template quad fail: ${taskId}#${i} ${r.error ?? '?'}`)
  }

  // 3) AI 版面定位(整卷一次调用,与 staged-pipeline 同口径;失败回落空,逐题报缺)
  let boxes: Record<string, GradeAnnotationBox> | undefined
  try {
    const parts = await Promise.all(buffers.map((b) => toAiJpeg(b)))
    const content: Array<
      { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
    > = [
      ...parts.map((p) => ({ type: 'image' as const, data: p.data, mimeType: p.mimeType })),
      { type: 'text' as const, text: '请定位每道大题的作答区域,只输出 JSON。' },
    ]
    const messages: Message[] = [{ role: 'user', content, timestamp: Date.now() }]
    const assistant = await completeSimple(
      model,
      { systemPrompt: buildLocatePrompt(task.rubric), messages },
      {
        apiKey,
        maxTokens: Math.min(LOCATE_MAX_TOKENS, model.maxTokens || LOCATE_MAX_TOKENS),
        cacheRetention: 'short',
        sessionId: `template:${taskId}`,
      },
    )
    const text = (assistant.content ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n')
    const located = parseLocateResponse(text, task.rubric)
    if (located.size > 0) boxes = Object.fromEntries(located)
  } catch (err) {
    log('warn', 'grading', `template locate failed: ${errText(err)}`)
  }

  const missing = task.rubric.filter((q) => !boxes?.[q.id]).map((q) => q.title)

  await gradingService.saveOverlayTemplate(taskId, {
    files,
    quads,
    ...(boxes ? { boxes } : {}),
    calibratedAt: new Date().toISOString(),
  })
  log(
    'info',
    'grading',
    `template calibrated: ${taskId} pages=${files.length} quads=${quadsOk} located=${Object.keys(boxes ?? {}).length}`,
  )
  return {
    located: Object.keys(boxes ?? {}).length,
    missing,
    pages: files.length,
    quadsOk,
  }
}
