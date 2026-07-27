// =============================================================
// update-service.ts — compareSemver 单元测试
// 覆盖主版本号 / pre-release / v前缀 / 边界场景
// =============================================================

import { describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

// mock electron: update-service → settings-service 构造时调用 app.getPath('userData')
vi.mock('electron', () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), 'update-svc-test'),
    isPackaged: false,
    getVersion: () => '0.0.0',
  },
}))

import { compareSemver } from '../../src/main/services/update-service'

describe('compareSemver — 主版本号比较', () => {
  it('相同版本返回 0', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('0.1.0', '0.1.0')).toBe(0)
    expect(compareSemver('10.20.30', '10.20.30')).toBe(0)
  })

  it('major 不同', () => {
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1)
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1)
    expect(compareSemver('10.0.0', '9.0.0')).toBe(1)
  })

  it('minor 不同', () => {
    expect(compareSemver('1.2.0', '1.1.0')).toBe(1)
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1)
  })

  it('patch 不同', () => {
    expect(compareSemver('1.0.1', '1.0.0')).toBe(1)
    expect(compareSemver('1.0.0', '1.0.5')).toBe(-1)
  })

  it('v 前缀被忽略', () => {
    expect(compareSemver('v1.0.0', '1.0.0')).toBe(0)
    expect(compareSemver('v2.0.0', 'v1.0.0')).toBe(1)
    expect(compareSemver('1.0.0', 'v1.0.0')).toBe(0)
  })

  it('缺少数位时补 0', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0)
    expect(compareSemver('1', '1.0.0')).toBe(0)
    expect(compareSemver('1.0.0.0', '1.0.0')).toBe(0) // 第4位被忽略(只比3位)
    expect(compareSemver('1.0.1', '1.0')).toBe(1)
  })
})

describe('compareSemver — pre-release 比较', () => {
  it('无 pre-release > 有 pre-release (1.0.0 > 1.0.0-beta)', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta')).toBe(1)
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBe(-1)
  })

  it('两个都没有 pre-release 相等', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
  })

  it('两个都有 pre-release, 数字段按数值比较', () => {
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1)
    expect(compareSemver('1.0.0-beta.1', '1.0.0-beta.2')).toBe(-1)
    expect(compareSemver('1.0.0-beta.10', '1.0.0-beta.2')).toBe(1) // 数值比较,10>2
    expect(compareSemver('1.0.0-rc.1', '1.0.0-rc.0')).toBe(1)
  })

  it('两个都有 pre-release, 非数字段按字符串比较 (alpha < beta)', () => {
    expect(compareSemver('1.0.0-beta', '1.0.0-alpha')).toBe(1)
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1)
  })

  it('数字段优先级低于非数字段 (semver: 数字 < 字母)', () => {
    // alpha vs 1: alpha 是非数字段, 1 是数字段 → alpha 优先级更高 → 1.0.0-1 < 1.0.0-alpha
    expect(compareSemver('1.0.0-alpha', '1.0.0-1')).toBe(1)
    expect(compareSemver('1.0.0-1', '1.0.0-alpha')).toBe(-1)
  })

  it('pre-release 段数不同时,较短者较小(逐段比完未决则短的小)', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0-beta')).toBe(1) // beta.1 > beta
    expect(compareSemver('1.0.0-beta', '1.0.0-beta.1')).toBe(-1)
  })

  it('pre-release alpha vs beta (典型排序)', () => {
    // 1.0.0-alpha.1 < 1.0.0-beta.1 < 1.0.0-rc.1 < 1.0.0
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-beta.1')).toBe(-1)
    expect(compareSemver('1.0.0-beta.1', '1.0.0-rc.1')).toBe(-1)
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBe(-1)
  })

  it('v 前缀 + pre-release 组合', () => {
    expect(compareSemver('v1.0.0-beta.1', '1.0.0-beta.1')).toBe(0)
    expect(compareSemver('v1.0.0', 'v1.0.0-beta.1')).toBe(1)
  })
})

describe('compareSemver — 边界 / 异常', () => {
  it('0.0.0 系列', () => {
    expect(compareSemver('0.0.1', '0.0.0')).toBe(1)
    expect(compareSemver('0.0.0', '0.0.1')).toBe(-1)
  })

  it('大版本号', () => {
    expect(compareSemver('100.200.300', '99.99.99')).toBe(1)
  })

  it('内部一致性: 对称性', () => {
    const pairs = [
      ['1.2.3', '1.2.4'],
      ['v0.1.0-alpha', '0.1.0'],
      ['2.0.0-rc.1', '2.0.0-beta.5'],
    ] as const
    for (const [a, b] of pairs) {
      const fwd = compareSemver(a, b)
      const rev = compareSemver(b, a)
      expect(fwd === -rev).toBe(true)
    }
  })

  it('传递性: a>b, b>c → a>c', () => {
    // 1.0.0 > 1.0.0-rc.1 > 1.0.0-beta.1
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-rc.1', '1.0.0-beta.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBeGreaterThan(0)
  })
})
