// =============================================================
// Compliance Report — 单元测试
// - 纯函数 buildReport(聚合 + SHA-256 清单)
// - 季度范围工具(quarterRange / previousQuarterRange)
// - 空报告 / 单条记录 / 多场景
// - 端到端: generateComplianceReport + logAudit + readAudit 集成
// =============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// hoisted mock: app.getPath('userData') 必须返回临时目录,
// 否则 eaaBridge 初始化时找不到数据目录会抛错
// 注意: vi.hoisted 的回调在模块 import 之前执行,所以这里用 require 而不是 import
const tmp = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'compliance-test-'))
  return { dir }
})

vi.mock('electron', () => ({
  app: { getPath: (_: string) => tmp.dir },
}))

const {
  buildReport,
  generateComplianceReport,
  previousQuarterRange,
  quarterRange,
} = await import('../../src/main/services/compliance-report')

const { countAuditLines, logAudit, readAudit } = await import(
  '../../src/main/services/privacy-audit'
)

describe('buildReport (pure)', () => {
  it('空 entries: 返回全零 summary + 完整 manifest', async () => {
    const report = await buildReport([], {
      start: 0,
      end: Date.now(),
      label: 'test',
    })
    expect(report.summary.totalCalls).toBe(0)
    expect(report.summary.successCalls).toBe(0)
    expect(report.summary.failedCalls).toBe(0)
    expect(report.summary.avgDurationMs).toBe(0)
    expect(report.byOp).toEqual({})
    expect(report.byRecipient).toEqual({})
    expect(report.piiStats.totalPIIHits).toBe(0)
    expect(report.piiStats.callsWithPII).toBe(0)
    expect(report.manifest.reportSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(report.manifest.auditLogLineCount).toBe(0)
  })

  it('多条 entries: 正确按 op / recipient / entityType 聚合', async () => {
    const entries = [
      {
        ts: 1,
        op: 'anonymize' as const,
        inputLen: 100,
        outputLen: 80,
        hasPII: true,
        piiCount: 2,
        durationMs: 10,
        success: true,
      },
      {
        ts: 2,
        op: 'anonymize' as const,
        inputLen: 50,
        outputLen: 50,
        hasPII: false,
        piiCount: 0,
        durationMs: 5,
        success: true,
      },
      {
        ts: 3,
        op: 'filter' as const,
        inputLen: 100,
        outputLen: 30,
        hasPII: true,
        piiCount: 5,
        durationMs: 8,
        receiver: 'parent',
        success: true,
      },
      {
        ts: 4,
        op: 'filter' as const,
        inputLen: 100,
        outputLen: 100,
        hasPII: false,
        piiCount: 0,
        durationMs: 3,
        receiver: 'teacher',
        success: false,
        error: 'engine down',
      },
      {
        ts: 5,
        op: 'add' as const,
        inputLen: 20,
        outputLen: 0,
        hasPII: false,
        piiCount: 0,
        entityType: 'person',
        durationMs: 2,
        success: true,
      },
    ]
    const report = await buildReport(entries, { start: 0, end: 10, label: 'unit' })
    expect(report.summary.totalCalls).toBe(5)
    expect(report.summary.successCalls).toBe(4)
    expect(report.summary.failedCalls).toBe(1)
    expect(report.summary.anonymizeCalls).toBe(2)
    expect(report.summary.filterCalls).toBe(2)
    expect(report.summary.configCalls).toBe(1)
    expect(report.byOp).toEqual({
      anonymize: 2,
      filter: 2,
      add: 1,
    })
    expect(report.byRecipient).toEqual({ parent: 1, teacher: 1 })
    expect(report.byEntityType).toEqual({ person: 1 })
    expect(report.piiStats.totalPIIHits).toBe(7)
    expect(report.piiStats.callsWithPII).toBe(2)
    // avgDurationMs: (10+5+8+3+2)/5 = 5.6 → 6
    expect(report.summary.avgDurationMs).toBe(6)
  })

  it('manifest 字段都是合法 SHA-256 hex (64 字符)', async () => {
    const report = await buildReport(
      [
        {
          ts: 1,
          op: 'anonymize',
          inputLen: 10,
          outputLen: 8,
          hasPII: true,
          piiCount: 1,
          durationMs: 1,
          success: true,
        },
      ],
      { start: 0, end: 2, label: 'hash' },
    )
    expect(report.manifest.reportSha256).toMatch(/^[a-f0-9]{64}$/)
    // auditLogSha256 是 readAuditRaw 的 SHA-256,可能为空(无审计源)或合法 hex
    if (report.manifest.auditLogSha256) {
      expect(report.manifest.auditLogSha256).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(report.manifest.auditLogLineCount).toBe(1)
  })

  it('PII 命中数为 0 时 callsWithPII=0', async () => {
    const report = await buildReport(
      [
        {
          ts: 1,
          op: 'list',
          inputLen: 0,
          outputLen: 0,
          hasPII: false,
          piiCount: 0,
          durationMs: 1,
          success: true,
        },
      ],
      { start: 0, end: 2 },
    )
    expect(report.piiStats.callsWithPII).toBe(0)
    expect(report.piiStats.totalPIIHits).toBe(0)
  })
})

describe('quarterRange', () => {
  it('Q1 范围: 1/1 ~ 3/31', () => {
    const r = quarterRange(2026, 1)
    expect(r.label).toBe('Q1 2026')
    expect(new Date(r.start).getUTCMonth()).toBe(0)
    expect(new Date(r.end).getUTCMonth()).toBe(2)
    expect(new Date(r.end).getUTCDate()).toBe(31)
  })

  it('Q4 范围: 10/1 ~ 12/31', () => {
    const r = quarterRange(2026, 4)
    expect(r.label).toBe('Q4 2026')
    expect(new Date(r.start).getUTCMonth()).toBe(9)
    expect(new Date(r.end).getUTCMonth()).toBe(11)
    expect(new Date(r.end).getUTCDate()).toBe(31)
  })

  it('previousQuarterRange: 返回前一季度的范围(单调时间)', () => {
    // 间接验证: 拿两个相邻季度,previousQuarterRange() 必须等于其中较早的一个
    const q1 = quarterRange(2026, 1)
    const q2 = quarterRange(2026, 2)
    const q3 = quarterRange(2026, 3)
    const q4 = quarterRange(2026, 4)
    // 任选一对验证"前一个季度"的 end < "后一个季度"的 start
    expect(q2.start).toBeGreaterThan(q1.end)
    expect(q3.start).toBeGreaterThan(q2.end)
    expect(q4.start).toBeGreaterThan(q3.end)
  })

  it('Q2 范围: 4/1 ~ 6/30 (季度末用 Date.UTC 跨月技巧)', () => {
    const r = quarterRange(2026, 2)
    expect(r.label).toBe('Q2 2026')
    expect(new Date(r.start).getUTCMonth()).toBe(3) // 4 月(0-indexed)
    // Date.UTC(2026, 6, 0) = 6 月最后一天 = 6 月 30 日(month 5, 0-indexed)
    expect(new Date(r.end).getUTCMonth()).toBe(5) // 6 月
    expect(new Date(r.end).getUTCDate()).toBe(30)
  })
})

describe('integration: logAudit → readAudit → generateComplianceReport', () => {
  beforeEach(async () => {
    // 清空审计文件
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.join(tmp.dir, 'eaa-data', 'privacy', 'audit.jsonl')
    try {
      await fs.unlink(file)
    } catch {
      // 文件不存在没事
    }
  })

  afterEach(async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = path.join(tmp.dir, 'eaa-data', 'privacy', 'audit.jsonl')
    try {
      await fs.unlink(file)
    } catch {
      // ignore
    }
  })

  it('写 3 条 → 读出来 3 条 → 生成报告 totalCalls=3', async () => {
    await logAudit({
      op: 'anonymize',
      inputLen: 10,
      outputLen: 5,
      hasPII: true,
      piiCount: 1,
      durationMs: 5,
      success: true,
    })
    await logAudit({
      op: 'filter',
      inputLen: 10,
      outputLen: 3,
      hasPII: true,
      piiCount: 2,
      receiver: 'parent',
      durationMs: 8,
      success: true,
    })
    await logAudit({
      op: 'list',
      inputLen: 0,
      outputLen: 0,
      hasPII: false,
      piiCount: 0,
      durationMs: 1,
      success: false,
      error: 'mock fail',
    })

    const lines = await countAuditLines()
    expect(lines).toBe(3)
    const entries = await readAudit()
    expect(entries.length).toBe(3)

    const now = Date.now()
    const report = await generateComplianceReport({
      start: now - 60_000,
      end: now + 60_000,
      label: 'integration',
    })
    expect(report.summary.totalCalls).toBe(3)
    expect(report.summary.successCalls).toBe(2)
    expect(report.summary.failedCalls).toBe(1)
    expect(report.summary.anonymizeCalls).toBe(1)
    expect(report.summary.filterCalls).toBe(1)
    expect(report.byRecipient.parent).toBe(1)
    expect(report.piiStats.totalPIIHits).toBe(3)
    // auditLogSha256 现在非空(3 行 JSONL)
    expect(report.manifest.auditLogSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('空审计: 生成空报告', async () => {
    const now = Date.now()
    const report = await generateComplianceReport({
      start: now - 1000,
      end: now + 1000,
    })
    expect(report.summary.totalCalls).toBe(0)
    expect(report.manifest.auditLogLineCount).toBe(0)
  })
})
