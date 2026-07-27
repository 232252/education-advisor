// =============================================================
// utility-tools 回归测试 — 多 Math 调用 / 一元负号 / 边界表达式
// 这些用例直接暴露并锁定了此前 safeEval 的两处 bug:
//   [C.2] 非 global 正则只替换首个 Math.xxx → 多 Math 调用被误拒
//   [C.3] 连续运算符检查未放行一元负号 → "100 + -5" 被误拒
// =============================================================

import { describe, expect, it } from 'vitest'
import { calculateTool } from '../../src/main/services/utility-tools'

async function calc(expr: string): Promise<string> {
  const r = await calculateTool.execute('t', { expression: expr })
  const block = r.content[0]
  return block && block.type === 'text' ? block.text : ''
}

async function calcThrows(expr: string): Promise<boolean> {
  try {
    await calculateTool.execute('t', { expression: expr })
    return false
  } catch {
    return true
  }
}

describe('calculateTool — 多 Math 调用 (C.2 回归)', () => {
  it('Math.min(1,2) + Math.max(3,4) 应成功计算', async () => {
    const out = await calc('Math.min(1,2) + Math.max(3,4)')
    expect(out).toContain('5') // 1 + 4 = 5
  })

  it('三个 Math 调用混合: Math.abs(-3) + Math.min(2,5) - Math.max(1,9)', async () => {
    const out = await calc('Math.abs(-3) + Math.min(2,5) - Math.max(1,9)')
    expect(out).toContain('-4') // 3 + 2 - 9 = -4
  })

  it('Math.round(2.4) + Math.floor(3.7) + Math.ceil(1.1)', async () => {
    const out = await calc('Math.round(2.4) + Math.floor(3.7) + Math.ceil(1.1)')
    expect(out).toContain('7') // 2 + 3 + 2 = 7
  })

  it('Math.sqrt(16) + Math.pow(2,3)', async () => {
    const out = await calc('Math.sqrt(16) + Math.pow(2,3)')
    expect(out).toContain('12') // 4 + 8
  })

  it('Math.log/Math.log2/Math.log10 应被允许', async () => {
    // 注意: Math.E 常量不在白名单中,所以这里用数值字面量
    // Math.log(Math.E)=1,改用 Math.log(2.718281828)≈1
    const out = await calc('Math.log(2.718281828) + Math.log2(8) + Math.log10(100)')
    expect(out).toMatch(/6(\.|$)/) // ≈1 + 3 + 2
  })
})

describe('calculateTool — 一元负号 (C.3 回归)', () => {
  it('100 + -5 应成功 (= 95)', async () => {
    const out = await calc('100 + -5')
    expect(out).toContain('95')
  })

  it('3 * -2 应成功 (= -6)', async () => {
    const out = await calc('3 * -2')
    expect(out).toContain('-6')
  })

  it('10 - -1 应成功 (= 11)', async () => {
    const out = await calc('10 - -1')
    expect(out).toContain('11')
  })

  it('10 / -2 应成功 (= -5)', async () => {
    const out = await calc('10 / -2')
    expect(out).toContain('-5')
  })

  it('带括号的一元负号: (-5) * 3', async () => {
    const out = await calc('(-5) * 3')
    expect(out).toContain('-15')
  })

  it('混合: 100 + -5 * 3 应正确处理优先级 (= 85)', async () => {
    const out = await calc('100 + -5 * 3')
    expect(out).toContain('85') // 100 + (-15)
  })

  it('多重一元负号: 5 - - -1 应被拒绝(三个连续减号属于歧义表达式)', async () => {
    // 5 - - -1 = 5 - -(-1) = 4 在 JS 中合法,但三连减号是歧义表达式,
    // 拒绝它是合理的防御性行为
    expect(await calcThrows('5 - - -1')).toBe(true)
  })
})

describe('calculateTool — 仍应拒绝真正的非法表达式', () => {
  it('连续 ++ 应拒绝', async () => {
    expect(await calcThrows('5 ++ 5')).toBe(true)
  })

  it('连续 ** 应拒绝(不支持指数运算)', async () => {
    expect(await calcThrows('2 ** 5')).toBe(true)
  })

  it('连续 */ 应拒绝', async () => {
    expect(await calcThrows('5 */ 2')).toBe(true)
  })

  it('字母变量应拒绝', async () => {
    expect(await calcThrows('abc + 1')).toBe(true)
  })

  it('函数调用(非 Math 白名单)应拒绝', async () => {
    expect(await calcThrows('eval("1+1")')).toBe(true)
  })

  it('除以 0 → Infinity 应拒绝', async () => {
    expect(await calcThrows('10 / 0')).toBe(true)
  })

  it('空表达式应抛错', async () => {
    expect(await calcThrows('')).toBe(true)
  })

  it('注入式 process 应拒绝', async () => {
    expect(await calcThrows('1; process.exit()')).toBe(true)
  })
})

describe('calculateTool — 已有功能回归 (确认修复未破坏既有行为)', () => {
  it('简单加法', async () => {
    expect(await calc('1 + 2')).toContain('3')
  })
  it('带括号', async () => {
    expect(await calc('(2 + 3) * 4')).toContain('20')
  })
  it('百分比', async () => {
    expect(await calc('100 * 85%')).toContain('85')
  })
  it('全角符号', async () => {
    expect(await calc('3 × 22')).toContain('66')
  })
  it('单 Math.min', async () => {
    expect(await calc('Math.min(3, 7)')).toContain('3')
  })
  it('整数不显示小数点', async () => {
    expect(await calc('4 / 2')).toBe('🧮 4 / 2 = 2')
  })
  it('浮点最多6位', async () => {
    expect(await calc('10 / 3')).toMatch(/3\.333333/)
  })
})
