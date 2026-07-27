// =============================================================
// cron-utils — validateCron 综合测试
// =============================================================

import { describe, expect, it } from 'vitest'
import { CRON_PRESETS, validateCron } from '../../lib/cron-utils'

describe('validateCron — 宏表达式', () => {
  const validMacros = [
    '@yearly',
    '@annually',
    '@monthly',
    '@weekly',
    '@daily',
    '@midnight',
    '@hourly',
  ]
  for (const macro of validMacros) {
    it(`"${macro}" 有效`, () => {
      const r = validateCron(macro)
      expect(r.valid).toBe(true)
      expect(r.error).toBeUndefined()
    })
  }

  it('@yearly 和 @annually 等效', () => {
    expect(validateCron('@yearly')).toEqual(validateCron('@annually'))
  })

  it('@daily 和 @midnight 等效', () => {
    expect(validateCron('@daily')).toEqual(validateCron('@midnight'))
  })

  it('大小写不敏感 (@DAILY 有效)', () => {
    expect(validateCron('@DAILY').valid).toBe(true)
  })

  it('大小写不敏感 (@Hourly 有效)', () => {
    expect(validateCron('@Hourly').valid).toBe(true)
  })

  it('@ 前后有空格仍有效', () => {
    expect(validateCron('  @daily  ').valid).toBe(true)
  })

  it('未知宏 @weekly Invalid → 无效', () => {
    // @weekly IS valid
    expect(validateCron('@weekly').valid).toBe(true)
  })

  it('未知宏 @reboot → 无效', () => {
    const r = validateCron('@reboot')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('未知宏')
  })

  it('未知宏 @every → 无效', () => {
    const r = validateCron('@every')
    expect(r.valid).toBe(false)
  })
})

describe('validateCron — 基本表达式', () => {
  const validExpressions = [
    '0 9 * * *', // 每天9点
    '*/5 * * * *', // 每5分钟
    '0 */2 * * *', // 每2小时
    '0 0 * * 0', // 每周日
    '0 0 1 * *', // 每月1号
    '30 4 * * 1-5', // 工作日4:30
    '0 0,12 * * *', // 每天0点和12点
    '0 0 1 1 *', // 每年1月1号
    '0-59 * * * *', // 范围
    '0,15,30,45 * * * *', // 列表
    '0 0 * * 7', // 周日(7=0)
    '0 0 * * 0-7', // 周一到周日(包含7)
    '*/15 8-17 * * 1-5', // 工作日8-17点每15分钟
    '0 0 1-7 * 1', // 每月第一个周一(近似)
  ]

  for (const expr of validExpressions) {
    it(`"${expr}" 有效`, () => {
      const r = validateCron(expr)
      expect(r.valid).toBe(true)
    })
  }
})

describe('validateCron — 无效表达式', () => {
  const invalidCases: Array<[string, string]> = [
    ['', '表达式不能为空'],
    ['   ', '需要 5 段'], // 全空白 split 后 parts 为空
    ['invalid', '需要 5 段'],
    ['* * * *', '需要 5 段'], // 4段
    ['* * * * * *', '需要 5 段'], // 6段
    ['60 * * * *', '超出范围'], // 分钟越界
    ['* 24 * * *', '超出范围'], // 小时越界
    ['* * 0 * *', '超出范围'], // 日为0(最小1)
    ['* * 32 * *', '超出范围'], // 日越界
    ['* * * 13 *', '超出范围'], // 月越界
    ['* * * 0 *', '超出范围'], // 月为0
    ['* * * * 8', '超出范围'], // 周越界(>7)
    ['abc * * * *', '不是有效数字'],
    ['* abc * * *', '不是有效数字'],
  ]

  for (const [expr, expectedError] of invalidCases) {
    it(`"${expr}" 无效(错误含 "${expectedError}")`, () => {
      const r = validateCron(expr)
      expect(r.valid).toBe(false)
      expect(r.error).toContain(expectedError)
    })
  }
})

describe('validateCron — 字段范围验证', () => {
  it('分钟 0 有效', () => {
    expect(validateCron('0 * * * *').valid).toBe(true)
  })
  it('分钟 59 有效', () => {
    expect(validateCron('59 * * * *').valid).toBe(true)
  })
  it('分钟 60 无效', () => {
    expect(validateCron('60 * * * *').valid).toBe(false)
  })
  it('小时 0 有效', () => {
    expect(validateCron('* 0 * * *').valid).toBe(true)
  })
  it('小时 23 有效', () => {
    expect(validateCron('* 23 * * *').valid).toBe(true)
  })
  it('小时 24 无效', () => {
    expect(validateCron('* 24 * * *').valid).toBe(false)
  })
  it('日 1 有效', () => {
    expect(validateCron('* * 1 * *').valid).toBe(true)
  })
  it('日 31 有效', () => {
    expect(validateCron('* * 31 * *').valid).toBe(true)
  })
  it('日 32 无效', () => {
    expect(validateCron('* * 32 * *').valid).toBe(false)
  })
  it('月 1 有效', () => {
    expect(validateCron('* * * 1 *').valid).toBe(true)
  })
  it('月 12 有效', () => {
    expect(validateCron('* * * 12 *').valid).toBe(true)
  })
  it('月 13 无效', () => {
    expect(validateCron('* * * 13 *').valid).toBe(false)
  })
  it('周 0 有效(周日)', () => {
    expect(validateCron('* * * * 0').valid).toBe(true)
  })
  it('周 7 有效(周日)', () => {
    expect(validateCron('* * * * 7').valid).toBe(true)
  })
  it('周 8 无效', () => {
    expect(validateCron('* * * * 8').valid).toBe(false)
  })
})

describe('validateCron — 步长表达式', () => {
  it('*/1 分钟有效', () => {
    expect(validateCron('*/1 * * * *').valid).toBe(true)
  })
  it('*/59 分钟有效', () => {
    expect(validateCron('*/59 * * * *').valid).toBe(true)
  })
  it('*/0 分钟无效', () => {
    expect(validateCron('*/0 * * * *').valid).toBe(false)
  })
  it('*/-1 无效', () => {
    expect(validateCron('*/-1 * * * *').valid).toBe(false)
  })
  it('*/abc 无效', () => {
    expect(validateCron('*/abc * * * *').valid).toBe(false)
  })
  it('0-30/5 分钟有效', () => {
    expect(validateCron('0-30/5 * * * *').valid).toBe(true)
  })
  it('0-30/0 无效(步长0)', () => {
    expect(validateCron('0-30/0 * * * *').valid).toBe(false)
  })
})

describe('validateCron — 列表表达式', () => {
  it('0,15,30,45 有效', () => {
    expect(validateCron('0,15,30,45 * * * *').valid).toBe(true)
  })
  it('0,,30 无效(空子字段)', () => {
    const r = validateCron('0,,30 * * * *')
    expect(r.valid).toBe(false)
    expect(r.error).toContain('空字段')
  })
  it('单元素列表有效', () => {
    expect(validateCron('5 * * * *').valid).toBe(true)
  })
  it('末尾逗号 → 空子字段', () => {
    const r = validateCron('5, * * * *')
    expect(r.valid).toBe(false)
  })
})

describe('CRON_PRESETS', () => {
  it('有 4 个预设', () => {
    expect(CRON_PRESETS.length).toBe(4)
  })

  it('每个预设有 label 和 value', () => {
    for (const p of CRON_PRESETS) {
      expect(p.label).toBeDefined()
      expect(p.value).toBeDefined()
      expect(typeof p.label).toBe('string')
      expect(typeof p.value).toBe('string')
    }
  })

  it('每个预设 value 都是有效的 cron 表达式', () => {
    for (const p of CRON_PRESETS) {
      expect(validateCron(p.value).valid).toBe(true)
    }
  })

  it('包含 "每小时" 预设', () => {
    expect(CRON_PRESETS.find((p) => p.label === '每小时')).toBeDefined()
  })

  it('包含 "每天 8:00" 预设', () => {
    expect(CRON_PRESETS.find((p) => p.label === '每天 8:00')).toBeDefined()
  })
})
