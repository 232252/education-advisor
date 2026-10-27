// =============================================================
// quad-editor-math — 手动四角编辑器的坐标纯函数
// 从 QuadEditorDialog 抽出(套打定位逃生门的数学核心):
//   initialQuadPoints      初始四角: 有已检四角按图片归一,否则 3% 内缩
//   clientToNormalized     指针坐标 → 容器内归一 0-1(双向钳制)
//   quadPolygonPercent     四角 → SVG polygon 百分比点位串
//   normalizedQuadToPixels 归一四角 → 像素 PageQuad(source=manual)
// 坐标换算与钳制是回归敏感点(拖出图片外/除零/比例错),独立成
// 模块以便单测。
// =============================================================

import type { PageQuad } from '@shared/grading-geometry'

export type CornerKey = 'tl' | 'tr' | 'br' | 'bl'
export interface NormPt {
  x: number
  y: number
}
export type QuadPts = Record<CornerKey, NormPt>

/** 无已检四角时的默认内缩比例(避开图片边缘) */
export const QUAD_EDITOR_INSET = 0.03

/** 初始四角: initialQuad+尺寸已知 → 像素归一;否则四角 3% 内缩 */
export function initialQuadPoints(
  initialQuad: PageQuad | null | undefined,
  naturalSize: { width: number; height: number } | undefined,
): QuadPts {
  if (initialQuad && naturalSize) {
    const n = (p: { x: number; y: number }) => ({
      x: p.x / naturalSize.width,
      y: p.y / naturalSize.height,
    })
    return {
      tl: n(initialQuad.tl),
      tr: n(initialQuad.tr),
      br: n(initialQuad.br),
      bl: n(initialQuad.bl),
    }
  }
  const i = QUAD_EDITOR_INSET
  return {
    tl: { x: i, y: i },
    tr: { x: 1 - i, y: i },
    br: { x: 1 - i, y: 1 - i },
    bl: { x: i, y: 1 - i },
  }
}

/** 指针客户端坐标 → 容器内归一坐标,双向钳制到 [0,1] */
export function clientToNormalized(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): NormPt {
  return {
    x: Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1),
    y: Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1),
  }
}

/** 四角 → "x,y x,y x,y x,y" 百分比点位串(SVG polygon points) */
export function quadPolygonPercent(pts: QuadPts): string {
  return (
    `${pts.tl.x * 100},${pts.tl.y * 100} ${pts.tr.x * 100},${pts.tr.y * 100} ` +
    `${pts.br.x * 100},${pts.br.y * 100} ${pts.bl.x * 100},${pts.bl.y * 100}`
  )
}

/** 归一四角 × 图片尺寸 → 像素 PageQuad,标记 source=manual 置信 1 */
export function normalizedQuadToPixels(
  pts: QuadPts,
  size: { width: number; height: number },
  detectedAt: string,
): PageQuad {
  return {
    tl: { x: pts.tl.x * size.width, y: pts.tl.y * size.height },
    tr: { x: pts.tr.x * size.width, y: pts.tr.y * size.height },
    br: { x: pts.br.x * size.width, y: pts.br.y * size.height },
    bl: { x: pts.bl.x * size.width, y: pts.bl.y * size.height },
    source: 'manual',
    confidence: 1,
    imageWidth: size.width,
    imageHeight: size.height,
    detectedAt,
  }
}
