// =============================================================
// 套打几何(纯函数,无 electron 依赖,主进程/渲染层/测试共用)
// 职责: 把「扫描图坐标系」换算成「打印纸毫米坐标系」:
//   - 4 对点解 3x3 单应矩阵 H(纸角/定位点■/AI四点/人工四点都只是
//     四点的来源不同,换算完全同一条路);
//   - 纸张规格档案(A4/A3/B5/8K/16K),按图片宽高比自动匹配;
//   - 像素↔毫米、0-1 归一化↔像素的换算与合法性检查。
// 方案出处: docs/research/2026-09-14-trace-print-onto-original-paper-research.md
//         docs/research/2026-09-15-overlay-print-annotation-research.md
// =============================================================

export interface QuadPoint {
  x: number
  y: number
}

/** 四点来源: corner=纸角CV / anchors=定位点■ / ai=AI视觉 / manual=人工拖拽 */
export type QuadSource = 'corner' | 'anchors' | 'ai' | 'manual'

/**
 * 一页扫描图的基准四点(图像像素坐标,topleft 起算)。
 * imageWidth/Height 记录检测时的图片原始尺寸 —— AI box 的 0-1 坐标
 * 与四点天然同图,但存档图可能被重新导入,尺寸对不上时按比例重映射。
 */
export interface PageQuad {
  tl: QuadPoint
  tr: QuadPoint
  br: QuadPoint
  bl: QuadPoint
  source: QuadSource
  /** 0–1 置信度(展示与自动降级用;人工四点固定 1) */
  confidence: number
  imageWidth: number
  imageHeight: number
  /** 检测时间(ISO) */
  detectedAt?: string
}

/** 3x3 单应矩阵(行优先 9 元,h[8]=1) */
export type Homography = readonly number[]

/** 用高斯消元(部分主元)解 n*n 线性方程组;奇异返回 null */
function solveLinear(matrix: number[][], vec: number[]): number[] | null {
  const n = vec.length
  const a = matrix.map((row, i) => [...row, vec[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null
    if (pivot !== col) {
      const t = a[pivot]
      a[pivot] = a[col]
      a[col] = t
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col]
      if (f === 0) continue
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c]
    }
  }
  const out = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = a[r][n]
    for (let c = r + 1; c < n; c++) s -= a[r][c] * out[c]
    out[r] = s / a[r][r]
    if (!Number.isFinite(out[r])) return null
  }
  return out
}

/**
 * 4 对不共线的对应点解单应矩阵(DLT 直接线性法)。
 * src/dst 均为 4 点;退化(共线/重合)返回 null。
 */
export function solveHomography(src: QuadPoint[], dst: QuadPoint[]): Homography | null {
  if (src.length !== 4 || dst.length !== 4) return null
  const rows: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x: u, y: v } = src[i]
    const { x, y } = dst[i]
    // x = (h0u+h1v+h2)/(h6u+h7v+1) → 两行方程
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x])
    rhs.push(x)
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y])
    rhs.push(y)
  }
  const h = solveLinear(rows, rhs)
  if (!h) return null
  return [...h, 1] as Homography
}

/** 用 H 映射单点 */
export function mapPoint(h: Homography, p: QuadPoint): QuadPoint {
  const d = h[6] * p.x + h[7] * p.y + h[8]
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d }
}

// ===== 纸张规格档案 =====

export interface PaperSpec {
  id: string
  /** 展示名 */
  label: string
  widthMm: number
  heightMm: number
}

/** 常见试卷/答题卡规格(竖向口径;8K/16K 为正度近似值) */
export const PAPER_SPECS: PaperSpec[] = [
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'b5', label: 'B5', widthMm: 176, heightMm: 250 },
  { id: '8k', label: '8K', widthMm: 270, heightMm: 390 },
  { id: '16k', label: '16K', widthMm: 195, heightMm: 270 },
]

export const DEFAULT_PAPER_SPEC_ID = 'a4'

export function paperSpecById(id: string | undefined): PaperSpec {
  return PAPER_SPECS.find((s) => s.id === id) ?? PAPER_SPECS[0]
}

/**
 * 按图片宽高比匹配纸张规格(容差 4.5%)。
 * 返回最接近的规格;横拍照片匹配不上竖向规格时返回 null(交上层做旋转判定)。
 */
export function matchPaperSpec(
  widthPx: number,
  heightPx: number,
): { spec: PaperSpec; delta: number } | null {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return null
  }
  const ratio = widthPx / heightPx
  let best: { spec: PaperSpec; delta: number } | null = null
  for (const spec of PAPER_SPECS) {
    const delta = Math.abs(ratio - spec.widthMm / spec.heightMm) / (spec.widthMm / spec.heightMm)
    if (delta <= 0.045 && (!best || delta < best.delta)) best = { spec, delta }
  }
  return best
}

// ===== 四点合法性/定向 =====

/** 四边形面积(鞋带公式,像素²) */
export function quadAreaPx(q: Pick<PageQuad, 'tl' | 'tr' | 'br' | 'bl'>): number {
  const pts = [q.tl, q.tr, q.br, q.bl]
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % 4]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/**
 * 四点是否可用: 坐标有限、面积占图片 12% 以上、四边都超过对角线的 8%
 * (过小的碎片/贴边的误检都能挡住)。上界不设 1.0 —— 扫描件纸面铺满
 * 整图(coverage=1)是合法常态。
 */
export function quadIsUsable(quad: PageQuad): boolean {
  const pts = [quad.tl, quad.tr, quad.br, quad.bl]
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  if (!Number.isFinite(quad.imageWidth) || quad.imageWidth <= 0) return false
  if (!Number.isFinite(quad.imageHeight) || quad.imageHeight <= 0) return false
  const coverage = quadAreaPx(quad) / (quad.imageWidth * quad.imageHeight)
  if (coverage < 0.12 || coverage > 1.0001) return false
  const diag1 = Math.hypot(quad.tr.x - quad.bl.x, quad.tr.y - quad.bl.y)
  const diag2 = Math.hypot(quad.tl.x - quad.br.x, quad.tl.y - quad.br.y)
  const minEdge = Math.min(diag1, diag2) * 0.08
  const edges = [
    [quad.tl, quad.tr],
    [quad.tr, quad.br],
    [quad.br, quad.bl],
    [quad.bl, quad.tl],
  ] as const
  return edges.every(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) > minEdge)
}

/** 四点顺时针旋转一格: tl→tr→br→bl 重新标注 */
function rotateQuadOnce(q: PageQuad): PageQuad {
  return { ...q, tl: q.bl, tr: q.tl, br: q.tr, bl: q.br }
}

/**
 * 定向修正: 检测出的四点是「图片空间」的左上/右上…,若卷子横放,
 * 与竖向纸张规格对不上 —— 按宽高比把标注旋转 90°(顺/逆时针择优)。
 * 只解决 90° 横竖问题;180° 倒放照片无法从几何判断,靠预览发现/人工四点。
 */
export function orientQuadForSpec(quad: PageQuad, spec: PaperSpec): PageQuad {
  const w = Math.abs(quad.tr.x - quad.tl.x) + Math.abs(quad.br.x - quad.bl.x)
  const h = Math.abs(quad.bl.y - quad.tl.y) + Math.abs(quad.br.y - quad.tr.y)
  if (w <= 0 || h <= 0) return quad
  const landscape = w > h
  const specLandscape = spec.widthMm > spec.heightMm
  if (landscape === specLandscape) return quad
  // 旋转后哪个方向更接近规格宽高比,就转哪边
  const r1 = { ...quad, tl: quad.bl, tr: quad.tl, br: quad.tr, bl: quad.br }
  const r2 = rotateQuadOnce(r1)
  const target = spec.widthMm / spec.heightMm
  const ratio = (x: PageQuad) =>
    Math.abs((Math.abs(x.tr.x - x.tl.x) / Math.abs(x.bl.y - x.tl.y) || 1) - target)
  return ratio(r1) <= ratio(r2) ? r1 : r2
}

/**
 * 解「四点像素 → 纸张毫米」的单应;定向修正后再解。
 * 返回 mapper: 输入该页 0-1 归一化坐标,输出毫米坐标(可能越出纸面,由调用方钳制)。
 */
export function quadToPaperMapper(
  quad: PageQuad,
  spec: PaperSpec,
): ((x01: number, y01: number) => QuadPoint) | null {
  const q = orientQuadForSpec(quad, spec)
  const src = [q.tl, q.tr, q.br, q.bl]
  const dst = [
    { x: 0, y: 0 },
    { x: spec.widthMm, y: 0 },
    { x: spec.widthMm, y: spec.heightMm },
    { x: 0, y: spec.heightMm },
  ]
  const h = solveHomography(src, dst)
  if (!h) return null
  return (x01: number, y01: number) =>
    mapPoint(h, { x: x01 * quad.imageWidth, y: y01 * quad.imageHeight })
}

/** 四点存档后图片尺寸变了(重新导入): 按比例重映射到新尺寸 */
export function rescaleQuad(quad: PageQuad, newWidth: number, newHeight: number): PageQuad {
  if (quad.imageWidth === newWidth && quad.imageHeight === newHeight) return quad
  const sx = newWidth / quad.imageWidth
  const sy = newHeight / quad.imageHeight
  const p = (pt: QuadPoint): QuadPoint => ({ x: pt.x * sx, y: pt.y * sy })
  return {
    ...quad,
    tl: p(quad.tl),
    tr: p(quad.tr),
    br: p(quad.br),
    bl: p(quad.bl),
    imageWidth: newWidth,
    imageHeight: newHeight,
  }
}

/** 毫米 → CSS pt(1mm = 2.8346pt) */
export function mmToPt(mm: number): number {
  return mm * 2.834645669
}

/** Electron print 原生支持的纸张名 */
const ELECTRON_PAGE_SIZES: Partial<Record<string, 'A4' | 'A3'>> = {
  a4: 'A4',
  a3: 'A3',
}

/**
 * 纸张规格 → webContents.print 的 pageSize 参数:
 * A4/A3 用原生枚举,其余(B5/8K/16K)按微米自定义(1mm = 1000μm)。
 */
export function paperSpecToPrintPageSize(
  spec: PaperSpec,
): 'A4' | 'A3' | { width: number; height: number } {
  const native = ELECTRON_PAGE_SIZES[spec.id]
  if (native) return native
  return { width: Math.round(spec.widthMm * 1000), height: Math.round(spec.heightMm * 1000) }
}
