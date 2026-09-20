// =============================================================
// Sample Ingest — 样卷文件统一摄取(输入格式兼容面)
// 图片 / PDF / docx / md / txt / xlsx / xls / csv / yaml / zip:
//   - 图片与 PDF 出图,docx 抽正文文本 + 内嵌图片(word/media);
//   - 表格(xlsx/xls/csv)经 SheetJS sheet_to_csv 序列化为 Markdown
//     表格文本(表格出文本比出图省 token 且更准);
//   - yaml 原样文本;zip 经 unzipEntries 解开(深度 1 层)成员按
//     扩展名走同逻辑,产出计入 maxFileBytes/maxImages。
// 类型自动识别: 扩展名缺失/误标时按魔数纠正(%PDF / PK+内部结构 /
// 图片魔数);文本解码 utf8 严格校验失败且含 GBK 双字节特征时用
// TextDecoder('gbk') 兜底(中文占比 sanity 防误转)。
// 所有入模图片统一过 downscaleToAiJpeg(长边 ≤1600 JPEG,控 token)。
// 输出 { images, text } 由调用方组装 text+image 混排消息;
// 纯函数(分类/嗅探/解码/序列化)单独导出以便测试。
// =============================================================

import fsp from 'node:fs/promises'
import path from 'node:path'
import { pdfToPageJpegs, unzipEntries } from './archive-import'
import { downscaleToAiJpeg } from './media-prep'

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

const TEXT_EXTS = new Set(['.md', '.txt', '.yaml', '.yml'])
const SHEET_EXTS = new Set(['.xlsx', '.xls', '.csv'])

export function isImageExt(ext: string): boolean {
  return ext in IMAGE_MIME
}

/** 样卷摄取支持的扩展名(图片/PDF/docx/表格/文本/zip) */
export function isSampleExt(ext: string): boolean {
  return (
    isImageExt(ext) ||
    ext === '.pdf' ||
    ext === '.docx' ||
    SHEET_EXTS.has(ext) ||
    TEXT_EXTS.has(ext) ||
    ext === '.zip'
  )
}

/** 内部分派类型(zip 成员与顶层文件共用同一路由) */
type SampleKind = 'image' | 'pdf' | 'docx' | 'xlsx' | 'text' | 'zip'

function extToKind(ext: string): SampleKind | null {
  if (isImageExt(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.docx') return 'docx'
  if (SHEET_EXTS.has(ext)) return 'xlsx'
  if (TEXT_EXTS.has(ext)) return 'text'
  if (ext === '.zip') return 'zip'
  return null
}

// ===== 魔数嗅探(纯函数,导出测试) =====

/** 图片魔数 → mime;非图片返回 null */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png'
  }
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  return null
}

function isZipMagic(buf: Buffer): boolean {
  return buf.length >= 4 && buf.toString('latin1', 0, 4) === 'PK\x03\x04'
}

/** .xls 的 OLE2 复合文档魔数(D0 CF 11 E0) */
function isOle2Magic(buf: Buffer): boolean {
  return (
    buf.length >= 8 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0 &&
    buf[4] === 0xa1 &&
    buf[5] === 0xb1 &&
    buf[6] === 0x1a &&
    buf[7] === 0xe1
  )
}

/**
 * 按魔数识别样卷类型: %PDF→pdf;PK\x03\x04 按内部结构辨
 * docx(有 word/)/xlsx(有 xl/)/zip(其余);图片魔数→image。
 * 识别不了(含普通文本)返回 null,由调用方报教师可读错误。
 */
export function sniffSampleKind(buf: Buffer): SampleKind | null {
  if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') return 'pdf'
  const imageMime = sniffImageMime(buf)
  if (imageMime) return 'image'
  if (isZipMagic(buf)) {
    try {
      const names = unzipEntries(buf).map((e) => e.name)
      if (names.some((n) => n.startsWith('word/'))) return 'docx'
      if (names.some((n) => n.startsWith('xl/'))) return 'xlsx'
      return 'zip'
    } catch {
      return null // zip 结构损坏: 交给上层报无法识别
    }
  }
  return null
}

// ===== 文本解码(纯函数,导出测试) =====

/** 解码文本里的 CJK 字符占非空白字符比(GBK 兜底的 sanity 阈值用) */
function chineseRatio(s: string): number {
  let cjk = 0
  let total = 0
  for (const ch of s) {
    if (/\s/.test(ch)) continue
    total++
    if (/[\u4e00-\u9fff]/.test(ch)) cjk++
  }
  return total === 0 ? 0 : cjk / total
}

/** 含 GBK 双字节特征(存在 0x81-0xFE 高位字节) */
function hasGbkDoubleByteFeature(buf: Buffer): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] >= 0x81) return true
  }
  return false
}

/**
 * 文本字节 → 字符串: utf8 严格校验通过直接解码;失败且含 GBK 双字节
 * 特征时用 TextDecoder('gbk') 解码,并以中文占比 sanity(≥0.05)防把
 * 任意二进制误转成乱码;都失败按 utf8 替换字符兜底(不抛错)。
 */
export function decodeTextBuffer(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    if (hasGbkDoubleByteFeature(buf)) {
      try {
        const decoded = new TextDecoder('gbk').decode(buf)
        if (chineseRatio(decoded) >= 0.05) return decoded
      } catch {
        /* gbk 不可用(小 ICU 构建) */
      }
    }
    return buf.toString('utf8')
  }
}

// ===== 表格 → Markdown 表格文本(纯函数,导出测试) =====

/** CSV 文本 → 行×列(处理引号包裹/内嵌逗号换行;SheetJS sheet_to_csv 输出) */
export function splitCsvRows(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (ch !== '\r') cell += ch
  }
  if (quoted || cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** CSV 文本 → Markdown 表格(首行作表头,单元格转义 | 与换行);空表返回 '' */
export function csvToMarkdownTable(csv: string): string {
  const rows = splitCsvRows(csv).filter((r) => r.some((c) => c.trim().length > 0))
  if (rows.length === 0) return ''
  const line = (cells: string[]) =>
    `| ${cells.map((c) => c.trim().replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')).join(' | ')} |`
  const header = rows[0]
  const sep = `| ${header.map(() => '---').join(' | ')} |`
  return [line(header), sep, ...rows.slice(1).map(line)].join('\n')
}

/** 表格字节(xlsx/xls/csv) → Markdown 文本(每表一节 ## 表名 + 表格);坏文件/空表抛教师可读错误 */
async function workbookToMarkdownText(buf: Buffer, label: string): Promise<string> {
  const XLSX = await import('xlsx')
  // 结构路由: xlsx=zip、xls=OLE2 走二进制;csv 走文本(GBK 兜底解码,
  // SheetJS 对字节输入默认按 cp1252 读,中文 utf8 csv 会乱码)
  const asBinary = isZipMagic(buf) || isOle2Magic(buf)
  let wb: import('xlsx').WorkBook
  try {
    wb = asBinary
      ? XLSX.read(buf, { type: 'buffer' })
      : XLSX.read(decodeTextBuffer(buf), { type: 'string' })
  } catch (err) {
    throw new Error(`表格解析失败(${label}): ${err instanceof Error ? err.message : '无法读取'}`)
  }
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const table = csvToMarkdownTable(XLSX.utils.sheet_to_csv(wb.Sheets[name]))
    if (table.length > 0) parts.push(`## ${name}\n${table}`)
  }
  if (parts.length === 0) throw new Error(`表格没有可读数据: ${label}`)
  return parts.join('\n\n')
}

// ===== 解析辅助 =====

/** docx → 正文纯文本(mammoth)。IO/格式错误转教师可读提示。 */
async function docxText(buf: Buffer, label: string): Promise<string> {
  try {
    const mammoth = (await import('mammoth')).default
    const { value } = await mammoth.extractRawText({ buffer: buf })
    return value
  } catch (err) {
    throw new Error(
      `Word 文档解析失败(${label}): ${err instanceof Error ? err.message : '无法读取'}`,
    )
  }
}

/** docx(zip)已解条目 → 内嵌图片字节(word/media/*) */
function docxMediaImages(
  entries: Array<{ name: string; data: Buffer }>,
): Array<{ data: Buffer; mimeType: string }> {
  const out: Array<{ data: Buffer; mimeType: string }> = []
  for (const entry of entries) {
    if (!entry.name.startsWith('word/media/')) continue
    const ext = path.extname(entry.name).toLowerCase()
    const mime = IMAGE_MIME[ext] ?? sniffImageMime(entry.data)
    if (!mime) continue
    out.push({ data: entry.data, mimeType: mime })
  }
  return out
}

/**
 * 安全约束: zip+XML 家族(docx/xlsx)解析前拒绝 DOCTYPE/ENTITY 声明
 * (防 XXE;解析器本身不启用外部实体,这里显式拒收带声明的文件)。
 * 只检查 xml/rels 成员的前 64KB。
 */
function assertNoXmlEntities(entries: Array<{ name: string; data: Buffer }>, label: string): void {
  for (const entry of entries) {
    if (!/\.(xml|rels)$/i.test(entry.name)) continue
    const head = entry.data.subarray(0, 65536).toString('latin1')
    if (/<!DOCTYPE|<!ENTITY/i.test(head)) {
      throw new Error(`文件包含 DOCTYPE/ENTITY 声明,已拒绝解析(${label}: ${entry.name})`)
    }
  }
}

interface IngestSink {
  images: IngestImage[]
  textParts: string[]
}

/** 按类型分派摄取;深度 0=顶层文件,1=zip 成员(zip 内 zip 在此拒绝) */
async function ingestBuffer(
  buf: Buffer,
  ext: string,
  label: string,
  opts: IngestOptions,
  sink: IngestSink,
  depth: number,
): Promise<void> {
  const kind = extToKind(ext) ?? sniffSampleKind(buf)
  if (!kind) {
    throw new Error(
      `不支持的样卷格式: ${label}(支持 jpg/png/webp/bmp/pdf/docx/xlsx/xls/csv/md/txt/yaml/zip)`,
    )
  }
  try {
    await dispatchKind(kind, buf, ext, label, opts, sink, depth)
  } catch (err) {
    // 扩展名误标(如 .xlsx 实为 PDF)时按魔数纠正重试一次
    const sniffed = sniffSampleKind(buf)
    if (sniffed && sniffed !== kind) {
      await dispatchKind(sniffed, buf, ext, label, opts, sink, depth)
      return
    }
    throw err
  }
}

async function dispatchKind(
  kind: SampleKind,
  buf: Buffer,
  ext: string,
  label: string,
  opts: IngestOptions,
  sink: IngestSink,
  depth: number,
): Promise<void> {
  const pushText = (text: string) => {
    const trimmed = text.trim()
    if (trimmed.length > 0) sink.textParts.push(`# ${label}\n${trimmed}`)
  }
  const pushImage = async (data: Buffer, mimeType: string) => {
    // 入模图片统一降采样(直读/PDF 页/内嵌图/zip 抽出图同口径)
    sink.images.push(await downscaleToAiJpeg(data, mimeType))
    if (sink.images.length > opts.maxImages) {
      throw new Error(`样卷图片合计 ${sink.images.length} 张,超过 ${opts.maxImages} 张上限`)
    }
  }

  switch (kind) {
    case 'image': {
      await pushImage(buf, IMAGE_MIME[ext] ?? sniffImageMime(buf) ?? 'image/jpeg')
      break
    }
    case 'pdf': {
      const pages = await pdfToPageJpegs(buf, label, opts.maxPdfPages)
      for (const page of pages) {
        await pushImage(page, 'image/jpeg')
      }
      break
    }
    case 'docx': {
      const entries = unzipEntries(buf)
      assertNoXmlEntities(entries, label)
      pushText(await docxText(buf, label))
      for (const img of docxMediaImages(entries)) {
        await pushImage(img.data, img.mimeType)
      }
      break
    }
    case 'xlsx': {
      // 扩展名误标前置门: SheetJS 对任意字节都按 CSV 宽容解析,不会报错,
      // 魔数明确不是表格(pdf/图片/docx/zip)时先抛,让上层按魔数纠正路由。
      const sniffed = sniffSampleKind(buf)
      if (sniffed !== null && sniffed !== 'xlsx') {
        throw new Error(`表格解析失败(${label}): 文件内容不是表格`)
      }
      // .xls 是 OLE2 不是 zip,只有 PK 魔数才做 XML 实体检查
      if (isZipMagic(buf)) {
        try {
          assertNoXmlEntities(unzipEntries(buf), label)
        } catch (err) {
          if (err instanceof Error && err.message.includes('DOCTYPE')) throw err
          // zip 结构异常交给 XLSX.read 报表格解析失败
        }
      }
      pushText(await workbookToMarkdownText(buf, label))
      break
    }
    case 'text': {
      // 同前置门: .txt/.md/.yaml 实为 PDF/图片/docx 时按魔数纠正
      const sniffed = sniffSampleKind(buf)
      if (sniffed !== null) {
        throw new Error(`文本读取失败(${label}): 文件内容不是文本`)
      }
      pushText(decodeTextBuffer(buf))
      break
    }
    case 'zip': {
      if (depth >= 1) {
        throw new Error(`zip 内不支持再嵌套 zip,请把内层压缩包解开后再重新打包: ${label}`)
      }
      const skipped: string[] = []
      for (const member of unzipEntries(buf)) {
        const memberExt = path.extname(member.name).toLowerCase()
        const memberLabel = `${label}/${member.name}`
        if (memberExt === '.zip') {
          throw new Error(`zip 内不支持再嵌套 zip,请把内层压缩包解开后再重新打包: ${memberLabel}`)
        }
        if (member.data.length > opts.maxFileBytes) {
          throw new Error(
            `zip 内文件超过 ${opts.maxFileBytes / 1024 / 1024}MB 上限: ${memberLabel}`,
          )
        }
        try {
          await ingestBuffer(member.data, memberExt, memberLabel, opts, sink, depth + 1)
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('不支持的样卷格式')) {
            skipped.push(member.name) // zip 里的杂项(readme.exe 等)跳过不阻断
            continue
          }
          throw err
        }
      }
      if (skipped.length > 0) {
        sink.textParts.push(`# ${label}\nzip 内未识别的文件已跳过: ${skipped.join('、')}`)
      }
      break
    }
  }
}

/**
 * 样卷文件 → AI 输入素材。逐文件校验(存在/大小/类型),
 * 图片直读、PDF 栅格化(≤maxPdfPages)、docx 抽文本+内嵌图、表格序列化
 * 为 Markdown、文本原样(GBK 兜底)、zip 解开成员同规则(深度 1 层);
 * 图片合计超 maxImages 报错(防 token 爆炸)。
 */
export async function ingestSampleFiles(
  paths: string[],
  opts: IngestOptions,
): Promise<IngestedSample> {
  const sink: IngestSink = { images: [], textParts: [] }

  for (const p of paths) {
    const ext = path.extname(p).toLowerCase()
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
    await ingestBuffer(buf, ext, label, opts, sink, 0)
  }

  return { images: sink.images, text: sink.textParts.join('\n\n') }
}
