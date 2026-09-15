// =============================================================
// 套打几何单测: 单应解算/映射、纸张规格匹配、四点合法性、定向修正
// =============================================================

import { describe, expect, it } from 'vitest'
import type { PageQuad, QuadPoint } from '../../src/shared/grading-geometry'
import {
  matchPaperSpec,
  mapPoint,
  orientQuadForSpec,
  PAPER_SPECS,
  paperSpecById,
  paperSpecToPrintPageSize,
  quadAreaPx,
  quadIsUsable,
  quadToPaperMapper,
  rescaleQuad,
  solveHomography,
} from '../../src/shared/grading-geometry'

const A4 = paperSpecById('a4')

function quadOf(
  tl: QuadPoint,
  tr: QuadPoint,
  br: QuadPoint,
  bl: QuadPoint,
  extra?: Partial<PageQuad>,
): PageQuad {
  return {
    tl,
    tr,
    br,
    bl,
    source: 'corner',
    confidence: 0.9,
    imageWidth: 1000,
    imageHeight: 1414,
    ...extra,
  }
}

// 1000x1414 图,纸面四角(近似 A4 竖向,略带倾斜)
const BASE = quadOf(
  { x: 30, y: 20 },
  { x: 970, y: 35 },
  { x: 985, y: 1390 },
  { x: 20, y: 1380 },
)

describe('solveHomography', () => {
  it('恒等映射: 单位四点', () => {
    const unit = quadOf({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 })
    const h = solveHomography(
      [unit.tl, unit.tr, unit.br, unit.bl],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    )
    expect(h).not.toBeNull()
    const p = mapPoint(h as never, { x: 0.25, y: 0.75 })
    expect(p.x).toBeCloseTo(0.25, 6)
    expect(p.y).toBeCloseTo(0.75, 6)
  })

  it('平移+缩放精确还原', () => {
    const dst: QuadPoint[] = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 220 },
      { x: 10, y: 220 },
    ]
    const src: QuadPoint[] = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ]
    const h = solveHomography(src, dst)
    expect(h).not.toBeNull()
    const mid = mapPoint(h as never, { x: 25, y: 50 })
    expect(mid.x).toBeCloseTo(60, 6)
    expect(mid.y).toBeCloseTo(120, 6)
  })

  it('透视(梯形)映射: 角点精确、内点合理', () => {
    const src = [BASE.tl, BASE.tr, BASE.br, BASE.bl]
    const dst: QuadPoint[] = [
      { x: 0, y: 0 },
      { x: 210, y: 4 },
      { x: 205, y: 296 },
      { x: 3, y: 293 },
    ]
    const h = solveHomography(src, dst)
    expect(h).not.toBeNull()
    const corners = src.map((p) => mapPoint(h as never, p))
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(dst[i].x, 3)
      expect(c.y).toBeCloseTo(dst[i].y, 3)
    })
    const center = mapPoint(h as never, { x: 500, y: 700 })
    expect(center.x).toBeGreaterThan(50)
    expect(center.x).toBeLessThan(160)
    expect(center.y).toBeGreaterThan(100)
    expect(center.y).toBeLessThan(200)
  })

  it('共线四点返回 null', () => {
    const line: QuadPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]
    expect(solveHomography(line, line)).toBeNull()
  })
})

describe('quadToPaperMapper', () => {
  it('0-1 坐标映射到 A4 毫米: 纸面≈整图时比例正确', () => {
    const full = quadOf(
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1414 },
      { x: 0, y: 1414 },
    )
    const toMm = quadToPaperMapper(full, A4)
    expect(toMm).not.toBeNull()
    const center = (toMm as (x: number, y: number) => QuadPoint)(0.5, 0.5)
    expect(center.x).toBeCloseTo(105, 1)
    expect(center.y).toBeCloseTo(148.5, 1)
  })

  it('倾斜+透视的照片也能换算(纸角内缩)', () => {
    const toMm = quadToPaperMapper(BASE, A4)
    expect(toMm).not.toBeNull()
    const p = (toMm as (x: number, y: number) => QuadPoint)(0.9, 0.1)
    // 照片右上角附近 → 纸右上附近(允许几毫米透视误差)
    expect(p.x).toBeGreaterThan(150)
    expect(p.y).toBeLessThan(50)
  })
})

describe('matchPaperSpec', () => {
  it('A4 比例命中 a4', () => {
    const m = matchPaperSpec(1240, 1754)
    expect(m?.spec.id).toBe('a4')
  })

  it('16K/8K 常见分辨率命中', () => {
    expect(matchPaperSpec(1950, 2700)?.spec.id).toBe('16k')
    expect(matchPaperSpec(2700, 3900)?.spec.id).toBe('8k')
  })

  it('横拍竖纸匹配失败(交由定向逻辑)', () => {
    expect(matchPaperSpec(1754, 1240)).toBeNull()
  })

  it('PAPER_SPECS 无重复 id 且尺寸为正', () => {
    const ids = new Set(PAPER_SPECS.map((s) => s.id))
    expect(ids.size).toBe(PAPER_SPECS.length)
    for (const s of PAPER_SPECS) {
      expect(s.widthMm).toBeGreaterThan(0)
      expect(s.heightMm).toBeGreaterThan(0)
    }
  })
})

describe('quadIsUsable / quadAreaPx / rescaleQuad', () => {
  it('正常纸角四点可用', () => {
    expect(quadIsUsable(BASE)).toBe(true)
  })

  it('面积过小(碎片)不可用', () => {
    const tiny = quadOf({ x: 10, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 60 }, { x: 10, y: 60 })
    expect(quadIsUsable(tiny)).toBe(false)
  })

  it('NaN 坐标不可用', () => {
    const bad = quadOf(
      { x: Number.NaN, y: 0 },
      { x: 970, y: 35 },
      { x: 985, y: 1390 },
      { x: 20, y: 1380 },
    )
    expect(quadIsUsable(bad)).toBe(false)
  })

  it('面积公式: 单位正方形=1', () => {
    const unit = quadOf({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 })
    expect(quadAreaPx(unit)).toBeCloseTo(1, 6)
  })

  it('rescaleQuad 按比例重映射且更新尺寸', () => {
    const scaled = rescaleQuad(BASE, 500, 707)
    expect(scaled.imageWidth).toBe(500)
    expect(scaled.tl.x).toBeCloseTo(15, 6)
    expect(scaled.bl.y).toBeCloseTo(690, 0)
  })
})

describe('paperSpecToPrintPageSize', () => {
  it('A4/A3 用 Electron 原生枚举', () => {
    expect(paperSpecToPrintPageSize(paperSpecById('a4'))).toBe('A4')
    expect(paperSpecToPrintPageSize(paperSpecById('a3'))).toBe('A3')
  })

  it('B5/8K/16K 输出微米自定义尺寸', () => {
    expect(paperSpecToPrintPageSize(paperSpecById('16k'))).toEqual({
      width: 195000,
      height: 270000,
    })
    expect(paperSpecToPrintPageSize(paperSpecById('8k'))).toEqual({
      width: 270000,
      height: 390000,
    })
  })

  it('未知 id 回落 A4', () => {
    expect(paperSpecToPrintPageSize(paperSpecById('nope'))).toBe('A4')
  })
})

describe('orientQuadForSpec', () => {
  it('竖向照片+竖向规格不变', () => {
    const out = orientQuadForSpec(BASE, A4)
    expect(out.tl).toBe(BASE.tl)
  })

  it('横拍照片旋转标注后宽高比对上竖向规格', () => {
    // 卷子横放: 图片是 1414x1000,纸角按图片空间标注
    const landscape: PageQuad = {
      ...BASE,
      tl: { x: 20, y: 20 },
      tr: { x: 1390, y: 35 },
      br: { x: 1380, y: 970 },
      bl: { x: 30, y: 985 },
      imageWidth: 1414,
      imageHeight: 1000,
    }
    const out = orientQuadForSpec(landscape, A4)
    const w = Math.abs(out.tr.x - out.tl.x)
    const h = Math.abs(out.bl.y - out.tl.y)
    expect(w / h).toBeLessThan(1) // 转成了竖向口径
  })
})
