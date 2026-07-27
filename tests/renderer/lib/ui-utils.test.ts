// =============================================================
// ui-utils 单元测试
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  INPUT_BASE,
  badgeStyle,
  btnStyle,
  cn,
  riskBgColor,
  riskColor,
  riskDotColor,
} from '../../../src/renderer/lib/ui-utils'

describe('ui-utils', () => {
  describe('cn (class merge)', () => {
    it('合并有效 class', () => {
      expect(cn('a', 'b', 'c')).toBe('a b c')
    })

    it('过滤 falsy 值', () => {
      expect(cn('a', false, null, undefined, 'b')).toBe('a b')
    })

    it('全部 falsy 返回空字符串', () => {
      expect(cn(false, null, undefined)).toBe('')
    })

    it('单值', () => {
      expect(cn('only')).toBe('only')
    })
  })

  describe('riskColor', () => {
    it('低 → green', () => {
      expect(riskColor('低')).toContain('green')
    })

    it('中 → yellow', () => {
      expect(riskColor('中')).toContain('yellow')
    })

    it('高 → orange', () => {
      expect(riskColor('高')).toContain('orange')
    })

    it('极高 → red + bold', () => {
      const result = riskColor('极高')
      expect(result).toContain('red')
      expect(result).toContain('bold')
    })

    it('未知风险 → gray', () => {
      expect(riskColor('unknown')).toContain('gray')
    })
  })

  describe('riskBgColor', () => {
    it('低 → green bg', () => {
      expect(riskBgColor('低')).toContain('bg-green')
    })

    it('极高 → red bg', () => {
      expect(riskBgColor('极高')).toContain('bg-red')
    })

    it('未知 → gray bg', () => {
      expect(riskBgColor('')).toContain('bg-gray')
    })
  })

  describe('riskDotColor', () => {
    it('低 → bg-green-500', () => {
      expect(riskDotColor('低')).toBe('bg-green-500')
    })

    it('极高 → bg-red-500', () => {
      expect(riskDotColor('极高')).toBe('bg-red-500')
    })
  })

  describe('btnStyle', () => {
    it('primary 包含 blue-600', () => {
      expect(btnStyle('primary')).toContain('blue-600')
    })

    it('danger 包含 red-600', () => {
      expect(btnStyle('danger')).toContain('red-600')
    })

    it('secondary 包含 border', () => {
      expect(btnStyle('secondary')).toContain('border')
    })

    it('ghost 包含 hover:bg-gray', () => {
      expect(btnStyle('ghost')).toContain('hover:bg-gray')
    })

    it('默认是 primary', () => {
      expect(btnStyle()).toContain('blue-600')
    })

    it('所有变体都包含 rounded-lg', () => {
      for (const v of ['primary', 'secondary', 'danger', 'ghost'] as const) {
        expect(btnStyle(v)).toContain('rounded-lg')
      }
    })

    it('所有变体都包含 focus:ring', () => {
      for (const v of ['primary', 'secondary', 'danger', 'ghost'] as const) {
        expect(btnStyle(v)).toContain('focus:ring')
      }
    })
  })

  describe('badgeStyle', () => {
    it('info 包含 blue', () => {
      expect(badgeStyle('info')).toContain('blue')
    })

    it('success 包含 green', () => {
      expect(badgeStyle('success')).toContain('green')
    })

    it('warning 包含 yellow', () => {
      expect(badgeStyle('warning')).toContain('yellow')
    })

    it('danger 包含 red', () => {
      expect(badgeStyle('danger')).toContain('red')
    })

    it('neutral 包含 gray', () => {
      expect(badgeStyle('neutral')).toContain('gray')
    })

    it('所有变体包含 rounded-full', () => {
      for (const v of ['info', 'success', 'warning', 'danger', 'neutral'] as const) {
        expect(badgeStyle(v)).toContain('rounded-full')
      }
    })
  })

  describe('INPUT_BASE', () => {
    it('包含 rounded-lg', () => {
      expect(INPUT_BASE).toContain('rounded-lg')
    })

    it('包含 focus:ring', () => {
      expect(INPUT_BASE).toContain('focus:ring')
    })

    it('包含 border', () => {
      expect(INPUT_BASE).toContain('border')
    })
  })
})
