// =============================================================
// quad-editor-math — 手动四角编辑器坐标纯函数测试
// 锁定: 初始角预填(已检四角归一 / 3% 内缩兜底)、指针坐标双向
// 钳制、polygon 百分比串格式、像素落库 metadata。
// =============================================================

import { describe, expect, it } from 'vitest'
import type { PageQuad } from '@shared/grading-geometry'
import {
  clientToNormalized,
  initialQuadPoints,
  normalizedQuadToPixels,
  quadPolygonPercent,
} from '../../../../src/renderer/components/print/quad-editor-math'

describe('initialQuadPoints', () => {
  it('有已检四角且尺寸已知: 像素坐标按图片宽高归一', () => {
    const quad = {
      tl: { x: 62, y: 94 },
      tr: { x: 1860, y: 100 },
      br: { x: 1855, y: 2600 },
      bl: { x: 58, y: 2595 },
    } as PageQuad
    const pts = initialQuadPoints(quad, { width: 1920, height: 2640 })
    expect(pts.tl).toEqual({ x: 62 / 1920, y: 94 / 2640 })
    expect(pts.br.x).toBeCloseTo(1855 / 1920, 10)
  })

  it('无四角或缺尺寸: 四角 3% 内缩兜底', () => {
    const fallback = initialQuadPoints(null, { width: 100, height: 100 })
    expect(fallback.tl).toEqual({ x: 0.03, y: 0.03 })
    expect(fallback.tr).toEqual({ x: 0.97, y: 0.03 })
    expect(fallback.br).toEqual({ x: 0.97, y: 0.97 })
    expect(fallback.bl).toEqual({ x: 0.03, y: 0.97 })
    const noSize = initialQuadPoints({ tl: { x: 1, y: 1 } } as PageQuad, undefined)
    expect(noSize.tl).toEqual({ x: 0.03, y: 0.03 })
  })
})

describe('clientToNormalized', () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 }

  it('容器内坐标按比例归一', () => {
    expect(clientToNormalized(300, 200, rect)).toEqual({ x: 0.5, y: 0.5 })
    expect(clientToNormalized(100, 50, rect)).toEqual({ x: 0, y: 0 })
    expect(clientToNormalized(500, 350, rect)).toEqual({ x: 1, y: 1 })
  })

  it('拖出容器外双向钳制到 [0,1]', () => {
    expect(clientToNormalized(20, 10, rect)).toEqual({ x: 0, y: 0 })
    expect(clientToNormalized(900, 800, rect)).toEqual({ x: 1, y: 1 })
  })
})

describe('quadPolygonPercent', () => {
  it('输出 tl→tr→br→bl 顺时针百分比点位串', () => {
    expect(
      quadPolygonPercent({
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      }),
    ).toBe('0,0 100,0 100,100 0,100')
  })
})

describe('normalizedQuadToPixels', () => {
  it('归一四角 × 尺寸 → 像素 PageQuad,manual 来源置信 1 带 metadata', () => {
    const quad = normalizedQuadToPixels(
      {
        tl: { x: 0.1, y: 0.2 },
        tr: { x: 0.9, y: 0.2 },
        br: { x: 0.9, y: 0.8 },
        bl: { x: 0.1, y: 0.8 },
      },
      { width: 1000, height: 500 },
      '2026-10-27T00:00:00.000Z',
    )
    expect(quad.tl).toEqual({ x: 100, y: 100 })
    expect(quad.br).toEqual({ x: 900, y: 400 })
    expect(quad.source).toBe('manual')
    expect(quad.confidence).toBe(1)
    expect(quad.imageWidth).toBe(1000)
    expect(quad.imageHeight).toBe(500)
    expect(quad.detectedAt).toBe('2026-10-27T00:00:00.000Z')
  })
})