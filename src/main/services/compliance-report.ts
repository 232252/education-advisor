// =============================================================
// Compliance Report — 隐私合规报告生成器
//
// 目的(Pillar 6):
//   - 季度/自定义时间窗的隐私操作统计
//   - SHA-256 清单(tamper-evidence): 报告 + 审计源一并签名
//   - JSON 输出,易机器读 / 易对接 PDF 生成
//   - 关键指标: 调用数 / 收件人分布 / PII 命中 / 失败率
//
// 设计:
//   - 纯函数式聚合:输入 entries,输出 report
//   - 不依赖 eaa-bridge,易单测
//   - 报告含 schemaVersion,后续可演进
// =============================================================

import crypto from 'node:crypto'
import { type PrivacyAuditEntry, readAudit, readAuditRaw } from './privacy-audit'

/** 报告 schema 版本(后续字段演进时递增) */
export const REPORT_SCHEMA_VERSION = 1

/** 报告元数据 */
export interface ComplianceReportMeta {
  schemaVersion: number
  reportId: string
  generatedAt: number
  period: { start: number; end: number; label: string }
}

/** 报告汇总 */
export interface ComplianceReportSummary {
  totalCalls: number
  successCalls: number
  failedCalls: number
  anonymizeCalls: number
  deanonymizeCalls: number
  filterCalls: number
  dryRunCalls: number
  configCalls: number
  avgDurationMs: number
}

/** 报告 SHA-256 清单 */
export interface ComplianceReportManifest {
  auditLogSha256: string
  reportSha256: string
  auditLogLineCount: number
  generatedAt: number
}

/** 完整报告 */
export interface ComplianceReport extends ComplianceReportMeta {
  summary: ComplianceReportSummary
  byOp: Record<string, number>
  byRecipient: Record<string, number>
  byEntityType: Record<string, number>
  piiStats: {
    totalPIIHits: number
    callsWithPII: number
    byKind: Record<string, number>
  }
  manifest: ComplianceReportManifest
}

/** 报告生成选项 */
export interface GenerateReportOptions {
  start: number
  end: number
  /** 用于报告的"人类可读"标签,例如 "Q3 2026" */
  label?: string
}

/**
 * 主入口:生成报告
 * - 读审计日志 → 过滤时间窗 → 聚合 → 签名
 * - 不抛错;空范围返回空报告
 */
export async function generateComplianceReport(
  opts: GenerateReportOptions,
): Promise<ComplianceReport> {
  const entries = await readAudit({ start: opts.start, end: opts.end })
  return buildReport(entries, opts)
}

/** 纯函数:从 entries 数组构建报告(便于单测) */
export async function buildReport(
  entries: PrivacyAuditEntry[],
  opts: GenerateReportOptions,
): Promise<ComplianceReport> {
  const summary: ComplianceReportSummary = {
    totalCalls: entries.length,
    successCalls: 0,
    failedCalls: 0,
    anonymizeCalls: 0,
    deanonymizeCalls: 0,
    filterCalls: 0,
    dryRunCalls: 0,
    configCalls: 0,
    avgDurationMs: 0,
  }
  const byOp: Record<string, number> = {}
  const byRecipient: Record<string, number> = {}
  const byEntityType: Record<string, number> = {}
  const piiByKind: Record<string, number> = {}
  let piiHitsTotal = 0
  let piiCallsCount = 0
  let totalDuration = 0

  for (const e of entries) {
    if (e.success) summary.successCalls++
    else summary.failedCalls++
    totalDuration += e.durationMs
    byOp[e.op] = (byOp[e.op] ?? 0) + 1
    if (e.op === 'anonymize') summary.anonymizeCalls++
    else if (e.op === 'deanonymize') summary.deanonymizeCalls++
    else if (e.op === 'filter') summary.filterCalls++
    else if (e.op === 'dry-run') summary.dryRunCalls++
    else summary.configCalls++

    if (e.receiver) byRecipient[e.receiver] = (byRecipient[e.receiver] ?? 0) + 1
    if (e.entityType) byEntityType[e.entityType] = (byEntityType[e.entityType] ?? 0) + 1

    if (e.hasPII) {
      piiCallsCount++
      piiHitsTotal += e.piiCount
      if (e.piiCount > 0) {
        // 简化:不分类,统一累加
        piiByKind['_total'] = (piiByKind['_total'] ?? 0) + e.piiCount
      }
    }
  }
  summary.avgDurationMs = entries.length > 0 ? Math.round(totalDuration / entries.length) : 0

  const reportId = crypto.randomUUID()
  const meta: ComplianceReportMeta = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportId,
    generatedAt: Date.now(),
    period: { start: opts.start, end: opts.end, label: opts.label ?? defaultLabel(opts) },
  }
  const report: Omit<ComplianceReport, 'manifest'> = {
    ...meta,
    summary,
    byOp,
    byRecipient,
    byEntityType,
    piiStats: {
      totalPIIHits: piiHitsTotal,
      callsWithPII: piiCallsCount,
      byKind: piiByKind,
    },
  }

  // 签名:先按无 manifest 序列化,算 reportSha256;再读 audit,算 auditLogSha256
  const reportNoManifest = canonicalize(report)
  const reportSha256 = crypto.createHash('sha256').update(reportNoManifest).digest('hex')
  // manifest 的 reportSha256 字段也参与 audit 哈希(让清单自身也受保护)
  const manifest: ComplianceReportManifest = {
    auditLogSha256: '', // 占位,下面填
    reportSha256,
    auditLogLineCount: entries.length,
    generatedAt: meta.generatedAt,
  }
  const finalReport: ComplianceReport = { ...report, manifest }
  // 用最终形态(含 manifest) 重新算 reportSha256 以闭环
  const finalCanonical = canonicalize(finalReport)
  finalReport.manifest.reportSha256 = crypto
    .createHash('sha256')
    .update(finalCanonical)
    .digest('hex')
  // 计算审计日志哈希
  return finalizeWithAuditHash(finalReport)
}

/** 用审计日志原始文本填 manifest.auditLogSha256 */
async function finalizeWithAuditHash(report: ComplianceReport): Promise<ComplianceReport> {
  const raw = await readAuditRaw()
  // 只哈希落在时间窗内的行(避免被新追加的行污染)
  const inWindow = raw
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false
      try {
        const e = JSON.parse(line) as PrivacyAuditEntry
        return e.ts >= report.period.start && e.ts <= report.period.end
      } catch {
        return false
      }
    })
    .join('\n')
  report.manifest.auditLogSha256 = crypto.createHash('sha256').update(inWindow).digest('hex')
  // 重算最终 reportSha256(因为 auditLogSha256 也算进 report)
  const finalCanonical = canonicalize(report)
  report.manifest.reportSha256 = crypto.createHash('sha256').update(finalCanonical).digest('hex')
  return report
}

/** 规范化序列化:键按字母序,确保不同环境产生的 hash 一致 */
function canonicalize(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {}
      for (const key of Object.keys(v as object).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key]
      }
      return sorted
    }
    return v
  })
}

/** 默认标签:基于时间范围生成"Q?  YYYY"或"YYYY-MM-DD ~ YYYY-MM-DD" */
function defaultLabel(opts: GenerateReportOptions): string {
  const startD = new Date(opts.start)
  const endD = new Date(opts.end)
  const startQ = Math.floor(startD.getUTCMonth() / 3) + 1
  if (
    startD.getUTCFullYear() === endD.getUTCFullYear() &&
    startQ === Math.floor(endD.getUTCMonth() / 3) + 1
  ) {
    return `Q${startQ} ${startD.getUTCFullYear()}`
  }
  return `${formatYmd(startD)} ~ ${formatYmd(endD)}`
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 季度范围工具(便于 UI 快速给"上一季度") */
export function quarterRange(
  year: number,
  quarter: 1 | 2 | 3 | 4,
): { start: number; end: number; label: string } {
  const startMonth = (quarter - 1) * 3
  const start = Date.UTC(year, startMonth, 1, 0, 0, 0, 0)
  const end = Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999) // 季度末 23:59:59.999
  return { start, end, label: `Q${quarter} ${year}` }
}

/** 当前季度(便于默认 UI 选"上一季度") */
export function previousQuarterRange(): { start: number; end: number; label: string } {
  const now = new Date()
  const month = now.getUTCMonth() // 0-11
  const year = now.getUTCFullYear()
  const currentQ = Math.floor(month / 3) + 1
  if (currentQ === 1) return quarterRange(year - 1, 4)
  return quarterRange(year, (currentQ - 1) as 1 | 2 | 3 | 4)
}
