// =============================================================
// overlay-spec-suggestion — 套打纸张规格建议纯函数测试
// 口径: 取第一张量出尺寸的页面;按宽高比最近邻匹配(容差 4.5%);
// 横拍照片/无测量回落 A4。B5(0.704) 与 A4(0.7071) 比例极近,
// 用最近邻用例锁定区分。
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  suggestPaperSpecId,
  type PageSizeMap,
} from '../../../../src/renderer/components/print/overlay-spec-suggestion'

describe('suggestPaperSpecId', () => {
  it('无任何测量: 回落 A4', () => {
    expect(suggestPaperSpecId({})).toBe('a4')
    expect(suggestPaperSpecId({ p1: [undefined, undefined] })).toBe('a4')
  })

  it('A4 比例图片 → a4;16K 精确比例 → 16k(最近邻胜出)', () => {
    expect(suggestPaperSpecId({ p1: [{ width: 1240, height: 1754 }] })).toBe('a4')
    // 16K = 195/270,同值同时落在 A4 容差内,最近邻应选 16k
    expect(suggestPaperSpecId({ p1: [{ width: 1300, height: 1800 }] })).toBe('16k')
  })

  it('B5 与 A4 比例极近: 0.7045 最近邻选 b5', () => {
    expect(suggestPaperSpecId({ p1: [{ width: 1409, height: 2000 }] })).toBe('b5')
  })

  it('A3 精确比例 → a3(与 A4 比例几乎重合,零误差方胜出)', () => {
    expect(suggestPaperSpecId({ p1: [{ width: 1485, height: 2100 }] })).toBe('a3')
  })

  it('横拍照片匹配不上竖向规格: 回落 A4(交上层做旋转判定)', () => {
    expect(suggestPaperSpecId({ p1: [{ width: 2100, height: 1485 }] })).toBe('a4')
  })

  it('跨试卷取第一个量出的页面(跳过未测量的页)', () => {
    const sizes: PageSizeMap = {
      p1: [undefined, undefined],
      p2: [undefined, { width: 1240, height: 1754 }],
    }
    expect(suggestPaperSpecId(sizes)).toBe('a4')
  })
})