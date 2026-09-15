// =============================================================
// Quad CV 单测: 合成灰度图验证 亮区/纸角/定位点■/AI解析/兜底链
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  anchorCandidates,
  anchorQuad,
  buildQuadPrompt,
  detectQuadInGray,
  largestBrightRegion,
  maskQuadCorners,
  parseQuadResponse,
  rgbaToGray,
  type GrayImage,
} from '../../src/main/services/grading/quad-cv'

const W = 200
const H = 280

/** 合成图: 深色背景 + 白纸矩形 + 可选四角黑方块(定位点■) */
function synth(opts?: { anchors?: boolean; paperValue?: number; bgValue?: number }): GrayImage {
  const gray = new Uint8Array(W * H)
  const bg = opts?.bgValue ?? 40
  const paper = opts?.paperValue ?? 220
  gray.fill(bg)
  const x0 = 20
  const y0 = 20
  const x1 = 180
  const y1 = 260
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) gray[y * W + x] = paper
  }
  if (opts?.anchors) {
    const squares: Array<[number, number]> = [
      [30, 30],
      [160, 30],
      [160, 230],
      [30, 230],
    ]
    for (const [sx, sy] of squares) {
      for (let y = sy; y < sy + 10; y++) {
        for (let x = sx; x < sx + 10; x++) gray[y * W + x] = 0
      }
    }
  }
  return { gray, width: W, height: H }
}

describe('rgbaToGray', () => {
  it('白色→高灰度,黑色→0', () => {
    const rgba = new Uint8Array([
      255, 255, 255, 255, //
      0, 0, 0, 255,
    ])
    const { gray } = rgbaToGray(rgba, 2, 1)
    expect(gray[0]).toBe(255)
    expect(gray[1]).toBe(0)
  })
})

describe('largestBrightRegion + maskQuadCorners', () => {
  it('深背景白纸: 找到纸面并取四角', () => {
    const region = largestBrightRegion(synth())
    expect(region).not.toBeNull()
    const corners = maskQuadCorners(region!.mask, W, H)
    expect(corners).not.toBeNull()
    const [tl, tr, br, bl] = corners!
    expect(tl).toEqual({ x: 20, y: 20 })
    expect(tr).toEqual({ x: 179, y: 20 })
    expect(br).toEqual({ x: 179, y: 259 })
    expect(bl).toEqual({ x: 20, y: 259 })
  })

  it('全暗图找不到亮区', () => {
    expect(largestBrightRegion({ gray: new Uint8Array(W * H).fill(30), width: W, height: H })).toBeNull()
  })
})

describe('定位点■检测', () => {
  it('四角黑方块 → anchors 四点取质心', () => {
    const img = synth({ anchors: true })
    const region = largestBrightRegion(img)
    expect(region).not.toBeNull()
    const quad = anchorQuad(img, region!.bbox)
    expect(quad).not.toBeNull()
    expect(quad!.source).toBe('anchors')
    // 方块 [30,40)x[30,40) 质心 34.5
    expect(quad!.tl.x).toBeCloseTo(34.5, 1)
    expect(quad!.tl.y).toBeCloseTo(34.5, 1)
    expect(quad!.br.x).toBeCloseTo(164.5, 1)
    expect(quad!.bl.y).toBeCloseTo(234.5, 1)
  })

  it('中央黑块(不靠角)不算定位点', () => {
    const img = synth()
    const { gray } = img
    for (let y = 120; y < 140; y++) {
      for (let x = 90; x < 110; x++) gray[y * W + x] = 0
    }
    const region = largestBrightRegion(img)
    const quad = anchorQuad(img, region!.bbox)
    expect(quad).toBeNull()
  })

  it('候选数量不足 4 返回 null', () => {
    const img = synth()
    // 只画一个角方块
    for (let y = 30; y < 40; y++) {
      for (let x = 30; x < 40; x++) img.gray[y * W + x] = 0
    }
    const cands = anchorCandidates(img, { x0: 20, y0: 20, x1: 179, y1: 259 })
    expect(cands.length).toBe(1)
  })
})

describe('detectQuadInGray 组装链', () => {
  it('有■用 anchors,无■退纸角 corner', () => {
    expect(detectQuadInGray(synth({ anchors: true }))?.source).toBe('anchors')
    expect(detectQuadInGray(synth())?.source).toBe('corner')
  })

  it('纸角四点置信 0.9(覆盖率正常区间)', () => {
    const quad = detectQuadInGray(synth())
    expect(quad?.confidence).toBeCloseTo(0.9, 1)
  })

  it('扫描件形态(纸铺满整图)仍可定位', () => {
    const gray = new Uint8Array(W * H).fill(220)
    const quad = detectQuadInGray({ gray, width: W, height: H })
    expect(quad).not.toBeNull()
    expect(quad?.tl.x).toBeLessThanOrEqual(2)
  })

  it('全均匀中灰图退到全图兜底(conf 0.4)', () => {
    const quad = detectQuadInGray({ gray: new Uint8Array(W * H).fill(128), width: W, height: H })
    expect(quad?.confidence).toBeCloseTo(0.4, 1)
  })
})

describe('AI 四点解析', () => {
  it('合法 JSON → 像素坐标', () => {
    const quad = parseQuadResponse(
      '{"tl":{"x":0.04,"y":0.03},"tr":{"x":0.96,"y":0.05},"br":{"x":0.95,"y":0.97},"bl":{"x":0.05,"y":0.96}}',
      W,
      H,
    )
    expect(quad).not.toBeNull()
    expect(quad!.source).toBe('ai')
    expect(quad!.tl.x).toBeCloseTo(8, 3)
    expect(quad!.br.y).toBeCloseTo(271.6, 1)
  })

  it('markdown 代码块也能解析', () => {
    const quad = parseQuadResponse(
      '```json\n{"tl":{"x":0.1,"y":0.1},"tr":{"x":0.9,"y":0.1},"br":{"x":0.9,"y":0.9},"bl":{"x":0.1,"y":0.9}}\n```',
      W,
      H,
    )
    expect(quad).not.toBeNull()
  })

  it('缺角/乱文返回 null', () => {
    expect(parseQuadResponse('{"tl":{"x":0.1}}', W, H)).toBeNull()
    expect(parseQuadResponse('不是 JSON', W, H)).toBeNull()
  })

  it('越界坐标钳制到 [0,1]', () => {
    const quad = parseQuadResponse(
      '{"tl":{"x":-1,"y":0},"tr":{"x":2,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}',
      W,
      H,
    )
    expect(quad).not.toBeNull()
    expect(quad!.tl.x).toBe(0)
    expect(quad!.tr.x).toBe(W)
  })

  it('prompt 含格式说明', () => {
    const p = buildQuadPrompt()
    expect(p).toContain('"tl"')
    expect(p).toContain('0–1')
  })
})
