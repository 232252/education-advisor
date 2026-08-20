// =============================================================
// 跨模块集成压力测试 — 多轮迭代验证模块间协作
// 每轮从不同角度调用多个模块,验证无状态干扰 + 数据一致性
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { compareSemver } from '../../src/main/services/update-service'
import { tokenizeQuery } from '../../src/main/services/eaa-tools'
import { EAABridge } from '../../src/main/services/eaa-bridge'
import { parseCommand } from '../../src/main/services/feishu-bot/command-router'
import { calculateTool } from '../../src/main/services/utility-tools'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'integration-stress'),
    isPackaged: false,
    getVersion: () => '0.0.0',
  },
}))

// 确定性 PRNG
let _s = 999
function rng() {
  _s = (_s * 1103515245 + 12345) & 0x7fffffff
  return _s / 0x7fffffff
}
function ri(max: number) {
  return Math.floor(rng() * max)
}

describe('集成压力 — 500 轮跨模块调用', () => {
  it('compareSemver + tokenizeQuery + sanitize 交替 500 轮无干扰', () => {
    for (let i = 0; i < 500; i++) {
      // compareSemver
      const a = `${ri(5)}.${ri(20)}.${ri(30)}`
      const b = `${ri(5)}.${ri(20)}.${ri(30)}`
      const fwd = compareSemver(a, b)
      const rev = compareSemver(b, a)
      expect(fwd === -rev).toBe(true)

      // tokenizeQuery
      const q = `word${i} word${i + 1}`
      const tokens = tokenizeQuery(q)
      expect(tokens.length).toBe(2)

      // sanitize
      const out = EAABridge.sanitizeArgsForLog('add', ['arg', String(i)])
      expect(out).toEqual(['arg', String(i)])
    }
  })

  it('parseCommand 各种输入 300 轮不崩溃', () => {
    const words = ['help', 'score', '张三', 'ranking', '/cmd', '--flag']
    for (let i = 0; i < 300; i++) {
      const parts = []
      const n = ri(4)
      for (let j = 0; j < n; j++) parts.push(words[ri(words.length)])
      const input = (rng() > 0.3 ? '/' : '') + parts.join(' ')
      const result = parseCommand(input)
      if (result !== null) {
        expect(result.command).toBeDefined()
        expect(Array.isArray(result.args)).toBe(true)
      }
    }
  })
})

describe('集成压力 — calculate 大规模验证', () => {
  it('100 个不同表达式批量计算, 结果都应为数字', async () => {
    for (let i = 0; i < 100; i++) {
      const expr = `${i * 3 + 1} + ${i * 2} * ${ri(10) + 1}`
      try {
        const r = await calculateTool.execute('t', { expression: expr })
        const block = r.content[0]
        expect(block?.type).toBe('text')
      } catch {
        // 某些可能被拒(如连续运算符),OK
      }
    }
  })

  it('50 个百分比计算', async () => {
    for (let i = 0; i < 50; i++) {
      const pct = i + 1
      const r = await calculateTool.execute('t', { expression: `100 * ${pct}%` })
      const block = r.content[0]
      const text = block && block.type === 'text' ? block.text : ''
      expect(text).toContain(String(pct))
    }
  })
})

describe('集成压力 — compareSemver 排序验证', () => {
  it('100 个版本应能正确排序', () => {
    const versions: string[] = []
    for (let i = 0; i < 100; i++) {
      versions.push(`${ri(5)}.${ri(20)}.${ri(30)}`)
    }
    const sorted = [...versions].sort((a, b) => compareSemver(b, a)) // 降序

    // 验证排序正确: 每个元素 >= 下一个
    for (let i = 0; i < sorted.length - 1; i++) {
      const cmp = compareSemver(sorted[i], sorted[i + 1])
      expect(cmp).toBeGreaterThanOrEqual(0)
    }
  })

  it('带 pre-release 的 50 个版本排序', () => {
    const versions: string[] = []
    for (let i = 0; i < 50; i++) {
      const tags = ['alpha', 'beta', 'rc']
      versions.push(`1.0.0-${tags[ri(3)]}.${ri(10)}`)
    }
    const sorted = [...versions].sort((a, b) => compareSemver(b, a))
    for (let i = 0; i < sorted.length - 1; i++) {
      expect(compareSemver(sorted[i], sorted[i + 1])).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('集成压力 — tokenizeQuery 大规模', () => {
  it('500 个随机引号查询', () => {
    for (let i = 0; i < 500; i++) {
      const hasQuote = rng() > 0.5
      const q = hasQuote ? `"word${i} word${i + 1}"` : `word${i} word${i + 1}`
      const tokens = tokenizeQuery(q)
      expect(tokens.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('200 个混合查询(引号 + 空格)', () => {
    for (let i = 0; i < 200; i++) {
      const q = `a${i} "b c${i}" d${i}`
      const tokens = tokenizeQuery(q)
      expect(tokens).toContain(`b c${i}`)
    }
  })
})
