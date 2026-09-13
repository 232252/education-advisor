// =============================================================
// PDF Rasterize — 任意 PDF(电子排版/扫描/Flate 图) → 每页一张 JPEG
// pdfjs-dist(legacy 纯 JS 解析) + @napi-rs/canvas(Skia N-API 预编译,随包分发)。
// 懒加载 dynamic import: 不碰 PDF 的场景零开销;cmaps(CJK 编码映射)与
// standard_fonts 经 createRequire 定位,Electron 主进程 fs 对 asar 透明,
// 打包态同样可读。调用方(archive-import)负责扫描件 JPEG 直通的快速路径,
// 这里只管"把每一页画出来"。
// =============================================================

import { createRequire } from 'node:module'
import path from 'node:path'

const requireFromHere = createRequire(import.meta.url)

/** 渲染目标长边像素: A4→300dpi;A3 自动降到约 254dpi(视觉模型足够) */
const TARGET_LONG_SIDE_PX = 3508
const MIN_SCALE = 1.5
const MAX_SCALE = 6
const JPEG_QUALITY = 0.85

export interface PdfPageSize {
  width: number
  height: number
}

export interface PdfPageImage {
  jpeg: Buffer
  width: number
  height: number
}

export interface PdfHandle {
  numPages: number
  /** 每页 viewport(scale=1) 尺寸(pt),懒加载缓存;下标 0 起 */
  getPageSizes(): Promise<PdfPageSize[]>
  renderAllPages(maxPages: number): Promise<PdfPageImage[]>
  destroy(): Promise<void>
}

// pdfjs-dist 的类型声明不随子路径导出,这里只声明用到的最小结构;
// 字段与 pdfjs-dist/legacy/build/pdf.mjs 的公开 API 一一对应。
interface PdfjsModule {
  getDocument: (src: Record<string, unknown>) => PdfjsLoadingTask
}

interface PdfjsLoadingTask {
  promise: Promise<PdfjsDocument>
  /** v6 起 destroy 在 loadingTask 上(PDFDocumentProxy.destroy 已移除) */
  destroy: () => Promise<void>
}

interface PdfjsDocument {
  numPages: number
  getPage: (n: number) => Promise<PdfjsPage>
  canvasFactory?: PdfjsCanvasFactory
}

interface PdfjsPage {
  getViewport: (opts: { scale: number }) => PdfPageSize
  render: (ctx: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
    promise: Promise<void>
  }
  cleanup: () => void
}

interface CanvasAndContext {
  canvas: { toBuffer: (format: 'image/jpeg', quality: number) => Buffer }
  context: CanvasRenderingContext2D
}

interface PdfjsCanvasFactory {
  create: (w: number, h: number) => CanvasAndContext
  destroy: (c: CanvasAndContext) => void
}

let loader: Promise<{ pdfjs: PdfjsModule; cMapUrl?: string; standardFontDataUrl?: string }> | null =
  null

function loadPdfjs() {
  loader ??= (async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule
    // 资源目录定位失败不阻塞渲染(个别 CJK PDF 缺 cmap 时字体回退)。
    // pdfjs v6 要求 URL 以 / 结尾: Windows 路径统一转正斜杠(fs 与 URL 解析都认)。
    let cMapUrl: string | undefined
    let standardFontDataUrl: string | undefined
    try {
      const root = path.resolve(
        path.dirname(requireFromHere.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
        '..',
        '..',
      )
      cMapUrl = `${root.replace(/\\/g, '/')}/cmaps/`
      standardFontDataUrl = `${root.replace(/\\/g, '/')}/standard_fonts/`
    } catch {
      // 解析不到资源目录 → 裸跑
    }
    return { pdfjs, cMapUrl, standardFontDataUrl }
  })()
  return loader
}

/** 加密/损坏等 pdfjs 报错 → 教师可读的中文提示 */
function readablePdfError(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'PasswordException') {
    return '设有密码,请先另存为无密码 PDF 再导入'
  }
  if (name === 'InvalidPDFException') {
    return '不是有效的 PDF 文件'
  }
  const msg = err instanceof Error ? err.message : String(err)
  return `无法解析(${msg})`
}

export async function openPdf(buf: Buffer): Promise<PdfHandle> {
  const { pdfjs, cMapUrl, standardFontDataUrl } = await loadPdfjs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    // 教师本地文件也可能是网上下载的: 关掉 eval 化的 PostScript 字体路径
    isEvalSupported: false,
  })
  let doc: PdfjsDocument
  try {
    doc = await task.promise
  } catch (err) {
    throw new Error(readablePdfError(err))
  }

  let destroyed = false
  let pageSizes: PdfPageSize[] | null = null
  return {
    get numPages() {
      return doc.numPages
    },
    async getPageSizes(): Promise<PdfPageSize[]> {
      pageSizes ??= []
      for (let pageNo = pageSizes.length + 1; pageNo <= doc.numPages; pageNo++) {
        const page = await doc.getPage(pageNo)
        try {
          const v = page.getViewport({ scale: 1 })
          pageSizes.push({ width: v.width, height: v.height })
        } finally {
          page.cleanup()
        }
      }
      return pageSizes
    },
    async renderAllPages(maxPages: number): Promise<PdfPageImage[]> {
      if (destroyed) throw new Error('PDF 已关闭')
      if (doc.numPages > maxPages) {
        throw new Error(`共 ${doc.numPages} 页,超过 ${maxPages} 页上限,请拆分后再导入`)
      }
      const out: PdfPageImage[] = []
      for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
        const page = await doc.getPage(pageNo)
        try {
          const base = page.getViewport({ scale: 1 })
          const scale = Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, TARGET_LONG_SIDE_PX / Math.max(base.width, base.height)),
          )
          const viewport = page.getViewport({ scale })
          const factory = doc.canvasFactory
          if (!factory) throw new Error('canvas 后端不可用(@napi-rs/canvas 未安装)')
          const canvasAndContext = factory.create(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
          )
          try {
            await page.render({ canvasContext: canvasAndContext.context, viewport }).promise
            out.push({
              jpeg: canvasAndContext.canvas.toBuffer('image/jpeg', JPEG_QUALITY),
              width: Math.ceil(viewport.width),
              height: Math.ceil(viewport.height),
            })
          } finally {
            factory.destroy(canvasAndContext)
          }
        } finally {
          page.cleanup()
        }
      }
      return out
    },
    async destroy() {
      if (!destroyed) {
        destroyed = true
        await task.destroy()
      }
    },
  }
}
