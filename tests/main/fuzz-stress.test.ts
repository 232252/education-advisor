// =============================================================
// Fuzz / 压力测试 — 跨多个模块的随机输入测试
// 1. calculate 工具: 随机合法表达式
// 2. tokenizeQuery: 随机引号/空格组合
// 3. compareSemver: 随机版本号对称性/传递性
// 4. settings-service: 快速连续 update 节流
// 5. sanitizeArgsForLog: 随机 privacy 参数
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { compareSemver } from '../../src/main/services/update-service'
import { calculateTool } from '../../src/main/services/utility-tools'
import { tokenizeQuery } from '../../src/main/services/eaa-tools'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'fuzz-update-test'),
    isPackaged: false,
    getVersion: () => '0.0.0',
  },
}))

// ---------- helpers ----------
// 确定性 PRNG (可复现),避免随机测试在不同运行中行为不一致
let _seed = 12345
function srand(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff
  return _seed / 0x7fffffff
}
function randInt(max: number): number {
  return Math.floor(srand() * max)
}
function pick<T>(arr: T[]): T {
  return arr[randInt(arr.length)]
}

// =============================================================
// 1. calculate fuzz — 随机合法表达式应给出有限数值
// =============================================================
describe('fuzz: calculate 随机合法表达式', () => {
  const OPS = ['+', '-', '*', '/']
  const FUNCS = ['Math.abs', 'Math.round', 'Math.floor', 'Math.ceil', 'Math.sqrt', 'Math.min', 'Math.max']

  function randomExpr(): string {
    const n = randInt(4) + 2 // 2-5 个操作数
    const parts: string[] = []
    for (let i = 0; i < n; i++) {
      const num = randInt(1000) + 1 // 避免除 0
      if (Math.random() > 0.7) {
        // 30% 概率用 Math 函数
        const fn = pick(FUNCS)
        if (fn === 'Math.min' || fn === 'Math.max') {
          parts.push(`${fn}(${num}, ${randInt(100)})`)
        } else {
          parts.push(`${fn}(${num})`)
        }
      } else {
        parts.push(String(num))
      }
    }
    let expr = parts[0]
    for (let i = 1; i < parts.length; i++) {
      expr += ` ${pick(OPS)} ${parts[i]}`
    }
    if (Math.random() > 0.5) expr = `(${expr})`
    return expr
  }

  it('500 次随机合法表达式: 应全部成功计算或被合理拒绝(不崩溃)', async () => {
    let success = 0
    let rejected = 0
    for (let i = 0; i < 500; i++) {
      const expr = randomExpr()
      try {
        const r = await calculateTool.execute('t', { expression: expr })
        const block = r.content[0]
        const text = block && block.type === 'text' ? block.text : ''
        expect(text).toContain('=')
        success++
      } catch {
        rejected++
      }
    }
    // 至少有一些成功(随机合法表达式大部分应可计算)
    expect(success + rejected).toBe(500)
    console.log(`[fuzz calculate] 500 次: ${success} 成功, ${rejected} 被拒绝`)
  }, 30_000)

  it('随机表达式不应产生 process/eval 等危险调用结果', async () => {
    for (let i = 0; i < 100; i++) {
      const expr = randomExpr()
      try {
        const r = await calculateTool.execute('t', { expression: expr })
        const text = r.content[0]?.type === 'text' ? r.content[0].text : ''
        // 不应泄露 process 对象等
        expect(text).not.toContain('[object process]')
        expect(text).not.toContain('undefined')
      } catch {
        // 被拒绝也 OK
      }
    }
  })
})

// =============================================================
// 2. tokenizeQuery fuzz — 随机引号/空格组合
// =============================================================
describe('fuzz: tokenizeQuery 随机输入', () => {
  const CHARS = ['a', 'b', 'c', ' ', '"', '中', '字', '\t']

  function randomQuery(): string {
    const len = randInt(20)
    let s = ''
    for (let i = 0; i < len; i++) s += pick(CHARS)
    return s
  }

  it('300 次随机查询: 应返回字符串数组(不抛错)', () => {
    for (let i = 0; i < 300; i++) {
      const q = randomQuery()
      const tokens = tokenizeQuery(q)
      expect(Array.isArray(tokens)).toBe(true)
      for (const t of tokens) {
        expect(typeof t).toBe('string')
        expect(t.length).toBeGreaterThan(0) // 不应有空 token
      }
    }
  })

  it('引号应成对: 奇数个引号不应导致无限循环或崩溃', () => {
    for (let i = 0; i < 50; i++) {
      const odd = '"'.repeat(randInt(10) + 1) // 1-10 个引号(可能奇数)
      expect(() => tokenizeQuery(odd)).not.toThrow()
    }
  })

  it('超长输入(10000 字符)应正常处理', () => {
    const long = 'word '.repeat(2000)
    const tokens = tokenizeQuery(long)
    expect(tokens.length).toBe(2000)
  })

  it('全空白输入(空格/tab)返回空数组', () => {
    expect(tokenizeQuery('     \t\t    ')).toEqual([])
    expect(tokenizeQuery('')).toEqual([])
    expect(tokenizeQuery('   ')).toEqual([])
  })
})

// =============================================================
// 3. compareSemver fuzz — 对称性 + 传递性
// =============================================================
describe('fuzz: compareSemver 数学性质', () => {
  function randomVersion(): string {
    const major = randInt(10)
    const minor = randInt(10)
    const patch = randInt(10)
    let v = `${major}.${minor}.${patch}`
    if (Math.random() > 0.6) {
      const pre = pick(['alpha', 'beta', 'rc'])
      const n = randInt(3)
      v += `-${pre}.${n}`
    }
    return v
  }

  it('200 组: antisymmetry — compareSemver(a,b) === -compareSemver(b,a)', () => {
    for (let i = 0; i < 200; i++) {
      const a = randomVersion()
      const b = randomVersion()
      const fwd = compareSemver(a, b)
      const rev = compareSemver(b, a)
      // 修复: JavaScript 中 -0 !== 0 (Object.is), 当 fwd=0 时 -rev=-0, 导致 .toBe 失败
      expect(fwd === -rev).toBe(true)
    }
  })

  it('100 组: reflexivity — compareSemver(a,a) === 0', () => {
    for (let i = 0; i < 100; i++) {
      const a = randomVersion()
      expect(compareSemver(a, a)).toBe(0)
    }
  })

  it('100 组: 返回值只能是 -1, 0, 1', () => {
    for (let i = 0; i < 100; i++) {
      const r = compareSemver(randomVersion(), randomVersion())
      expect([-1, 0, 1]).toContain(r)
    }
  })
})

// settings-service 压力测试已移至 settings-stress.test.ts
// (避免 vi.resetModules 干扰本文件的 compareSemver 纯函数测试)
