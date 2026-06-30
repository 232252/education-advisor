// =============================================================
// Utility Tools 测试 — get_current_time / calculate 工具
// 覆盖：工具元数据、时间格式化、数学表达式求值（含全角符号、百分比、安全检查）
// =============================================================

import { describe, expect, it } from 'vitest'
import { allUtilityTools, calculateTool, getCurrentTimeTool } from '../../src/main/services/utility-tools'

describe('utility-tools', () => {
  describe('allUtilityTools 导出', () => {
    it('应包含 2 个工具', () => {
      expect(allUtilityTools).toHaveLength(2)
      expect(allUtilityTools.map((t) => t.name)).toEqual(
        expect.arrayContaining(['get_current_time', 'calculate']),
      )
    })
  })

  describe('getCurrentTimeTool', () => {
    it('应有正确的元数据', () => {
      expect(getCurrentTimeTool.name).toBe('get_current_time')
      expect(getCurrentTimeTool.label).toBe('获取当前时间')
      expect(getCurrentTimeTool.description).toContain('日期')
      expect(getCurrentTimeTool.parameters).toBeDefined()
    })

    it('execute 应返回包含日期/时间/星期/类型的文本', async () => {
      const result = await getCurrentTimeTool.execute('call-1', {})
      expect(result.details).toEqual({})
      expect(result.content).toHaveLength(1)
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('当前时间')
      expect(text).toContain('日期:')
      expect(text).toContain('时间:')
      expect(text).toContain('星期:')
      expect(text).toContain('类型:')
      expect(text).toContain('时区:')
      expect(text).toContain('ISO:')
      // 周末/工作日二选一
      expect(text.includes('周末') || text.includes('工作日')).toBe(true)
    })

    it('指定 timezone=Asia/Shanghai 应使用该时区', async () => {
      const result = await getCurrentTimeTool.execute('call-2', { timezone: 'Asia/Shanghai' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('Asia/Shanghai')
    })

    it('指定 timezone=UTC 应使用 UTC', async () => {
      const result = await getCurrentTimeTool.execute('call-3', { timezone: 'UTC' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('UTC')
    })
  })

  describe('calculateTool', () => {
    it('应有正确的元数据', () => {
      expect(calculateTool.name).toBe('calculate')
      expect(calculateTool.label).toBe('数学计算')
      expect(calculateTool.description).toContain('加减乘除')
    })

    it('简单加法', async () => {
      const result = await calculateTool.execute('c1', { expression: '1 + 2' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('1 + 2 = 3')
    })

    it('乘法', async () => {
      const result = await calculateTool.execute('c2', { expression: '3 * 22' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('3 * 22 = 66')
    })

    it('带括号的复杂表达式', async () => {
      const result = await calculateTool.execute('c3', { expression: '(198 + 170 + 156) / 3' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('= 174.666667')
    })

    it('减法', async () => {
      const result = await calculateTool.execute('c4', { expression: '29 - 6' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('29 - 6 = 23')
    })

    it('百分比 100 * 85%', async () => {
      const result = await calculateTool.execute('c5', { expression: '100 * 85%' })
      const text = (result.content[0] as { text: string }).text
      // 85% = 0.85, 100 * 0.85 = 85
      expect(text).toContain('= 85')
    })

    it('全角符号 × ÷ ＋ － （ ）', async () => {
      const result = await calculateTool.execute('c6', { expression: '（12 ＋ 8） × 2 ÷ 4 － 1' })
      const text = (result.content[0] as { text: string }).text
      // (12+8)*2/4 - 1 = 20*0.5 - 1 = 10 - 1 = 9
      expect(text).toContain('= 9')
    })

    it('浮点数运算', async () => {
      const result = await calculateTool.execute('c7', { expression: '0.1 + 0.2' })
      const text = (result.content[0] as { text: string }).text
      // 0.1 + 0.2 = 0.30000000000000004, 但 toFixed(6) 后为 0.3
      expect(text).toContain('= 0.3')
    })

    it('整数除法应给出整数', async () => {
      const result = await calculateTool.execute('c8', { expression: '10 / 2' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('= 5')
    })

    it('应拒绝包含字母的变量', async () => {
      await expect(calculateTool.execute('c9', { expression: 'foo + 1' })).rejects.toThrow(
        /不允许的字符/,
      )
    })

    it('应拒绝函数调用 (非 Math 白名单)', async () => {
      await expect(
        calculateTool.execute('c10', { expression: 'eval("1+1")' }),
      ).rejects.toThrow(/不允许的字符|计算失败/)
    })

    it('应拒绝注入式语法', async () => {
      await expect(
        calculateTool.execute('c11', { expression: '1; console.log("pwned")' }),
      ).rejects.toThrow(/不允许的字符|计算失败/)
    })

    it('连续运算符应被拒绝', async () => {
      await expect(calculateTool.execute('c12', { expression: '1 ++ 2' })).rejects.toThrow(
        /连续运算符|不允许的字符/,
      )
    })

    it('Math.sqrt 应被允许', async () => {
      const result = await calculateTool.execute('c13', { expression: 'Math.sqrt(16)' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('= 4')
    })

    it('Math.pow 应被允许', async () => {
      const result = await calculateTool.execute('c14', { expression: 'Math.pow(2, 10)' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('= 1024')
    })

    it('Math.abs 应被允许', async () => {
      const result = await calculateTool.execute('c15', { expression: 'Math.abs(-42)' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('= 42')
    })

    it('Math.min / Math.max 应被允许', async () => {
      const r1 = await calculateTool.execute('c16', { expression: 'Math.min(3, 5, 1)' })
      expect((r1.content[0] as { text: string }).text).toContain('= 1')
      const r2 = await calculateTool.execute('c17', { expression: 'Math.max(3, 5, 1)' })
      expect((r2.content[0] as { text: string }).text).toContain('= 5')
    })

    it('Math.floor / Math.ceil / Math.round 应被允许', async () => {
      const r1 = await calculateTool.execute('c18', { expression: 'Math.floor(3.7)' })
      expect((r1.content[0] as { text: string }).text).toContain('= 3')
      const r2 = await calculateTool.execute('c19', { expression: 'Math.ceil(3.2)' })
      expect((r2.content[0] as { text: string }).text).toContain('= 4')
      const r3 = await calculateTool.execute('c20', { expression: 'Math.round(3.5)' })
      expect((r3.content[0] as { text: string }).text).toContain('= 4')
    })

    it('除以 0 应给出 Infinity 并被拒绝 (非有限数)', async () => {
      await expect(calculateTool.execute('c21', { expression: '1 / 0' })).rejects.toThrow(
        /计算结果无效|Infinity/,
      )
    })

    it('空表达式应抛错', async () => {
      await expect(calculateTool.execute('c22', { expression: '' })).rejects.toThrow()
    })

    it('整数结果不显示小数点', async () => {
      const result = await calculateTool.execute('c23', { expression: '6 * 7' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('= 42')
      expect(text).not.toContain('42.')
    })

    it('浮点结果最多 6 位小数', async () => {
      const result = await calculateTool.execute('c24', { expression: '10 / 3' })
      const text = (result.content[0] as { text: string }).text
      expect(text).toContain('3.333333')
    })
  })
})
