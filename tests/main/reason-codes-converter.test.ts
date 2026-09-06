// =============================================================
// convertReasonCodes 单元测试 — config 扁平结构 → Rust 端包装结构
// 关键不变量: delta=null 的变量分值码(如 BONUS_VARIABLE)必须保留
// null,Rust 端 score_delta 为 Option<f64>,None 表示 add 命令跳过
// 标准分值校验(教师裁量)。此前转换器把 null 静默压成 0,导致变量
// 奖励码传任何非 0 分值都被 Rust 校验拒绝。
// =============================================================

import { describe, expect, it } from 'vitest'
import { convertReasonCodes } from '../../src/main/services/eaa/legacy-migration'

describe('convertReasonCodes', () => {
  it('扁平结构包装为 {version, codes},普通 delta 直通', () => {
    const out = JSON.parse(
      convertReasonCodes(JSON.stringify({ LATE: { label: '迟到', category: 'deduct', delta: -2 } })),
    )
    expect(out.version).toBe('1.0')
    expect(out.codes.LATE).toEqual({ label: '迟到', category: 'deduct', score_delta: -2 })
  })

  it('delta=null 保留为 null(变量分值码,不再压成 0)', () => {
    const out = JSON.parse(
      convertReasonCodes(
        JSON.stringify({
          BONUS_VARIABLE: { label: '学业奖励(变量)', category: 'bonus', delta: null },
          REVERT: { label: '撤销(自动计算)', category: 'system', delta: null },
        }),
      ),
    )
    expect(out.codes.BONUS_VARIABLE.score_delta).toBeNull()
    expect(out.codes.REVERT.score_delta).toBeNull()
  })

  it('缺 delta 字段回退 0(与原兜底一致)', () => {
    const out = JSON.parse(
      convertReasonCodes(JSON.stringify({ MYSTERY: { label: '无分值定义', category: 'deduct' } })),
    )
    expect(out.codes.MYSTERY.score_delta).toBe(0)
  })

  it('非对象条目被跳过;解析失败时原文透传', () => {
    const out = JSON.parse(
      convertReasonCodes(JSON.stringify({ GOOD: { label: 'ok', category: 'bonus', delta: 1 }, BAD: 'not-an-object' })),
    )
    expect(Object.keys(out.codes)).toEqual(['GOOD'])
    // 非 JSON 输入: 原样返回(由调用方降级逻辑处理)
    expect(convertReasonCodes('not json at all' as unknown as string)).toBe('not json at all')
  })
})
