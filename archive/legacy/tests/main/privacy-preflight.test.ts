// =============================================================
// Privacy Preflight — 单元测试
// - preflightCheck: 引擎未加载/空文本/无 PII/PII 命中 各种情况
// - applyDecision: cancel/redacted/original/block/warn 五种决策路径
// - 引擎不可用时"保守放行"语义
// =============================================================

import { describe, expect, it, vi } from 'vitest'

// hoisted mock — 必须在 import privacy-preflight 之前生效
const bridge = vi.hoisted(() => ({
  execute: vi.fn(),
}))

vi.mock('../../src/main/services/eaa-bridge', () => ({
  eaaBridge: bridge,
}))

const { applyDecision, preflightCheck } = await import(
  '../../src/main/services/privacy-preflight'
)

describe('preflightCheck', () => {
  it('空文本: 返回 hasPII=false + 原文', async () => {
    bridge.execute.mockReset()
    const r = await preflightCheck('')
    expect(r.hasPII).toBe(false)
    expect(r.entities).toEqual([])
    expect(r.redacted).toBe('')
    expect(r.original).toBe('')
    expect(r.originalLength).toBe(0)
    expect(r.privacyEnabled).toBe(false)
    // 空文本短路,不调 eaaBridge
    expect(bridge.execute).not.toHaveBeenCalled()
  })

  it('引擎可用 + 无 PII: 返回 hasPII=false + 原文不变', async () => {
    bridge.execute.mockReset()
    bridge.execute.mockResolvedValue({
      success: true,
      data: { output: '今天天气很好,适合爬山' },
    })
    const r = await preflightCheck('今天天气很好,适合爬山')
    expect(r.hasPII).toBe(false)
    expect(r.entities).toEqual([])
    expect(r.privacyEnabled).toBe(true)
    expect(r.error).toBeUndefined()
  })

  it('引擎可用 + 有 PII(姓名+电话): 返回命中类别 + 脱敏文本', async () => {
    bridge.execute.mockReset()
    bridge.execute.mockResolvedValue({
      success: true,
      data: { output: '学生 S_001 的联系电话是 PH_001' },
    })
    const r = await preflightCheck('学生张明的联系电话是 13800138000')
    expect(r.hasPII).toBe(true)
    expect(r.privacyEnabled).toBe(true)
    const kinds = r.entities.map((e) => e.kind).sort()
    expect(kinds).toContain('person')
    expect(kinds).toContain('phone')
    // redacted 包含化名标记
    expect(r.redacted).toContain('S_001')
    expect(r.redacted).toContain('PH_001')
  })

  it('引擎返回字符串 data: 也兼容', async () => {
    bridge.execute.mockReset()
    bridge.execute.mockResolvedValue({
      success: true,
      data: '学生 S_001 在地址 ADDR_001 上学',
    })
    const r = await preflightCheck('学生张三在地址北京市朝阳区上学')
    expect(r.hasPII).toBe(true)
    const kinds = r.entities.map((e) => e.kind).sort()
    expect(kinds).toContain('person')
    expect(kinds).toContain('place')
  })

  it('引擎不可用(throw): 保守放行 + 标记 error', async () => {
    bridge.execute.mockReset()
    bridge.execute.mockRejectedValue(new Error('privacy engine not initialized'))
    const r = await preflightCheck('学生张明的联系电话是 13800138000')
    expect(r.hasPII).toBe(false)
    expect(r.privacyEnabled).toBe(false)
    expect(r.error).toContain('privacy engine not initialized')
    // redacted 退化为原文(调用方决定策略)
    expect(r.redacted).toContain('张明')
  })

  it('引擎返回 success=false: 同样保守放行 + error 字段', async () => {
    bridge.execute.mockReset()
    bridge.execute.mockResolvedValue({ success: false, error: 'engine busy' })
    const r = await preflightCheck('some text')
    expect(r.hasPII).toBe(false)
    expect(r.privacyEnabled).toBe(false)
    expect(r.error).toBe('engine busy')
  })

  it('邮箱 PII: 命中 email 类别', async () => {
    bridge.execute.mockReset()
    // input 与 redacted output 必须不同,才能进入 detectPIITypes 分支
    bridge.execute.mockResolvedValue({
      success: true,
      data: '学生的邮箱是 zhang@school.edu',
    })
    const r = await preflightCheck('学生张明的邮箱是 zhang@school.edu')
    expect(r.hasPII).toBe(true)
    const kinds = r.entities.map((e) => e.kind)
    expect(kinds).toContain('email')
  })
})

describe('applyDecision', () => {
  const baseReport = {
    hasPII: false,
    entities: [],
    redacted: 'plain text',
    original: 'plain text',
    originalLength: 10,
    privacyEnabled: true,
  }

  it('无 PII: 任何决策都直接放行', () => {
    const r = applyDecision(baseReport, 'original', { policy: 'block', context: 'test' })
    expect(r.allowed).toBe(true)
    expect(r.text).toBe('plain text')
  })

  it('PII 命中 + decision=cancel: 拦截 + 错误信息含 context', () => {
    const report = {
      ...baseReport,
      hasPII: true,
      entities: [{ kind: 'person' as const, count: 1 }],
      redacted: 'S_001',
    }
    const r = applyDecision(report, 'cancel', { policy: 'block', context: 'feishu send' })
    expect(r.allowed).toBe(false)
    expect(r.text).toBe('')
    expect(r.error).toContain('feishu send')
  })

  it('PII 命中 + decision=redacted: 放行脱敏文本', () => {
    const report = {
      ...baseReport,
      hasPII: true,
      entities: [{ kind: 'person' as const, count: 1 }],
      redacted: '学生 S_001',
    }
    const r = applyDecision(report, 'redacted', { policy: 'block', context: 'feishu send' })
    expect(r.allowed).toBe(true)
    expect(r.text).toBe('学生 S_001')
  })

  it('PII 命中 + decision=original + policy=block: 硬拦截 + error 含类别', () => {
    const report = {
      ...baseReport,
      hasPII: true,
      entities: [
        { kind: 'person' as const, count: 1 },
        { kind: 'phone' as const, count: 1 },
      ],
      redacted: 'S_001 PH_001',
      original: '张三 13800138000',
    }
    const r = applyDecision(report, 'original', { policy: 'block', context: 'feishu send' })
    expect(r.allowed).toBe(false)
    expect(r.error).toContain('feishu send')
    expect(r.error).toContain('person')
    expect(r.error).toContain('phone')
  })

  it('PII 命中 + decision=original + policy=warn: 放行**原文**(不是脱敏文本)', () => {
    const report = {
      ...baseReport,
      hasPII: true,
      entities: [{ kind: 'person' as const, count: 1 }],
      redacted: 'S_001',
      original: '张三',
    }
    const r = applyDecision(report, 'original', { policy: 'warn', context: 'agent tool' })
    expect(r.allowed).toBe(true)
    // 关键:warn + original 走的是原文,不是脱敏文本
    expect(r.text).toBe('张三')
  })
})
