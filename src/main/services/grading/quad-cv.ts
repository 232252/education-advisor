// =============================================================
// Quad CV — 基准四点检测的纯函数层(灰度数组进出,无 electron/fs 依赖)
// 三条路径共用:
//   ① 定位点■: 页面外围带内的暗色实心方块(答题卡式,精度最高);
//   ② 纸角: 最大亮区(白纸)的四极值角点(通用,零模板知识);
//   ③ AI 四点: 视觉模型返回 0-1 归一化四角(前两级失手时的自动兜底)。
// 出处: docs/research/2026-09-14..15 套打两份调研报告
// =============================================================

import { type PageQuad, type QuadPoint, quadIsUsable } from '@shared/grading-geometry'

export interface GrayImage {
  gray: Uint8Array
  width: number
  height: number
}

/** RGBA → 灰度(luminance 60/30/10 近似) */
export function rgbaToGray(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): GrayImage {
  const n = width * height
  const gray = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    gray[i] = (r * 0.6 + g * 0.3 + b * 0.1) | 0
  }
  return { gray, width, height }
}

function clampNum(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

function meanOf(gray: Uint8Array, sampleStep = 7): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < gray.length; i += sampleStep) {
    sum += gray[i]
    n++
  }
  return n > 0 ? sum / n : 128
}

// ===== ① 最大亮区(纸面) =====

export interface BrightRegion {
  /** 纸面像素掩码(1=纸) */
  mask: Uint8Array
  count: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * 阈值取 mean+25(夹在 140–235),四邻接 BFS 找最大亮连通域。
 * 纸面占比 < 15% 视为找不到(背景占主导/纸被裁没了)。
 */
export function largestBrightRegion(img: GrayImage): BrightRegion | null {
  const { gray, width, height } = img
  const n = width * height
  const t = clampNum(meanOf(gray) + 25, 140, 235)
  const visited = new Uint8Array(n)
  const stack = new Int32Array(n)
  let best: BrightRegion | null = null
  for (let start = 0; start < n; start++) {
    if (visited[start] || gray[start] < t) continue
    let sp = 0
    stack[sp++] = start
    visited[start] = 1
    let count = 0
    let x0 = width
    let y0 = height
    let x1 = 0
    let y1 = 0
    const compMask = new Uint8Array(n)
    while (sp > 0) {
      const idx = stack[--sp]
      const x = idx % width
      const y = (idx / width) | 0
      compMask[idx] = 1
      count++
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
      // 四邻接
      if (x > 0 && !visited[idx - 1] && gray[idx - 1] >= t) {
        visited[idx - 1] = 1
        stack[sp++] = idx - 1
      }
      if (x < width - 1 && !visited[idx + 1] && gray[idx + 1] >= t) {
        visited[idx + 1] = 1
        stack[sp++] = idx + 1
      }
      if (y > 0 && !visited[idx - width] && gray[idx - width] >= t) {
        visited[idx - width] = 1
        stack[sp++] = idx - width
      }
      if (y < height - 1 && !visited[idx + width] && gray[idx + width] >= t) {
        visited[idx + width] = 1
        stack[sp++] = idx + width
      }
    }
    if (!best || count > best.count) {
      best = { mask: compMask, count, bbox: { x0, y0, x1, y1 } }
    }
  }
  if (!best || best.count < n * 0.15) return null
  return best
}

/** 掩码四角 = x+y / x−y 四极值(tl=min和, tr=max差, br=max和, bl=min差) */
export function maskQuadCorners(
  mask: Uint8Array,
  width: number,
  height: number,
): QuadPoint[] | null {
  let tl: QuadPoint | null = null
  let tr: QuadPoint | null = null
  let br: QuadPoint | null = null
  let bl: QuadPoint | null = null
  let minSum = Number.POSITIVE_INFINITY
  let maxSum = Number.NEGATIVE_INFINITY
  let minDiff = Number.POSITIVE_INFINITY
  let maxDiff = Number.NEGATIVE_INFINITY
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue
      const sum = x + y
      const diff = x - y
      if (sum < minSum) {
        minSum = sum
        tl = { x, y }
      }
      if (sum > maxSum) {
        maxSum = sum
        br = { x, y }
      }
      if (diff > maxDiff) {
        maxDiff = diff
        tr = { x, y }
      }
      if (diff < minDiff) {
        minDiff = diff
        bl = { x, y }
      }
    }
  }
  if (!tl || !tr || !br || !bl) return null
  return [tl, tr, br, bl]
}

// ===== ② 定位点■(暗色实心方块) =====

interface AnchorCandidate {
  cx: number
  cy: number
  area: number
}

/**
 * 在页面 bbox 外围带(每边 25%)内找暗色实心方块候选。
 * 筛选: 面积 20–4000px、bbox 长宽比 0.6–1.6、实心度 ≥ 0.55。
 */
export function anchorCandidates(
  img: GrayImage,
  band: { x0: number; y0: number; x1: number; y1: number },
): AnchorCandidate[] {
  const { gray, width } = img
  const bw = band.x1 - band.x0
  const bh = band.y1 - band.y0
  const inBand = (x: number, y: number): boolean => {
    const relX = (x - band.x0) / bw
    const relY = (y - band.y0) / bh
    return relX <= 0.25 || relX >= 0.75 || relY <= 0.25 || relY >= 0.75
  }
  // 带内均值定暗阈值
  let sum = 0
  let n = 0
  for (let y = band.y0; y <= band.y1; y++) {
    for (let x = band.x0; x <= band.x1; x++) {
      if (inBand(x, y)) {
        sum += gray[y * width + x]
        n++
      }
    }
  }
  const t = n > 0 ? clampNum((sum / n) * 0.55, 30, 110) : 70
  const visited = new Uint8Array(img.width * img.height)
  const stack = new Int32Array(img.width * img.height)
  const out: AnchorCandidate[] = []
  for (let yy = band.y0; yy <= band.y1; yy++) {
    for (let xx = band.x0; xx <= band.x1; xx++) {
      const start = yy * width + xx
      if (visited[start] || gray[start] > t || !inBand(xx, yy)) continue
      let sp = 0
      stack[sp++] = start
      visited[start] = 1
      let count = 0
      let sx = 0
      let sy = 0
      let x0 = width
      let y0 = img.height
      let x1 = 0
      let y1 = 0
      while (sp > 0) {
        const idx = stack[--sp]
        const x = idx % width
        const y = (idx / width) | 0
        if (x < band.x0 || x > band.x1 || y < band.y0 || y > band.y1 || !inBand(x, y)) continue
        count++
        sx += x
        sy += y
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
        if (x > band.x0 && !visited[idx - 1] && gray[idx - 1] <= t) {
          visited[idx - 1] = 1
          stack[sp++] = idx - 1
        }
        if (x < band.x1 && !visited[idx + 1] && gray[idx + 1] <= t) {
          visited[idx + 1] = 1
          stack[sp++] = idx + 1
        }
        if (y > band.y0 && !visited[idx - width] && gray[idx - width] <= t) {
          visited[idx - width] = 1
          stack[sp++] = idx - width
        }
        if (y < band.y1 && !visited[idx + width] && gray[idx + width] <= t) {
          visited[idx + width] = 1
          stack[sp++] = idx + width
        }
      }
      const bwBox = x1 - x0 + 1
      const bhBox = y1 - y0 + 1
      const aspect = bwBox / bhBox
      const fill = count / (bwBox * bhBox)
      if (count >= 20 && count <= 4000 && aspect >= 0.6 && aspect <= 1.6 && fill >= 0.55) {
        out.push({ cx: sx / count, cy: sy / count, area: count })
      }
    }
  }
  return out
}

/** 四象限各取最大候选 → 定位点四点(凑不齐 4 个返回 null) */
export function anchorQuad(
  img: GrayImage,
  pageBbox: { x0: number; y0: number; x1: number; y1: number },
): PageQuad | null {
  const candidates = anchorCandidates(img, pageBbox)
  if (candidates.length < 4) return null
  const bw = pageBbox.x1 - pageBbox.x0
  const bh = pageBbox.y1 - pageBbox.y0
  const cx = (pageBbox.x0 + pageBbox.x1) / 2
  const cy = (pageBbox.y0 + pageBbox.y1) / 2
  // 定位点■必在纸角附近: 距对应两边各 ≤22%(挡住页眉文字/页码误检)
  const nearCorner = (c: AnchorCandidate, left: boolean, top: boolean): boolean =>
    (left ? c.cx - pageBbox.x0 : pageBbox.x1 - c.cx) <= bw * 0.22 &&
    (top ? c.cy - pageBbox.y0 : pageBbox.y1 - c.cy) <= bh * 0.22
  const quad: Array<AnchorCandidate | null> = [null, null, null, null] // tl tr br bl
  for (const c of candidates) {
    const left = c.cx < cx
    const top = c.cy < cy
    const slot = top ? (left ? 0 : 1) : left ? 3 : 2
    if (!nearCorner(c, left, top)) continue
    if (!quad[slot] || c.area > (quad[slot] as AnchorCandidate).area) quad[slot] = c
  }
  if (quad.some((q) => !q)) return null
  const [tl, tr, br, bl] = quad as AnchorCandidate[]
  return {
    tl: { x: tl.cx, y: tl.cy },
    tr: { x: tr.cx, y: tr.cy },
    br: { x: br.cx, y: br.cy },
    bl: { x: bl.cx, y: bl.cy },
    source: 'anchors',
    confidence: 0.95,
    imageWidth: img.width,
    imageHeight: img.height,
  }
}

// ===== ③ AI 四点(解析层;调用在 page-quad-detect) =====

export function buildQuadPrompt(): string {
  return [
    '你是试卷照片定位助手。找出图片中试卷纸张的四个角。',
    '以卷面文字方向为准(把卷子摆正): tl=卷子左上角, tr=右上, br=右下, bl=左下。',
    '坐标为相对图片宽高的 0–1 比例(左上为原点)。',
    '如果图片里看不全四个角(角被裁掉/被遮挡),对应点给出你的最佳估计并尽量贴近纸边。',
    '只输出 JSON,不要解释,格式:',
    '{"tl":{"x":0.04,"y":0.03},"tr":{"x":0.96,"y":0.05},"br":{"x":0.95,"y":0.97},"bl":{"x":0.05,"y":0.96}}',
  ].join('\n')
}

/** 解析 AI 四点输出(0-1 → 像素);非法返回 null */
export function parseQuadResponse(
  text: string,
  imageWidth: number,
  imageHeight: number,
): PageQuad | null {
  const stripped = text.replace(/```(?:json)?/gi, '').trim()
  const braceStart = stripped.indexOf('{')
  const braceEnd = stripped.lastIndexOf('}')
  if (braceStart < 0 || braceEnd <= braceStart) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.slice(braceStart, braceEnd + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const r = parsed as Record<string, unknown>
  const pt = (v: unknown): QuadPoint | null => {
    if (typeof v !== 'object' || v === null) return null
    const o = v as Record<string, unknown>
    const x = Number(o.x)
    const y = Number(o.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return {
      x: clampNum(x, 0, 1) * imageWidth,
      y: clampNum(y, 0, 1) * imageHeight,
    }
  }
  const tl = pt(r.tl)
  const tr = pt(r.tr)
  const br = pt(r.br)
  const bl = pt(r.bl)
  if (!tl || !tr || !br || !bl) return null
  return {
    tl,
    tr,
    br,
    bl,
    source: 'ai',
    confidence: 0.75,
    imageWidth,
    imageHeight,
  }
}

// ===== 组装 =====

/** 一张灰度图 → 优先定位点■、退纸角;均不可用返回 null */
export function detectQuadInGray(img: GrayImage): PageQuad | null {
  const region = largestBrightRegion(img)
  if (region) {
    const anchors = anchorQuad(img, region.bbox)
    if (anchors && quadIsUsable(anchors)) return anchors
    const corners = maskQuadCorners(region.mask, img.width, img.height)
    if (corners) {
      const [tl, tr, br, bl] = corners
      const coverage = region.count / (img.width * img.height)
      const quad: PageQuad = {
        tl,
        tr,
        br,
        bl,
        source: 'corner',
        confidence: coverage >= 0.25 && coverage <= 0.98 ? 0.9 : 0.6,
        imageWidth: img.width,
        imageHeight: img.height,
      }
      if (quadIsUsable(quad)) return quad
    }
  }
  // 亮区找不到(如浅色桌面/逆光): 全图四角兜底(扫描件≈纸边=图边)
  const full: PageQuad = {
    tl: { x: 0, y: 0 },
    tr: { x: img.width - 1, y: 0 },
    br: { x: img.width - 1, y: img.height - 1 },
    bl: { x: 0, y: img.height - 1 },
    source: 'corner',
    confidence: 0.4,
    imageWidth: img.width,
    imageHeight: img.height,
  }
  return quadIsUsable(full) ? full : null
}
