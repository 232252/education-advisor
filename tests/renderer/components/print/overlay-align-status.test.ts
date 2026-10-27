// =============================================================
// overlay-align-status — 套打对齐状态推导纯函数测试
// 优先级锁定: 模板激活 → 全对齐;缺任一页四角 → manual;
// 四角齐全但有近似页 → approx。
// =============================================================

import { describe, expect, it } from 'vitest'
import type { PageQuad } from '@shared/grading-geometry'
import {
  anyQuadAttempted,
  deriveAlignStatus,
  isTemplateActive,
  needsManualQuadAlign,
  shouldAutoDetect,
} from '../../../../src/renderer/components/print/overlay-align-status'

const Q: PageQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 100, y: 0 },
  br: { x: 100, y: 140 },
  bl: { x: 0, y: 140 },
} as PageQuad

function paper(files = 2, quads?: Array<PageQuad | null>) {
  return { files: Array.from({ length: files }), overlayQuads: quads }
}

describe('isTemplateActive', () => {
  it('无模板/无框/框空 → 未激活', () => {
    expect(isTemplateActive(undefined)).toBe(false)
    expect(isTemplateActive(null)).toBe(false)
    expect(isTemplateActive({ boxes: {}, quads: [Q] })).toBe(false)
  })

  it('有框但四角全缺 → 未激活;任一四角已定 → 激活', () => {
    expect(isTemplateActive({ boxes: { a: 1 }, quads: [null, null] })).toBe(false)
    expect(isTemplateActive({ boxes: { a: 1 }, quads: [null, Q] })).toBe(true)
    expect(isTemplateActive({ boxes: { a: 1 } })).toBe(false)
  })
})

describe('needsManualQuadAlign', () => {
  it('无扫描页(0 files)不需要;有页但四角缺任一 → 需要;齐全 → 不需要', () => {
    expect(needsManualQuadAlign(paper(0, undefined))).toBe(false)
    expect(needsManualQuadAlign(paper(2, undefined))).toBe(true)
    expect(needsManualQuadAlign(paper(2, [Q, null]))).toBe(true)
    expect(needsManualQuadAlign(paper(2, [Q, Q]))).toBe(false)
  })
})

describe('deriveAlignStatus 优先级', () => {
  it('模板激活 → 一律 aligned(即使四角缺失/有近似页)', () => {
    expect(
      deriveAlignStatus({ templateActive: true, paper: paper(2, [null]), approxPages: 3 }),
    ).toBe('aligned')
  })

  it('缺四角 → manual 优先于 approx', () => {
    expect(
      deriveAlignStatus({ templateActive: false, paper: paper(2, [Q, null]), approxPages: 2 }),
    ).toBe('manual')
  })

  it('自动检测触发判定: 三条件与门,任一不满足即不跑', () => {
    const base = { alreadyAutoDetected: false, anyQuadAttempted: false, needManualCount: 2 }
    expect(shouldAutoDetect(base)).toBe(true)
    // 本会话已自动跑过 → 不再跑
    expect(shouldAutoDetect({ ...base, alreadyAutoDetected: true })).toBe(false)
    // 全任务已有四角记录(用户动过) → 让位
    expect(shouldAutoDetect({ ...base, anyQuadAttempted: true })).toBe(false)
    // 没有待对齐试卷 → 无事可做
    expect(shouldAutoDetect({ ...base, needManualCount: 0 })).toBe(false)
  })

  it('anyQuadAttempted: 任一试卷有四角记录即为 true(空数组/全无记录为 false)', () => {
    expect(anyQuadAttempted([])).toBe(false)
    expect(anyQuadAttempted([paper(2, undefined)])).toBe(false)
    expect(anyQuadAttempted([paper(2, undefined), paper(1, [Q])])).toBe(true)
  })

  it('四角齐全: 有近似页 approx,无近似页 aligned;0 页试卷也 aligned', () => {
    expect(
      deriveAlignStatus({ templateActive: false, paper: paper(2, [Q, Q]), approxPages: 1 }),
    ).toBe('approx')
    expect(
      deriveAlignStatus({ templateActive: false, paper: paper(2, [Q, Q]), approxPages: 0 }),
    ).toBe('aligned')
    expect(deriveAlignStatus({ templateActive: false, paper: paper(0), approxPages: 0 })).toBe(
      'aligned',
    )
  })
})