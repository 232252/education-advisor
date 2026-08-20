// =============================================================
// 跨模块压力测试 — 大量迭代验证稳定性
// 每个测试运行数百次,从不同角度验证不变量
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import { compareSemver } from '../../src/main/services/update-service'
import { tokenizeQuery } from '../../src/main/services/eaa-tools'
import { EAABridge } from '../../src/main/services/eaa-bridge'
import { parseCommand } from '../../src/main/services/feishu-bot/command-router'

vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'stress-cross-test'),
    isPackaged: false,
    getVersion: () => '0.0.0',
  },
}))

// =============================================================
// 1. compareSemver — 1000 次随机版本对比的数学一致性
// =============================================================
describe('stress: compareSemver 1000 次随机版本', () => {
  // 确定性 PRNG(可复现),避免 Math.random 在不同运行环境下产生不同序列
  let _seed = 42
  function srand() {
    _seed = (_seed * 1103515245 + 12345) & 0x7fffffff
    return _seed / 0x7fffffff
  }
  function randVer(): string {
    const parts = [Math.floor(srand() * 5), Math.floor(srand() * 20), Math.floor(srand() * 30)]
    let v = parts.join('.')
    if (srand() > 0.5) {
      const tags = ['alpha', 'beta', 'rc', 'preview']
      v += `-${tags[Math.floor(srand() * tags.length)]}`
      if (srand() > 0.5) v += `.${Math.floor(srand() * 20)}`
    }
    return v
  }

  it('antisymmetry: 1000 组 (a,b) → fwd === -rev', () => {
    let violations = 0
    for (let i = 0; i < 1000; i++) {
      const a = randVer()
      const b = randVer()
      const fwd = compareSemver(a, b)
      const rev = compareSemver(b, a)
      if (fwd !== -rev) violations++
    }
    expect(violations).toBe(0)
  })

  it('返回值范围: 1000 次都 ∈ {-1,0,1}', () => {
    for (let i = 0; i < 1000; i++) {
      const r = compareSemver(randVer(), randVer())
      expect([-1, 0, 1]).toContain(r)
    }
  })

  it('self-equality: 500 次 compareSemver(a,a) === 0', () => {
    for (let i = 0; i < 500; i++) {
      const a = randVer()
      expect(compareSemver(a, a)).toBe(0)
    }
  })
})

// =============================================================
// 2. tokenizeQuery — 500 次随机输入不抛错
// =============================================================
describe('stress: tokenizeQuery 500 次随机输入', () => {
  const CHARS = ['a', 'b', '1', ' ', '"', '中', '\t', '\n', '-']

  function randQuery(): string {
    const len = Math.floor(Math.random() * 30)
    let s = ''
    for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)]
    return s
  }

  it('500 次随机查询: 全部返回字符串数组,无空 token,不抛错', () => {
    for (let i = 0; i < 500; i++) {
      const q = randQuery()
      const tokens = tokenizeQuery(q)
      expect(Array.isArray(tokens)).toBe(true)
      for (const t of tokens) {
        expect(typeof t).toBe('string')
        expect(t.length).toBeGreaterThan(0)
      }
    }
  })
})

// =============================================================
// 3. sanitizeArgsForLog — 200 次随机 privacy 参数
// =============================================================
describe('stress: sanitizeArgsForLog 200 次随机 privacy 参数', () => {
  const SUBS = ['init', 'load', 'disable', 'enable', 'list', 'filter', 'unknown']

  it('200 次: 密码子命令必脱敏,非密码子命令不脱敏', () => {
    for (let i = 0; i < 200; i++) {
      const sub = SUBS[Math.floor(Math.random() * SUBS.length)]
      const pwd = `secret-${Math.random()}`
      const args = [sub, pwd, `extra-${i}`]
      const out = EAABridge.sanitizeArgsForLog('privacy', args)
      const PASSWORD_SUBS = new Set(['init', 'load', 'disable'])
      if (PASSWORD_SUBS.has(sub)) {
        expect(out[1]).toBe('***')
        expect(out.join(' ')).not.toContain(pwd)
      } else {
        expect(out).toEqual(args)
      }
    }
  })

  it('100 次: 非 privacy 命令原样返回', () => {
    for (let i = 0; i < 100; i++) {
      const args = [`arg${i}`, String(Math.random())]
      const out = EAABridge.sanitizeArgsForLog('add', args)
      expect(out).toEqual(args)
      expect(out).not.toBe(args) // 新数组
    }
  })
})

// =============================================================
// 4. parseCommand — 300 次随机斜杠命令
// =============================================================
describe('stress: parseCommand 300 次随机输入', () => {
  const WORDS = ['help', 'score', 'ranking', 'stats', '张三', 'list', 'echo', 'dashboard']

  function randCmd(): string {
    const hasSlash = Math.random() > 0.3
    const parts = [WORDS[Math.floor(Math.random() * WORDS.length)]]
    const argc = Math.floor(Math.random() * 3)
    for (let i = 0; i < argc; i++) {
      parts.push(WORDS[Math.floor(Math.random() * WORDS.length)])
    }
    return (hasSlash ? '/' : '') + parts.join(' ')
  }

  it('300 次: 不抛错,返回 null 或 {command,args,rawArgs}', () => {
    for (let i = 0; i < 300; i++) {
      const input = randCmd()
      const result = parseCommand(input)
      if (result === null) {
        // 非 / 开头 → null
      } else {
        expect(result).toHaveProperty('command')
        expect(result).toHaveProperty('args')
        expect(result).toHaveProperty('rawArgs')
        expect(Array.isArray(result.args)).toBe(true)
      }
    }
  })

  it('200 次 / 开头: command 应为小写', () => {
    for (let i = 0; i < 200; i++) {
      const result = parseCommand(`/HELP test${i}`)
      if (result) {
        expect(result.command).toBe(result.command.toLowerCase())
      }
    }
  })
})

// =============================================================
// 5. 跨模块: 同时调用多个纯函数不互相干扰
// =============================================================
describe('stress: 跨模块无状态干扰', () => {
  it('交替调用 compareSemver + tokenizeQuery + sanitize 100 轮', () => {
    for (let i = 0; i < 100; i++) {
      // compareSemver
      expect(compareSemver('1.0.0', '2.0.0')).toBe(-1)
      // tokenizeQuery
      expect(tokenizeQuery('a b c')).toEqual(['a', 'b', 'c'])
      // sanitize
      const out = EAABridge.sanitizeArgsForLog('privacy', ['init', `pwd${i}`])
      expect(out[1]).toBe('***')
    }
  })

  it('compareSemver 不受 tokenizeQuery 调用影响', () => {
    const before = compareSemver('1.0.0', '1.0.1')
    for (let i = 0; i < 50; i++) {
      tokenizeQuery(`test ${i} query`)
    }
    const after = compareSemver('1.0.0', '1.0.1')
    expect(before).toBe(after)
  })
})
