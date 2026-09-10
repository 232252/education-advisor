// =============================================================
// 中国身份证解析 / 脱敏
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  isCorruptedIdCardCell,
  maskIdCard,
  maskPhone,
  normalizeIdCard,
  parseChineseIdCard,
} from '../../src/shared/id-card'

describe('parseChineseIdCard', () => {
  it('18 位合法男证 → 出生日期与性别', () => {
    const parsed = parseChineseIdCard('990000200801011232')
    expect(parsed).toEqual({
      idCard: '990000200801011232',
      birthDate: '2008-01-01',
      gender: '男',
    })
  })

  it('18 位合法女证 → 出生日期与性别', () => {
    const parsed = parseChineseIdCard('990000200802022224')
    expect(parsed).toEqual({
      idCard: '990000200802022224',
      birthDate: '2008-02-02',
      gender: '女',
    })
  })

  it('容忍空格、小写 x、全角数字', () => {
    const parsed = parseChineseIdCard(' ９９００００２００８０１０１１２３２ ')
    expect(parsed?.idCard).toBe('990000200801011232')
    expect(parsed?.gender).toBe('男')
  })

  it('校验码错误返回 null', () => {
    expect(parseChineseIdCard('990000200801011231')).toBeNull()
  })

  it('非法日期返回 null', () => {
    expect(parseChineseIdCard('99000020081301123X')).toBeNull()
  })

  it('15 位旧证', () => {
    const parsed = parseChineseIdCard('990000080101123')
    expect(parsed).toEqual({
      idCard: '990000080101123',
      birthDate: '2008-01-01',
      gender: '男',
    })
  })

  it('科学计数法单元格视为损坏', () => {
    expect(isCorruptedIdCardCell('1.1010120080101e+17')).toBe(true)
    expect(parseChineseIdCard('1.1010120080101e+17')).toBeNull()
  })
})

describe('mask', () => {
  it('身份证保留前4后3', () => {
    expect(maskIdCard('990000200801011232')).toBe('9900***********232')
  })

  it('手机保留前3后4', () => {
    expect(maskPhone('13812345678')).toBe('138****5678')
  })

  it('normalize 去空白', () => {
    expect(normalizeIdCard(" 9900 0020 0801 011232 ")).toBe('990000200801011232')
  })
})
