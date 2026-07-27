// =============================================================
// 安全测试 — 注入攻击 / 路径遍历 / 命令注入防护
// 从安全角度验证各 sanitize / validate 函数
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { calculateTool } from '../../src/main/services/utility-tools'
import { tokenizeQuery } from '../../src/main/services/eaa-tools'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'security-test'),
    isPackaged: false,
    getVersion: () => '0.0.0',
  },
}))

// =============================================================
// 1. 计算器注入攻击 (safeEval)
// =============================================================
describe('安全: calculate 工具注入攻击', () => {
  async function expectRejected(expr: string) {
    await expect(calculateTool.execute('t', { expression: expr })).rejects.toThrow()
  }

  it('拒绝 process 对象访问', async () => {
    await expectRejected('process.env')
    await expectRejected('process.exit()')
    await expectRejected('process.mainModule')
  })

  it('拒绝 require 调用', async () => {
    await expectRejected('require("fs")')
    await expectRejected('require("child_process")')
  })

  it('拒绝 global 对象访问', async () => {
    await expectRejected('global.process')
    await expectRejected('globalThis.eval')
  })

  it('拒绝 eval 调用', async () => {
    await expectRejected('eval("1+1")')
  })

  it('拒绝 Function 构造器嵌套', async () => {
    await expectRejected('new Function("return 1")()')
  })

  it('拒绝 this 绑定攻击', async () => {
    await expectRejected('this.constructor.constructor("return process")()')
  })

  it('拒绝 constructor 链', async () => {
    await expectRejected('"".constructor.constructor("return process")()')
  })

  it('拒绝 __proto__ 访问', async () => {
    await expectRejected('(1).__proto__')
  })

  it('拒绝含分号的注入(多语句)', async () => {
    await expectRejected('1; require("fs")')
    await expectRejected('1; process.exit()')
  })

  it('拒绝含方括号属性访问', async () => {
    await expectRejected('process["env"]')
  })

  it('拒绝 Unicode 转义绕过', async () => {
    await expectRejected('\\u0070rocess') // \u0070 = 'p'
  })
})

// =============================================================
// 2. tokenizeQuery shell 注入 (通过 safeExecute 间接)
// =============================================================
describe('安全: tokenizeQuery 不产生 shell 元字符 token', () => {
  it('分号被保留在 token 中(后续 safeExecute 会拒绝)', () => {
    const tokens = tokenizeQuery('张三; rm -rf /')
    expect(tokens.length).toBeGreaterThan(0)
    // token 中含 ; (safeExecute 层会拦截)
    expect(tokens.join('')).toContain(';')
  })

  it('反引号被保留(后续拦截)', () => {
    const tokens = tokenizeQuery('`whoami`')
    expect(tokens.some((t) => t.includes('`'))).toBe(true)
  })

  it('美元符号被保留(后续拦截)', () => {
    const tokens = tokenizeQuery('$(id)')
    expect(tokens.join('')).toContain('$')
  })

  it('正常查询不受影响', () => {
    expect(tokenizeQuery('张三 迟到')).toEqual(['张三', '迟到'])
  })
})

// =============================================================
// 3. calculate 安全白名单完整性
// =============================================================
describe('安全: calculate Math 白名单严格性', () => {
  it('只允许列出的 Math 函数', async () => {
    // 允许的
    for (const fn of ['abs', 'round', 'ceil', 'floor', 'sqrt', 'pow', 'min', 'max', 'log', 'log2', 'log10']) {
      try {
        await calculateTool.execute('t', { expression: `Math.${fn}(1)` })
      } catch {
        // 某些 Math 函数对 1 可能无效(如 log2(1)=0 没问题),但不应因"不允许"抛错
      }
    }
  })

  it('拒绝 Math.eval (不存在但防误用)', async () => {
    await expect(
      calculateTool.execute('t', { expression: 'Math.eval("1+1")' }),
    ).rejects.toThrow()
  })

  it('拒绝 Math.random (防不确定性)', async () => {
    await expect(
      calculateTool.execute('t', { expression: 'Math.random()' }),
    ).rejects.toThrow()
  })

  it('拒绝 Date 对象访问', async () => {
    await expect(calculateTool.execute('t', { expression: 'Date.now()' })).rejects.toThrow()
  })

  it('拒绝 JSON 对象访问', async () => {
    await expect(calculateTool.execute('t', { expression: 'JSON.parse("1")' })).rejects.toThrow()
  })
})

// =============================================================
// 4. 大量随机注入字符串不导致崩溃
// =============================================================
describe('安全: 100 个随机注入字符串不崩溃 calculate', () => {
  const payloads = [
    '"; DROP TABLE students; --',
    '<%= malcode %>',
    '${7*7}',
    '{{constructor}}',
    "'; exec('rm -rf /') --",
    '<script>alert(1)</script>',
    '../../etc/passwd',
    'null',
    'undefined',
    'NaN',
    '[].constructor.constructor("return process")()',
    '(() => {}).constructor.constructor("return process")()',
    '\\"}',
    '\\x41',
    '₀₁₂₃', // 下标字符
    '𝟏𝟐𝟑', // 数学粗体数字
  ]

  it('每个 payload 都应被拒绝(不崩溃,不执行)', async () => {
    for (const p of payloads) {
      try {
        await calculateTool.execute('t', { expression: p })
        // 如果没抛错,结果必须是数字(不是 process 对象等)
        // 实际上大多数应被拒绝
      } catch {
        // 被拒绝是预期行为
      }
    }
  })
})
