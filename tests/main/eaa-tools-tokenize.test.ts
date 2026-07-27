// =============================================================
// EAA Tools — tokenizeQuery 单元测试
// - 直接 import tokenizeQuery（已 export）做隔离单元测试
// - 覆盖：空格分隔 / 引号包裹 / 混合 / 空串 / 全空格
// - mock 掉 eaa-bridge 防止模块初始化时调用 electron.app.getPath
// - 纯函数测试，不依赖任何运行时
// =============================================================

import { describe, expect, it, vi } from 'vitest'

// hoisted mock：必须在 import eaa-tools 之前生效
const bridge = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: bridge,
}))

// 必须在 vi.mock 之后 import
const { tokenizeQuery } = await import('../../src/main/services/eaa-tools')

describe('tokenizeQuery', () => {
  // ----- 任务强制 5 个 case -----

  it('空格分隔 "张三 迟到" → ["张三", "迟到"]', () => {
    expect(tokenizeQuery('张三 迟到')).toEqual(['张三', '迟到'])
  })

  it('双引号包裹的复合词 \'"张三 迟到"\' → ["张三 迟到"]', () => {
    expect(tokenizeQuery('"张三 迟到"')).toEqual(['张三 迟到'])
  })

  it('混合 \'a "b c" d\' → ["a", "b c", "d"]', () => {
    expect(tokenizeQuery('a "b c" d')).toEqual(['a', 'b c', 'd'])
  })

  it('空字符串 "" → []', () => {
    expect(tokenizeQuery('')).toEqual([])
  })

  it('仅有空格 "   " → []', () => {
    expect(tokenizeQuery('   ')).toEqual([])
  })

  // ----- 额外覆盖：边界情况 -----

  it('单 token 无空格 "迟到" → ["迟到"]', () => {
    expect(tokenizeQuery('迟到')).toEqual(['迟到'])
  })

  it('连续多空格分隔 "a    b" 视作单空格分隔 → ["a", "b"]', () => {
    // 实现按 char 扫描，space 是分隔符，连续 space 多次触发 flush
    // 由于 flush 后 current === ''，所以不会产生空 token
    expect(tokenizeQuery('a    b')).toEqual(['a', 'b'])
  })

  it('首尾空格 "  abc  def  " → ["abc", "def"]（首尾空格被忽略）', () => {
    expect(tokenizeQuery('  abc  def  ')).toEqual(['abc', 'def'])
  })

  it('空引号对 \'"\' → []（只有引号无内容）', () => {
    expect(tokenizeQuery('"')).toEqual([])
  })

  it('多组引号 \'"a b" "c d"\' → ["a b", "c d"]', () => {
    expect(tokenizeQuery('"a b" "c d"')).toEqual(['a b', 'c d'])
  })

  it('英文 + 数字混合 "user123 42" → ["user123", "42"]', () => {
    expect(tokenizeQuery('user123 42')).toEqual(['user123', '42'])
  })

  it('混合空白 \\t\\n 应被视作分隔符(不产生空 token)', () => {
    // 修复后: 所有 ASCII 空白都作为分隔符
    // "a\\tb\\nc" → ["a", "b", "c"]
    expect(tokenizeQuery('a\tb\nc')).toEqual(['a', 'b', 'c'])
    // 纯空白 → []
    expect(tokenizeQuery('\t\n')).toEqual([])
  })
})
