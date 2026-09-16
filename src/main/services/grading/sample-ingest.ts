// =============================================================
// Sample Ingest — 样卷文件统一摄取: 图片 / PDF / docx / md / txt
// 「从样卷识别」(rubric-extract) 的输入侧: 图片与 PDF 出图片,
// docx 抽正文文本 + 内嵌图片(zip 直读 word/media),md/txt 出文本。
// 输出 { images, text } 由调用方组装 text+image 混排消息;
// 纯函数(分类/抽取判定)单独导出以便测试。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { pdfToPageJpegs, unzipEntries } from './archive-import'

export interface IngestImage {
  /** base64 */
  data: string
  mimeType: string
}

export interface IngestedSample {
  images: IngestImage[]
  text: string
}

export interface IngestOptions {
  /** 全部来源合计的图片张数上限 */
  maxImages: number
  /** 单文件字节数上限 */
  maxFileBytes: number
  /** 单个 PDF 的页数上限 */
  maxPdfPages: number
}

const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

const TEXT_EXTS = new Set(['.md', '.txt'])

export function isImageExt(ext: string): boolean {
  return ext in IMAGE_MIME
}

/** 样卷摄取支持的扩展名(图片/PDF/docx/md/txt) */
export function isSampleExt(ext: string): boolean {
  return isImageExt(ext) || ext === '.pdf' || ext === '.docx' || TEXT_EXTS.has(ext)
}

/** docx → 正文纯文本(mammoth)。IO/格式错误转教师可读提示。 */
async function docxText(buf: Buffer, label: string): Promise<string> {
  try {
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ buffer: buf })
    return value
  } catch (err) {
    throw new Error(`Word 文档解析失败(${label}): ${err instanceof Error ? err.message : '无法读取'}`)
  }
}

/** docx(zip) → 内嵌图片字节(word/media/*) */
function docxMediaImages(buf: Buffer): Array<{ data: Buffer; mimeType: string }> {
  const out: Array<{ data: Buffer; mimeType: string }> = []
  for (const entry of unzipEntries(buf)) {
    if (!entry.name.startsWith('word/media/')) continue
    const ext = path.extname(entry.name).toLowerCase()
    const mime = IMAGE_MIME[ext]
    if (!mime) continue
    out.push({ data: entry.data, mimeType: mime })
  }
  return out
}

/**
 * 样卷文件 → AI 输入素材。逐文件校验(存在/大小/类型),
 * 图片直读、PDF 栅格化(≤maxPdfPages)、docx 抽文本+内嵌图、md/txt 读文本;
 * 图片合计超 maxImages 报错(防 token 爆炸)。
 */
export async function ingestSampleFiles(
  paths: string[],
  opts: IngestOptions,
): Promise<IngestedSample> {
  const images: IngestImage[] = []
  const textParts: string[] = []

  for (const p of paths) {
    const ext = path.extname(p).toLowerCase()
    if (!isSampleExt(ext)) {
      throw new Error(`不支持的样卷格式: ${path.basename(p)}(支持 jpg/png/webp/bmp/pdf/docx/md/txt)`)
    }
    const label = path.basename(p)
    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(p)
    } catch {
      throw new Error(`样卷文件不存在或无法访问: ${label}`)
    }
    if (!stat.isFile()) throw new Error(`不是文件: ${label}`)
    if (stat.size > opts.maxFileBytes) {
      throw new Error(`文件超过 ${opts.maxFileBytes / 1024 / 1024}MB 上限: ${label}`)
    }
    let buf: Buffer
    try {
      buf = await fsp.readFile(p)
    } catch {
      throw new Error(`无法读取样卷文件: ${label}`)
    }

    if (isImageExt(ext)) {
      images.push({ data: buf.toString('base64'), mimeType: IMAGE_MIME[ext] ?? 'image/jpeg' })
    } else if (ext === '.pdf') {
      const pages = await pdfToPageJpegs(buf, label, opts.maxPdfPages)
      for (const jpeg of pages) {
        images.push({ data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
      }
    } else if (ext === '.docx') {
      const text = await docxText(buf, label)
      if (text.trim().length > 0) {
        textParts.push(`# ${label}\n${text.trim()}`)
      }
      for (const img of docxMediaImages(buf)) {
        images.push({ data: img.data.toString('base64'), mimeType: img.mimeType })
      }
    } else {
      const text = buf.toString('utf8')
      if (text.trim().length > 0) {
        textParts.push(`# ${label}\n${text.trim()}`)
      }
    }
    if (images.length > opts.maxImages) {
      throw new Error(`样卷图片合计 ${images.length} 张,超过 ${opts.maxImages} 张上限`)
    }
  }

  return { images, text: textParts.join('\n\n') }
}
