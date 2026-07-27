// =============================================================
// cron-utils 单元测试
// =============================================================

import { describe, expect, it } from 'vitest'
import { CRON_PRESETS, validateCron } from '../../../src/renderer/lib/cron-utils'

describe('cron-utils', () => {
  describe('validateCron', () => {
    it('空字符串应返回 valid=false', () => {
      expect(validateCron('')).toEqual({ valid: false, error: expect.any(String) })
    })

    it('非字符串应返回 valid=false', () => {
      expect(validateCron(null as unknown as string)).toEqual({
        valid: false,
        error: expect.any(String),
      })
    })

    it('基本表达式 "0 * * * *" 应有效', () => {
      expect(validateCron('0 * * * *')).toEqual({ valid: true })
    })

    it('"*/5 * * * *" 应有效（步长）', () => {
      expect(validateCron('*/5 * * * *')).toEqual({ valid: true })
    })

    it('"0 8 * * 1-5" 应有效（工作日 8 点）', () => {
      expect(validateCron('0 8 * * 1-5')).toEqual({ valid: true })
    })

    it('"0 0 1 1 *" 应有效（元旦）', () => {
      expect(validateCron('0 0 1 1 *')).toEqual({ valid: true })
    })

    it('"0,30 * * * *" 应有效（逗号分隔）', () => {
      expect(validateCron('0,30 * * * *')).toEqual({ valid: true })
    })

    it('"0 0 * * 0" 和 "0 0 * * 7" 都应有效（周日 = 0 或 7）', () => {
      expect(validateCron('0 0 * * 0')).toEqual({ valid: true })
      expect(validateCron('0 0 * * 7')).toEqual({ valid: true })
    })

    it('少于 5 段应无效', () => {
      const result = validateCron('0 * *')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('5')
    })

    it('多于 5 段应无效', () => {
      const result = validateCron('0 * * * * *')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('5')
    })

    it('分钟 > 59 应无效', () => {
      const result = validateCron('60 * * * *')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('分钟')
    })

    it('小时 > 23 应无效', () => {
      const result = validateCron('0 24 * * *')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('小时')
    })

    it('日 > 31 应无效', () => {
      const result = validateCron('0 0 32 * *')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('日')
    })

    it('月 > 12 应无效', () => {
      const result = validateCron('0 0 1 13 *')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('月')
    })

    it('周 > 7 应无效', () => {
      const result = validateCron('0 0 * * 8')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('周')
    })

    it('无效步长 "*/0" 应无效', () => {
      const result = validateCron('*/0 * * * *')
      expect(result.valid).toBe(false)
    })

    it('无效字符 "abc" 应无效', () => {
      const result = validateCron('abc * * * *')
      expect(result.valid).toBe(false)
    })

    it('范围 "1-5/2" 应有效', () => {
      expect(validateCron('1-5/2 * * * *')).toEqual({ valid: true })
    })

    it('范围倒置 "5-1" 仍应通过（不检查逻辑顺序）', () => {
      // 基本格式校验通过，不做语义检查
      expect(validateCron('5-1 * * * *')).toEqual({ valid: true })
    })
  })

  describe('宏表达式', () => {
    it('@daily 应有效', () => {
      expect(validateCron('@daily')).toEqual({ valid: true })
    })

    it('@hourly 应有效', () => {
      expect(validateCron('@hourly')).toEqual({ valid: true })
    })

    it('@yearly 应有效', () => {
      expect(validateCron('@yearly')).toEqual({ valid: true })
    })

    it('@monthly 应有效', () => {
      expect(validateCron('@monthly')).toEqual({ valid: true })
    })

    it('@weekly 应有效', () => {
      expect(validateCron('@weekly')).toEqual({ valid: true })
    })

    it('@annually 应有效', () => {
      expect(validateCron('@annually')).toEqual({ valid: true })
    })

    it('@midnight 应有效', () => {
      expect(validateCron('@midnight')).toEqual({ valid: true })
    })

    it('@unknown 应无效', () => {
      const result = validateCron('@unknown')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('未知宏')
    })
  })

  describe('CRON_PRESETS', () => {
    it('应有至少 3 个预设', () => {
      expect(CRON_PRESETS.length).toBeGreaterThanOrEqual(3)
    })

    it('每个预设的 value 都应通过验证', () => {
      for (const preset of CRON_PRESETS) {
        expect(preset.label).toBeTruthy()
        expect(validateCron(preset.value).valid).toBe(true)
      }
    })
  })
})
