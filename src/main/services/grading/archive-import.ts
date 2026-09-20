// =============================================================
// Archive Import — zip / PDF 展开为图片批次
// zip: 解析 Central Directory,解压 store/deflate 条目中的图片(及嵌套 PDF)。
// PDF: 三种形态统一出图 —
//   1. 扫描件(每页一张内嵌 JPEG): 原字节直通,零再压缩;
//   2. 电子排版/Flate 图/图文混排: pdfjs 逐页栅格化为 JPEG(pdf-rasterize);
//   3. pdfjs 都打不开的损坏件: 裸抽内嵌 JPEG 兜底,抽不到才报错。
// 批次口径: PDF 每页一批(多学生合并 PDF 拆份);zip 散图按文件名归组保留。
// 纯函数 + 落临时文件,供 grading-service.importPapers 与对话批改工具复用。
// =============================================================

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { groupPaperImportPaths } from '@shared/grading-helpers'
import { openPdf } from './pdf-rasterize'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
const MAX_ZIP_FILES = 500
const MAX_ENTRY_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const MIN_JPEG_BYTES = 8 * 1024
/**
 * 单个 PDF 渲染页数上限(zip 内每个 PDF 独立计数)。
 * 200 页渲染耗时约 1s/页,超限报错文案引导拆分后再导入。
 */
const MAX_PDF_PAGES = 200

export function isZipPath(p: string): boolean {
  return path.extname(p).toLowerCase() === '.zip'
}

export function isPdfPath(p: string): boolean {
  return path.extname(p).toLowerCase() === '.pdf'
}

export function isImagePath(p: string): boolean {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase())
}

/** 从扫描 PDF 抽出内嵌 JPEG(SOI…EOI)。太小的当缩略图丢掉。 */
export function extractJpegsFromPdf(buf: Buffer): Buffer[] {
  const out: Buffer[] = []
  let i = 0
  while (i < buf.length - 3) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      let j = i + 3
      while (j < buf.length - 1) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const jpeg = buf.subarray(i, j + 2)
          if (jpeg.length >= MIN_JPEG_BYTES) out.push(Buffer.from(jpeg))
          i = j + 2
          break
        }
        j++
      }
      if (j >= buf.length - 1) break
    } else {
      i++
    }
  }
  return dedupeByPrefix(out)
}

function dedupeByPrefix(bufs: Buffer[]): Buffer[] {
  const seen = new Set<string>()
  const out: Buffer[] = []
  for (const b of bufs) {
    const key = `${b.length}:${b.subarray(0, 24).toString('hex')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(b)
  }
  return out
}

/** 读 JPEG SOF 段的像素尺寸;格式异常返回 null */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    if (i + 4 > buf.length) break
    const segLen = buf.readUInt16BE(i + 2)
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    }
    i += 2 + segLen
  }
  return null
}

/** JPEG 像素尺寸是否铺满页面(≥ 页面 pt 尺寸的一半) — 判定"整页照片"用 */
function coversPage(jpeg: Buffer, page: { width: number; height: number } | undefined): boolean {
  if (!page) return false
  const size = jpegSize(jpeg)
  if (!size) return false
  return size.width >= page.width * 0.5 && size.height >= page.height * 0.5
}

/**
 * 任意 PDF → 每页一张 JPEG。判定顺序:
 * 内嵌 JPEG 数 == 页数且每张铺满对应页 → 扫描件直通(保留原始扫描字节);
 * 否则 pdfjs 栅格化全部页;pdfjs 打不开时裸抽内嵌 JPEG 兜底。
 * maxPages 可压低渲染页上限(样卷场景远小于整卷导入)。
 */
export async function pdfToPageJpegs(
  buf: Buffer,
  label: string,
  maxPages: number = MAX_PDF_PAGES,
): Promise<Buffer[]> {
  let handle: Awaited<ReturnType<typeof openPdf>>
  try {
    handle = await openPdf(buf)
  } catch (err) {
    const salvaged = extractJpegsFromPdf(buf)
    if (salvaged.length > 0) return salvaged.slice(0, maxPages)
    throw new Error(`PDF「${label}」${err instanceof Error ? err.message : '无法解析'}`)
  }
  try {
    const embedded = extractJpegsFromPdf(buf)
    if (embedded.length === handle.numPages) {
      if (handle.numPages > maxPages) {
        throw new Error(`共 ${handle.numPages} 页,超过 ${maxPages} 页上限,请拆分后再导入`)
      }
      const sizes = await handle.getPageSizes()
      if (embedded.every((jpeg, i) => coversPage(jpeg, sizes[i]))) {
        return embedded
      }
    }
    const rendered = await handle.renderAllPages(maxPages)
    return rendered.map((p) => p.jpeg)
  } finally {
    await handle.destroy()
  }
}

interface ZipEntry {
  name: string
  method: number
  compressed: Buffer
  uncompressedSize: number
}

/**
 * 解压 zip 中的文件(仅 store=0 / deflate=8;拒绝 zip64 / 路径穿越)。
 * 返回条目名(用 / 分隔)与原始字节。
 */
export function unzipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const eocd = findEocd(buf)
  if (!eocd) throw new Error('不是有效的 zip(找不到目录结尾)')
  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count > MAX_ZIP_FILES) throw new Error(`zip 内文件过多(${count},上限 ${MAX_ZIP_FILES})`)
  if (cdOffset + cdSize > buf.length) throw new Error('zip 目录损坏')

  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error('zip 中央目录损坏')
    }
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const nameBuf = buf.subarray(p + 46, p + 46 + nameLen)
    const utf8 = (flags & 0x800) !== 0
    const name = decodeZipName(nameBuf, utf8)
    p += 46 + nameLen + extraLen + commentLen
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) {
      throw new Error('暂不支持 zip64')
    }
    if (name.endsWith('/') || name.endsWith('\\')) continue
    if (unsafeZipPath(name)) throw new Error(`zip 含非法路径: ${name}`)
    if (uncompSize > MAX_ENTRY_BYTES) {
      throw new Error(`zip 内文件过大: ${name}`)
    }
    const local = readLocalPayload(buf, localOff, compSize)
    entries.push({ name, method, compressed: local, uncompressedSize: uncompSize })
  }

  let total = 0
  const out: Array<{ name: string; data: Buffer }> = []
  for (const e of entries) {
    const data = inflateEntry(e)
    total += data.length
    if (total > MAX_TOTAL_BYTES) throw new Error('zip 解压后超过 200MB 上限')
    out.push({ name: e.name, data })
  }
  return out
}

function decodeZipName(nameBuf: Buffer, utf8: boolean): string {
  if (utf8) return nameBuf.toString('utf8')
  // CP437 不引入额外依赖: ASCII 范围原样,高位按 latin1 读(中文 WinRAR 通常会设 UTF-8 标志)
  return nameBuf.toString('binary')
}

function unsafeZipPath(name: string): boolean {
  const parts = name.split(/[/\\]/)
  return parts.some((seg) => seg === '..') || path.isAbsolute(name)
}

function findEocd(buf: Buffer): number | null {
  // EOCD 最小 22 字节,注释最长 65535
  const min = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  return null
}

function readLocalPayload(buf: Buffer, localOff: number, compSize: number): Buffer {
  if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
    throw new Error('zip 本地头损坏')
  }
  const nameLen = buf.readUInt16LE(localOff + 26)
  const extraLen = buf.readUInt16LE(localOff + 28)
  const dataOff = localOff + 30 + nameLen + extraLen
  if (dataOff + compSize > buf.length) throw new Error('zip 数据越界')
  return buf.subarray(dataOff, dataOff + compSize)
}

function inflateEntry(e: ZipEntry): Buffer {
  if (e.method === 0) return Buffer.from(e.compressed)
  if (e.method === 8) {
    try {
      return inflateRawSync(e.compressed)
    } catch {
      throw new Error(`解压失败: ${e.name}`)
    }
  }
  throw new Error(`不支持的 zip 压缩方法 ${e.method}(${e.name})`)
}

function zipDisplayName(entryPath: string): string {
  return entryPath
    .split(/[/\\]/)
    .filter((s) => s && s !== '.')
    .join('-')
}

export interface MaterializedBatch {
  files: Array<{ path: string; name?: string }>
}

/**
 * 把教师丢进来的路径(图片 / PDF / zip)展开成「一批图片」。
 * PDF(顶层与 zip 内)每页一批 —— 多学生合并 PDF 拆成 N 份单页卷;
 * zip 散图沿用文件名归组(同名多页一份);顶层散图保持一批。
 * 写出的临时文件由调用方在 import 拷贝完成后删除 tmpDir。
 */
export async function materializePaperBatches(
  sources: Array<{ path: string; name?: string }>,
  tmpDir: string,
): Promise<MaterializedBatch[]> {
  await fsp.mkdir(tmpDir, { recursive: true })
  const batches: MaterializedBatch[] = []
  const looseImages: Array<{ path: string; name?: string }> = []
  let seq = 0

  const writeBuf = async (data: Buffer, ext: string, label: string): Promise<string> => {
    seq++
    const dest = path.join(tmpDir, `p${seq}-${safeName(label)}${ext}`)
    await fsp.writeFile(dest, data)
    return dest
  }

  for (const src of sources) {
    const ext = path.extname(src.path).toLowerCase()
    if (ext === '.zip') {
      const zipBuf = await fsp.readFile(src.path)
      const members = unzipEntries(zipBuf)
      const zipImages: string[] = []
      for (const m of members) {
        const mExt = path.extname(m.name).toLowerCase()
        if (IMAGE_EXTS.has(mExt)) {
          const dest = await writeBuf(m.data, mExt || '.jpg', zipDisplayName(m.name))
          zipImages.push(dest)
        } else if (mExt === '.pdf') {
          // 每页一批: 多学生合并 PDF 拆成 N 份单页卷,归组交给 identify 管线
          const pages = await pdfToPageJpegs(m.data, m.name)
          for (const [i, jpeg] of pages.entries()) {
            const dest = await writeBuf(jpeg, '.jpg', `${zipDisplayName(m.name)}-p${i + 1}`)
            batches.push({ files: [{ path: dest, name: path.basename(dest) }] })
          }
        }
      }
      if (zipImages.length > 0) {
        batches.push(...groupPaperImportPaths(zipImages))
      }
    } else if (ext === '.pdf') {
      // 每页一批: 多学生合并 PDF(整班扫描成一个文件)拆成 N 份单页卷,
      // 同一学生的续页由 identify 管线按卷面身份归组合并(appendPaperPages)。
      const pdfBuf = await fsp.readFile(src.path)
      const pages = await pdfToPageJpegs(pdfBuf, path.basename(src.path))
      const base = src.name?.trim() || path.basename(src.path)
      for (const [i, jpeg] of pages.entries()) {
        const dest = await writeBuf(jpeg, '.jpg', `${stripExt(base)}-p${i + 1}`)
        batches.push({ files: [{ path: dest, name: `${stripExt(base)}-p${i + 1}.jpg` }] })
      }
    } else if (IMAGE_EXTS.has(ext)) {
      looseImages.push(src)
    } else {
      throw new Error(`不支持的文件类型 ${ext || '(无扩展名)'}(支持 jpg/png/webp/bmp/pdf/zip)`)
    }
  }

  if (looseImages.length === 1) {
    batches.push({ files: looseImages })
  } else if (looseImages.length > 1) {
    // 同一批里多张散图:保持「一批=一份」语义(导入为同一份),不按文件名拆开
    const sameBatch = sources.length === looseImages.length
    if (sameBatch) batches.push({ files: looseImages })
    else batches.push(...groupPaperImportPaths(looseImages.map((f) => f.path)))
  }
  if (batches.length === 0) throw new Error('没有可导入的试卷图片')
  return batches
}

/**
 * 把已分好的导入批次展开: zip/pdf 变成图片批次,纯图片批次原样保留。
 */
export async function expandImportBatches(
  batches: Array<{ files: Array<{ path: string; name?: string }> }>,
  tmpDir: string,
): Promise<MaterializedBatch[]> {
  const out: MaterializedBatch[] = []
  for (const batch of batches) {
    const archives: Array<{ path: string; name?: string }> = []
    const images: Array<{ path: string; name?: string }> = []
    for (const f of batch.files) {
      const ext = path.extname(f.path).toLowerCase()
      if (ext === '.zip' || ext === '.pdf') archives.push(f)
      else if (IMAGE_EXTS.has(ext)) images.push(f)
      else throw new Error(`不支持的文件类型 ${ext || '(无扩展名)'}(支持 jpg/png/webp/bmp/pdf/zip)`)
    }
    if (archives.length > 0) {
      out.push(...(await materializePaperBatches(archives, tmpDir)))
    }
    if (images.length > 0) out.push({ files: images })
  }
  if (out.length === 0) throw new Error('没有可导入的试卷图片')
  return out
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '')
}

function safeName(s: string): string {
  const trimmed = s.replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 40)
  return trimmed.length > 0 ? trimmed : 'file'
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ea-grade-'))
  try {
    return await fn(dir)
  } finally {
    await fsp.rm(dir, { recursive: true, force: true })
  }
}
