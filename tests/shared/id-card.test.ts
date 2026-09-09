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
    const parsed = parseChineseIdCard('110101200801011230')
    expect(parsed).toEqual({
      idCard: '110101200801011230',
      birthDate: '2008-01-01',
      gender: '男',
    })
  })

  it('18 位合法女证 → 出生日期与性别', () => {
    const parsed = parseChineseIdCard('110101200802022222')
    expect(parsed).toEqual({
      idCard: '110101200802022222',
      birthDate: '2008-02-02',
      gender: '女',
    })
  })

  it('容忍空格、小写 x、全角数字', () => {
    const parsed = parseChineseIdCard(' １１０１０１２００８０１０１１２３０ ')
    expect(parsed?.idCard).toBe('110101200801011230')
    expect(parsed?.gender).toBe('男')
  })

  it('校验码错误返回 null', () => {
    expect(parseChineseIdCard('110101200801011231')).toBeNull()
  })

  it('非法日期返回 null', () => {
    expect(parseChineseIdCard('11010120081301123X')).toBeNull()
  })

  it('15 位旧证', () => {
    const parsed = parseChineseIdCard('110101080101123')
    expect(parsed).toEqual({
      idCard: '110101080101123',
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
    expect(maskIdCard('110101200801011230')).toBe('1101***********230')
  })

  it('手机保留前3后4', () => {
    expect(maskPhone('13812345678')).toBe('138****5678')
  })

  it('normalize 去空白', () => {
    expect(normalizeIdCard(" 1101 0120 0801 011230 ")).toBe('110101200801011230')
  })
})
