// =============================================================
// 套打版式单测: 字号层级/落点/页边批注自适应降级/总分/校准
// =============================================================

import { describe, expect, it } from 'vitest'
import { paperSpecById, type PageQuad } from '../../src/shared/grading-geometry'
import {
  circleNumber,
  DEFAULT_OVERLAY_TYPOGRAPHY,
  estimateTextWidthMm,
  layoutOverlayPaper,
  wrapCjkText,
  type OverlayLayoutInput,
} from '../../src/shared/overlay-layout'
import type { AiGradeResult, GradingPaper, RubricQuestion } from '../../src/shared/types'

const A4 = paperSpecById('a4')

const FULL_QUAD: PageQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1000, y: 0 },
  br: { x: 1000, y: 1414 },
  bl: { x: 0, y: 1414 },
  source: 'corner',
  confidence: 0.9,
  imageWidth: 1000,
  imageHeight: 1414,
}

const RUBRIC: RubricQuestion[] = [
  { id: 'q-1', title: '单选', type: 'objective', fullMark: 4, order: 1 },
  { id: 'q-2', title: '计算', type: 'subjective', fullMark: 12, order: 2 },
  { id: 'q-3', title: '证明', type: 'subjective', fullMark: 10, order: 3 },
  { id: 'q-4', title: '简答', type: 'subjective', fullMark: 8, order: 4 },
]

function aiOf(overrides: {
  score2?: number
  score4?: number
  comment4?: string
  deductions4?: Array<{ points: number; reason: string }>
  box4Y?: number
  page4?: number
}): AiGradeResult {
  return {
    questions: [
      { questionId: 'q-1', score: 4, box: { page: 0, x: 0.05, y: 0.08, w: 0.5, h: 0.06 } },
      {
        questionId: 'q-2',
        score: overrides.score2 ?? 9,
        evidence: '第二问未讨论边界',
        deductions: [
          { points: 2, reason: '单位未换算' },
          { points: 1, reason: '未画受力图' },
        ],
        box: { page: 0, x: 0.05, y: 0.25, w: 0.5, h: 0.2 },
      },
      { questionId: 'q-3', score: 10, box: { page: 0, x: 0.05, y: 0.5, w: 0.5, h: 0.15 } },
      {
        questionId: 'q-4',
        score: overrides.score4 ?? 0,
        comment: overrides.comment4 ?? '审题偏差,再读一遍题干',
        deductions: overrides.deductions4 ?? [{ points: 8, reason: '答非所问' }],
        box: {
          page: overrides.page4 ?? 0,
          x: 0.05,
          y: overrides.box4Y ?? 0.72,
          w: 0.5,
          h: 0.18,
        },
      },
    ],
    totalScore: 23,
    model: { provider: 'p', model: 'm' },
    finishedAt: '2026-09-15T00:00:00.000Z',
  }
}

function paperOf(ai: AiGradeResult): GradingPaper {
  return {
    id: 'paper-1',
    studentName: '张三',
    files: [],
    uploadedAt: '2026-09-15T00:00:00.000Z',
    status: 'graded',
    ai,
  }
}

function layoutOf(ai: AiGradeResult, extra?: Partial<OverlayLayoutInput>) {
  return layoutOverlayPaper({
    paper: paperOf(ai),
    rubric: RUBRIC,
    quads: [FULL_QUAD],
    imageSizes: [{ width: 1000, height: 1414 }],
    spec: A4,
    ...extra,
  })
}

describe('estimateTextWidthMm / wrapCjkText / circleNumber', () => {
  it('数字+斜杠按 0.55/0.4 em 计宽', () => {
    const w = estimateTextWidthMm('12/28', 11.5)
    // 4×0.55 + 0.4 = 2.6em → 2.6 × 11.5 × 0.3528
    expect(w).toBeCloseTo(2.6 * 11.5 * 0.3528, 3)
  })

  it('CJK 全宽计 1em', () => {
    expect(estimateTextWidthMm('单位未换算', 8)).toBeCloseTo(5 * 8 * 0.3528, 3)
  })

  it('逐字断行不超宽', () => {
    const lines = wrapCjkText('一二三四五', 2)
    expect(lines).toEqual(['一二', '三四', '五'])
  })

  it('圈号 1–20 用①…⑳', () => {
    expect(circleNumber(1)).toBe('①')
    expect(circleNumber(20)).toBe('⑳')
    expect(circleNumber(21)).toBe('(21)')
  })
})

describe('layoutOverlayPaper: 短痕', () => {
  const layout = layoutOf(aiOf({}))

  it('全对✓/零分✗/部分对分数,字号走层级表', () => {
    const marks = layout.pages[0]?.marks ?? []
    const m1 = marks.find((m) => m.questionId === 'q-1')
    const m2 = marks.find((m) => m.questionId === 'q-2')
    const m3 = marks.find((m) => m.questionId === 'q-3')
    const m4 = marks.find((m) => m.questionId === 'q-4')
    expect(m1?.text).toBe('✓')
    expect(m1?.pt).toBe(DEFAULT_OVERLAY_TYPOGRAPHY.symbolPt)
    expect(m2?.text).toBe('9/12')
    expect(m2?.pt).toBe(DEFAULT_OVERLAY_TYPOGRAPHY.scorePt)
    expect(m3?.text).toBe('✓')
    expect(m4?.text).toBe('✗')
    expect(m4?.pt).toBe(DEFAULT_OVERLAY_TYPOGRAPHY.symbolPt)
  })

  it('落点在作答区右缘外侧(不压作答)', () => {
    const m2 = layout.pages[0]?.marks.find((m) => m.questionId === 'q-2')
    // box 右缘 = 0.55×210 = 115.5mm,痕迹应在右侧 ≥2mm
    expect(m2?.xMm).toBeGreaterThanOrEqual(115.5 + 2 - 0.5)
  })

  it('靠右纸边的 box 收到批注栏左侧分数槽,不翻到纸左边', () => {
    const ai = aiOf({})
    ai.questions[1]!.box = { page: 0, x: 0.72, y: 0.25, w: 0.25, h: 0.2 }
    const out = layoutOf(ai)
    const m2 = out.pages[0]?.marks.find((m) => m.questionId === 'q-2')
    const noteLeft = A4.widthMm - 8 - 32
    expect(m2?.xMm).toBeGreaterThan(100)
    expect((m2?.xMm ?? 0) + estimateTextWidthMm('9/12', m2?.pt ?? 11.5)).toBeLessThanOrEqual(
      noteLeft - 2 + 0.05,
    )
  })
})

describe('layoutOverlayPaper: 总分', () => {
  it('首页右上,大字+半号满分', () => {
    const layout = layoutOf(aiOf({}))
    // 4+9+10+0 = 23 / 34
    expect(layout.total?.mainText).toBe('23')
    expect(layout.total?.subText).toBe('/34')
    expect(layout.total?.mainPt).toBe(DEFAULT_OVERLAY_TYPOGRAPHY.totalPt)
    expect(layout.total?.subPt).toBe(DEFAULT_OVERLAY_TYPOGRAPHY.totalSubPt)
    expect(layout.total?.xMm).toBeGreaterThan(150)
    expect(layout.total?.yMm).toBeLessThanOrEqual(10.01)
  })

  it('缺生效分不打总分并给出警告', () => {
    const ai = aiOf({})
    // q-4 无生效分(AI 分缺失) → 整卷总分不排
    ;(ai.questions[3] as { score?: number }).score = undefined
    const layout = layoutOf(ai)
    expect(layout.total).toBeNull()
    expect(layout.warnings.some((w) => w.includes('总分'))).toBe(true)
    // 无生效分的题也不落短痕
    expect(layout.pages[0]?.marks.some((m) => m.questionId === 'q-4')).toBe(false)
  })
})

describe('layoutOverlayPaper: 页边批注自适应', () => {
  it('主观题非全对出批注: 首行①+分数,扣分说明成行', () => {
    const layout = layoutOf(aiOf({}))
    const notes = layout.pages[0]?.notes ?? []
    expect(notes.map((n) => n.questionId)).toEqual(['q-2', 'q-4'])
    expect(notes[0]?.header.startsWith('①')).toBe(true)
    expect(notes[0]?.header.endsWith('9/12')).toBe(true)
    // 扣分说明应出现(内容降级不至此)
    const body = notes[0]?.lines.join('') ?? ''
    expect(body).toContain('单位未换算')
    expect(notes[1]?.header.startsWith('②')).toBe(true)
  })

  it('客观题与全对主观题不出批注', () => {
    const layout = layoutOf(aiOf({}))
    const notes = layout.pages[0]?.notes ?? []
    expect(notes.some((n) => n.questionId === 'q-1')).toBe(false)
    expect(notes.some((n) => n.questionId === 'q-3')).toBe(false)
  })

  it('纵向空间不足时按降级链: 丢评语→截扣分→只留首行', () => {
    // q-4 作答区中心≈页面 94.7% → 批注只放得下首行(差一行到页底安全线)
    const layout = layoutOf(aiOf({ box4Y: 0.857, comment4: '很长很长很长很长很长很长很长很长很长很长' }))
    const notes = layout.pages[0]?.notes ?? []
    const n4 = notes.find((n) => n.questionId === 'q-4')
    expect(n4).toBeDefined()
    expect(n4?.lines.length ?? 1).toBe(0)
    expect(n4?.header.startsWith('②')).toBe(true)
    // 空间充裕的第一条批注: 扣分说明与评语都在
    const n2 = notes.find((n) => n.questionId === 'q-2')
    const body2 = n2?.lines.join('') ?? ''
    expect(body2).toContain('单位未换算')
    expect(body2).toContain('第二问未讨论边界')
  })

  it('贴到页底之外的批注整体转批阅报告(警告)', () => {
    const layout = layoutOf(aiOf({ box4Y: 0.94 }))
    const notes = layout.pages[0]?.notes ?? []
    expect(notes.some((n) => n.questionId === 'q-4')).toBe(false)
    expect(layout.warnings.some((w) => w.includes('批注') && w.includes('页底'))).toBe(true)
  })

  it('批注不重叠: 后一条 top ≥ 前一条 bottom', () => {
    const layout = layoutOf(aiOf({ box4Y: 0.28 }))
    const notes = layout.pages[0]?.notes ?? []
    for (let i = 1; i < notes.length; i++) {
      const prev = notes[i - 1]!
      const prevBottom = prev.yMm + prev.lineHeightMm * (1 + prev.lines.length)
      expect(notes[i]!.yMm).toBeGreaterThanOrEqual(prevBottom - 0.01)
    }
  })

  it('批注行宽不超栏宽(逐字断行生效)', () => {
    const layout = layoutOf(aiOf({ comment4: '评语评语评语评语评语评语评语评语评语评语评语评语评语评语评语评语评语' }))
    for (const n of layout.pages[0]?.notes ?? []) {
      for (const line of n.lines) {
        expect(estimateTextWidthMm(line, n.pt)).toBeLessThanOrEqual(n.widthMm + 0.01)
      }
    }
  })
})

describe('layoutOverlayPaper: 母版标定(Tier B)', () => {
  const TPL_QUAD: PageQuad = {
    tl: { x: 0, y: 0 },
    tr: { x: 1200, y: 0 },
    br: { x: 1200, y: 1697 },
    bl: { x: 0, y: 1697 },
    source: 'anchors',
    confidence: 0.95,
    imageWidth: 1200,
    imageHeight: 1697,
  }

  it('模板 boxes 生效: 无学生四点也能出痕迹(位置走模板坐标)', () => {
    const layout = layoutOf(aiOf({}), {
      quads: [null],
      template: {
        boxes: {
          'q-1': { page: 0, x: 0.05, y: 0.08, w: 0.5, h: 0.06 },
          'q-2': { page: 0, x: 0.1, y: 0.3, w: 0.6, h: 0.2 },
          'q-3': { page: 0, x: 0.05, y: 0.5, w: 0.5, h: 0.15 },
          'q-4': { page: 0, x: 0.05, y: 0.72, w: 0.5, h: 0.18 },
        },
        quads: [TPL_QUAD],
      },
    })
    const marks = layout.pages[0]?.marks ?? []
    expect(marks.length).toBe(4)
    // 无需 per-paper 四点也不出缺页警告
    expect(layout.warnings.some((w) => w.includes('没有定位四点'))).toBe(false)
  })

  it('模板位置优先于学生卷 AI box', () => {
    // 学生卷 AI box 在 y=0.25;模板把 q-2 放到 y=0.6 → 痕迹应跟模板
    const layout = layoutOf(aiOf({}), {
      quads: [FULL_QUAD],
      template: {
        boxes: { 'q-2': { page: 0, x: 0.1, y: 0.6, w: 0.6, h: 0.2 } },
        quads: [TPL_QUAD],
      },
    })
    const m2 = layout.pages[0]?.marks.find((m) => m.questionId === 'q-2')
    // 模板 y=0.6 → mm≈178;AI box y=0.25 → mm≈74
    expect(m2?.yMm).toBeGreaterThan(150)
  })

  it('模板缺的题回落学生卷 AI box', () => {
    const layout = layoutOf(aiOf({}), {
      quads: [FULL_QUAD],
      template: { boxes: { 'q-1': { page: 0, x: 0.05, y: 0.08, w: 0.5, h: 0.06 } }, quads: [TPL_QUAD] },
    })
    const marks = layout.pages[0]?.marks ?? []
    expect(marks.length).toBe(4)
    // q-2 走学生卷 box(y=0.25 → ≈74mm)
    const m2 = marks.find((m) => m.questionId === 'q-2')
    expect(m2 ? m2.yMm : 0).toBeLessThan(90)
  })
})

describe('layoutOverlayPaper: 缺页/校准', () => {
  it('无四点的页给估算警告但仍排出痕迹', () => {
    const layout = layoutOf(aiOf({ page4: 1 }), { quads: [FULL_QUAD, null] })
    expect(layout.warnings.some((w) => w.includes('第 2 页') && w.includes('整页估算'))).toBe(true)
    expect(layout.pages[1]?.marks.some((m) => m.questionId === 'q-4')).toBe(true)
    expect(layout.pages[1]?.unplacedMarks).toBe(0)
    expect(layout.approxPages).toBe(1)
  })

  it('无任何定位时按整页估算排出痕迹+总分,不再只打总分', () => {
    const layout = layoutOf(aiOf({}), { quads: [], imageSizes: [] })
    expect(layout.pages[0]?.unplacedMarks).toBe(0)
    expect(layout.pages[0]?.marks).toHaveLength(4)
    expect(layout.pages[0]?.notes.length).toBeGreaterThan(0)
    expect(layout.warnings.some((w) => w.includes('整页估算'))).toBe(true)
    expect(layout.approxPages).toBe(1)
    expect(layout.total?.mainText).toBe('23')
  })

  it('正常定位页 unplacedMarks=0 且非估算', () => {
    const layout = layoutOf(aiOf({}))
    expect(layout.pages[0]?.unplacedMarks).toBe(0)
    expect(layout.pages[0]?.marks).toHaveLength(4)
    expect(layout.approxPages).toBe(0)
  })

  it('四点退化回落整页估算,痕迹仍排出', () => {
    const degenerate: PageQuad = {
      tl: { x: 0, y: 0 },
      tr: { x: 500, y: 0 },
      br: { x: 1000, y: 0 },
      bl: { x: 250, y: 0 },
      source: 'manual',
      confidence: 1,
      imageWidth: 1000,
      imageHeight: 1414,
    }
    const layout = layoutOf(aiOf({}), { quads: [degenerate] })
    expect(layout.pages[0]?.unplacedMarks).toBe(0)
    expect(layout.pages[0]?.marks).toHaveLength(4)
    expect(layout.warnings.some((w) => w.includes('四点退化'))).toBe(true)
    expect(layout.approxPages).toBe(1)
  })

  it('模板 box 在模板页无四点时回落整页估算', () => {
    const layout = layoutOf(aiOf({}), {
      quads: [],
      imageSizes: [],
      template: {
        boxes: { 'q-1': { page: 0, x: 0.05, y: 0.08, w: 0.5, h: 0.06 } },
        quads: [null],
      },
    })
    expect(layout.pages[0]?.unplacedMarks).toBe(0)
    expect(layout.pages[0]?.marks.length).toBeGreaterThan(0)
    expect(layout.approxPages).toBe(1)
  })

  it('校准 dx/dy/scale 全元素生效', () => {
    const base = layoutOf(aiOf({}))
    const shifted = layoutOf(aiOf({}), {
      calibration: { dxMm: 5, dyMm: 3, scalePct: 100 },
    })
    const bm = base.pages[0]?.marks[0]
    const sm = shifted.pages[0]?.marks[0]
    expect(sm?.xMm).toBeCloseTo((bm?.xMm ?? 0) + 5, 3)
    expect(sm?.yMm).toBeCloseTo((bm?.yMm ?? 0) + 3, 3)
    const scaled = layoutOf(aiOf({}), { calibration: { dxMm: 0, dyMm: 0, scalePct: 101 } })
    const tm = scaled.pages[0]?.marks[0]
    expect(tm?.xMm).toBeCloseTo((bm?.xMm ?? 0) * 1.01, 3)
  })
})

describe('layoutOverlayPaper: 宽作答框(定位 prompt 默认 w≈0.9)', () => {
  it('分数不堆纸左边,批注栏保持可读宽度且不断成单字', () => {
    const ai = aiOf({})
    for (const q of ai.questions) {
      if (q.box) q.box = { ...q.box, x: 0.04, w: 0.9 }
    }
    const layout = layoutOf(ai)
    const marks = layout.pages[0]?.marks ?? []
    expect(marks).toHaveLength(4)
    for (const m of marks) {
      expect(m.xMm).toBeGreaterThan(100)
    }
    const notes = layout.pages[0]?.notes ?? []
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) {
      expect(n.widthMm).toBeGreaterThanOrEqual(30)
      expect(n.header.includes('\n')).toBe(false)
    }
    const body = notes.map((n) => n.lines.join('')).join('')
    expect(body).toContain('单位未换算')
    const longLines = notes.flatMap((n) => n.lines).filter((l) => l.length >= 4)
    expect(longLines.length).toBeGreaterThan(0)
  })
})
