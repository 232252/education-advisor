// =============================================================
// i18n 字典完整性测试 — zh/en key 一致性、无空值、无重复
// 捕获: 缺失翻译、空翻译、两边 key 不匹配
// =============================================================

import { describe, expect, it } from 'vitest'
import enDict from '../en.json'
import zhDict from '../zh.json'

describe('i18n 字典完整性', () => {
  const zhKeys = Object.keys(zhDict).sort()
  const enKeys = Object.keys(enDict).sort()

  it('zh 字典应非空', () => {
    expect(zhKeys.length).toBeGreaterThan(50)
  })

  it('en 字典应非空', () => {
    expect(enKeys.length).toBeGreaterThan(50)
  })

  it('zh 和 en 应有完全相同的 key 集合(无缺失翻译)', () => {
    const zhOnly = zhKeys.filter((k) => !enKeys.includes(k))
    const enOnly = enKeys.filter((k) => !zhKeys.includes(k))
    if (zhOnly.length > 0 || enOnly.length > 0) {
      // 输出差异帮助定位
      console.log('zh 有但 en 缺失:', zhOnly)
      console.log('en 有但 zh 缺失:', enOnly)
    }
    expect(zhOnly).toEqual([])
    expect(enOnly).toEqual([])
  })

  it('zh 字典不应有空字符串值', () => {
    const empties = zhKeys.filter((k) => (zhDict as Record<string, string>)[k] === '')
    expect(empties).toEqual([])
  })

  it('en 字典不应有空字符串值', () => {
    const empties = enKeys.filter((k) => (enDict as Record<string, string>)[k] === '')
    expect(empties).toEqual([])
  })

  it('不应有重复 key(JSON 天然不重复,但验证)', () => {
    // JSON.parse 保证无重复,这里验证 key 数量合理
    expect(zhKeys.length).toBe(new Set(zhKeys).size)
    expect(enKeys.length).toBe(new Set(enKeys).size)
  })

  it('key 命名应使用点号分层(如 page.title)', () => {
    const bad = zhKeys.filter((k) => !k.includes('.') && !k.includes('_'))
    // 允许少量无点号的 key(如纯标识符),但不应过多
    expect(bad.length).toBeLessThan(zhKeys.length * 0.1)
  })
})

describe('i18n 字典 — 值质量', () => {
  it('zh 值应包含中文字符(大部分)', () => {
    const zhValues = Object.values(zhDict) as string[]
    const withChinese = zhValues.filter((v) => /[\u4e00-\u9fff]/.test(v))
    // 至少 60% 的中文翻译应实际包含中文字符
    expect(withChinese.length / zhValues.length).toBeGreaterThan(0.6)
  })

  it('en 值应包含 ASCII 字母(大部分)', () => {
    const enValues = Object.values(enDict) as string[]
    const withAscii = enValues.filter((v) => /[a-zA-Z]/.test(v))
    expect(withAscii.length / enValues.length).toBeGreaterThan(0.6)
  })

  it('不应有明显的占位符残留(如 TODO/FIXME/XXX)', () => {
    const allValues = [...Object.values(zhDict), ...Object.values(enDict)] as string[]
    const placeholders = allValues.filter((v) => /\b(TODO|FIXME|XXX|placeholder)\b/i.test(v))
    expect(placeholders).toEqual([])
  })

  it('翻译值不应过长(>500 字符可能是错误)', () => {
    const allValues = [...Object.values(zhDict), ...Object.values(enDict)] as string[]
    const tooLong = allValues.filter((v) => v.length > 500)
    expect(tooLong.length).toBe(0)
  })

  it('翻译值不应是纯空白', () => {
    const allValues = [...Object.values(zhDict), ...Object.values(enDict)] as string[]
    const whitespace = allValues.filter((v) => v.trim().length === 0)
    expect(whitespace).toEqual([])
  })
})

describe('i18n 字典 — 关键命名空间 key 存在性', () => {
  const expectedKeyPrefixes = ['common', 'settings', 'nav', 'page', 'toast', 'error']

  for (const prefix of expectedKeyPrefixes) {
    it(`应包含 "${prefix}" 前缀的 key`, () => {
      const zhHas = Object.keys(zhDict).some((k) => k.startsWith(prefix))
      expect(zhHas).toBe(true)
    })
  }
})
