// =============================================================
// ui-utils — riskColor/riskBgColor/riskDotColor/agentStatusColor/cn/btnStyle/badgeStyle 测试
// =============================================================

import { describe, expect, it } from 'vitest'
import {
  agentStatusColor,
  badgeStyle,
  btnStyle,
  CARD_BASE,
  CARD_INTERACTIVE,
  cn,
  INPUT_BASE,
  riskBgColor,
  riskColor,
  riskDotColor,
} from '../../lib/ui-utils'

describe('riskColor', () => {
  it('"低" → green', () => {
    expect(riskColor('低')).toContain('green')
  })
  it('"中" → yellow', () => {
    expect(riskColor('中')).toContain('yellow')
  })
  it('"高" → orange', () => {
    expect(riskColor('高')).toContain('orange')
  })
  it('"极高" → red + bold', () => {
    expect(riskColor('极高')).toContain('red')
    expect(riskColor('极高')).toContain('font-bold')
  })
  it('未知风险 → gray', () => {
    expect(riskColor('unknown')).toContain('gray')
  })
  it('空串 → gray', () => {
    expect(riskColor('')).toContain('gray')
  })
  it('所有返回值包含 dark: 变体', () => {
    for (const r of ['低', '中', '高', '极高'] as const) {
      const cls = riskColor(r)
      expect(cls).toContain('dark:')
    }
  })
})

describe('riskBgColor', () => {
  it('"低" → bg-green', () => {
    expect(riskBgColor('低')).toContain('bg-green')
  })
  it('"中" → bg-yellow', () => {
    expect(riskBgColor('中')).toContain('bg-yellow')
  })
  it('"高" → bg-orange', () => {
    expect(riskBgColor('高')).toContain('bg-orange')
  })
  it('"极高" → bg-red', () => {
    expect(riskBgColor('极高')).toContain('bg-red')
  })
  it('未知 → bg-gray', () => {
    expect(riskBgColor('unknown')).toContain('bg-gray')
  })
  it('每个背景色包含 dark: 变体', () => {
    for (const r of ['低', '中', '高', '极高'] as const) {
      expect(riskBgColor(r)).toContain('dark:')
    }
  })
})

describe('riskDotColor', () => {
  it('"低" → bg-green-500', () => {
    expect(riskDotColor('低')).toBe('bg-green-500')
  })
  it('"中" → bg-yellow-500', () => {
    expect(riskDotColor('中')).toBe('bg-yellow-500')
  })
  it('"高" → bg-orange-500', () => {
    expect(riskDotColor('高')).toBe('bg-orange-500')
  })
  it('"极高" → bg-red-500', () => {
    expect(riskDotColor('极高')).toBe('bg-red-500')
  })
  it('未知 → bg-gray-400', () => {
    expect(riskDotColor('unknown')).toBe('bg-gray-400')
  })
  it('空串 → bg-gray-400', () => {
    expect(riskDotColor('')).toBe('bg-gray-400')
  })
})

describe('agentStatusColor', () => {
  it('"running" → bg-blue + animate-pulse', () => {
    const cls = agentStatusColor('running')
    expect(cls).toContain('bg-blue')
    expect(cls).toContain('animate-pulse')
  })
  it('"error" → bg-red', () => {
    expect(agentStatusColor('error')).toContain('bg-red')
  })
  it('"idle" → bg-gray', () => {
    expect(agentStatusColor('idle')).toContain('bg-gray')
  })
  it('未知状态 → bg-gray-300', () => {
    expect(agentStatusColor('unknown')).toBe('bg-gray-300')
  })
  it('空串 → bg-gray-300', () => {
    expect(agentStatusColor('')).toBe('bg-gray-300')
  })
})

describe('cn — class 合并', () => {
  it('拼接多个字符串', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c')
  })
  it('过滤 false', () => {
    expect(cn('a', false, 'b')).toBe('a b')
  })
  it('过滤 null', () => {
    expect(cn('a', null, 'b')).toBe('a b')
  })
  it('过滤 undefined', () => {
    expect(cn('a', undefined, 'b')).toBe('a b')
  })
  it('全 falsy → 空串', () => {
    expect(cn(false, null, undefined)).toBe('')
  })
  it('空参数 → 空串', () => {
    expect(cn()).toBe('')
  })
  it('单个字符串', () => {
    expect(cn('only')).toBe('only')
  })
  it('混合 truthy/falsy', () => {
    expect(cn('keep', false, 'also', null, 'yes', undefined, 'end')).toBe('keep also yes end')
  })
  it('含空字符串(空串是 falsy 被 filter 过滤)', () => {
    // 空字符串 is falsy → filter(Boolean) 会移除
    expect(cn('', 'a', '', 'b')).toBe('a b')
  })
  it('含 Tailwind class 名', () => {
    expect(cn('text-sm', 'font-bold', false, 'text-red-500')).toBe('text-sm font-bold text-red-500')
  })
})

describe('btnStyle', () => {
  it('默认 → primary', () => {
    const cls = btnStyle()
    expect(cls).toContain('bg-blue-600')
  })
  it('primary → blue', () => {
    expect(btnStyle('primary')).toContain('bg-blue-600')
  })
  it('secondary → gray', () => {
    const cls = btnStyle('secondary')
    expect(cls).toContain('bg-gray-100')
    expect(cls).toContain('border')
  })
  it('danger → red', () => {
    expect(btnStyle('danger')).toContain('bg-red-600')
  })
  it('ghost → hover only', () => {
    const cls = btnStyle('ghost')
    expect(cls).toContain('hover:bg-gray-100')
    expect(cls).not.toContain('bg-blue')
  })
  it('所有变体含 base 样式', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'ghost'] as const) {
      const cls = btnStyle(variant)
      expect(cls).toContain('inline-flex')
      expect(cls).toContain('rounded-lg')
      expect(cls).toContain('disabled:opacity-50')
    }
  })
  it('所有变体含 focus ring', () => {
    for (const variant of ['primary', 'secondary', 'danger', 'ghost'] as const) {
      expect(btnStyle(variant)).toContain('focus:ring')
    }
  })
})

describe('badgeStyle', () => {
  it('默认 → neutral', () => {
    const cls = badgeStyle()
    expect(cls).toContain('bg-gray-100')
  })
  it('info → blue', () => {
    expect(badgeStyle('info')).toContain('bg-blue')
  })
  it('success → green', () => {
    expect(badgeStyle('success')).toContain('bg-green')
  })
  it('warning → yellow', () => {
    expect(badgeStyle('warning')).toContain('bg-yellow')
  })
  it('danger → red', () => {
    expect(badgeStyle('danger')).toContain('bg-red')
  })
  it('neutral → gray', () => {
    expect(badgeStyle('neutral')).toContain('bg-gray')
  })
  it('所有变体含 base 样式', () => {
    for (const variant of ['info', 'success', 'warning', 'danger', 'neutral'] as const) {
      const cls = badgeStyle(variant)
      expect(cls).toContain('inline-flex')
      expect(cls).toContain('rounded-full')
      expect(cls).toContain('text-xs')
    }
  })
})

describe('设计 tokens', () => {
  it('CARD_BASE 含 rounded-xl', () => {
    expect(CARD_BASE).toContain('rounded-xl')
  })
  it('CARD_BASE 含 border', () => {
    expect(CARD_BASE).toContain('border')
  })
  it('CARD_INTERACTIVE 含 hover shadow', () => {
    expect(CARD_INTERACTIVE).toContain('hover:shadow')
  })
  it('CARD_INTERACTIVE 继承 CARD_BASE', () => {
    expect(CARD_INTERACTIVE).toContain(CARD_BASE)
  })
  it('INPUT_BASE 含 rounded-lg', () => {
    expect(INPUT_BASE).toContain('rounded-lg')
  })
  it('INPUT_BASE 含 focus ring', () => {
    expect(INPUT_BASE).toContain('focus:ring')
  })
  it('INPUT_BASE 含 px-3 py-2', () => {
    expect(INPUT_BASE).toContain('px-3')
    expect(INPUT_BASE).toContain('py-2')
  })
})
