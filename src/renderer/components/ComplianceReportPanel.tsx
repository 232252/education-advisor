// =============================================================
// ComplianceReportPanel — 隐私合规报告 UI 面板(Pillar 6)
//
// 设计要点:
//   - 单页内嵌:不新开路由,直接挂在 SettingsPage 底部
//   - 三档操作: 列出季度 / 生成报告 / 保存到本地
//   - SHA-256 清单明文展示,让用户能看到"防篡改"凭证
//   - 失败时 inline 报错,不走 toast(避免噪声)
//   - 报表可折叠(超过 6 行折叠),不打扰用户
// =============================================================

import { useCallback, useEffect, useState } from 'react'
import { getAPI } from '../lib/ipc-client'

interface ReportSummary {
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

interface ReportPayload {
  schemaVersion: number
  reportId: string
  generatedAt: number
  period: { start: number; end: number; label: string }
  summary: ReportSummary
  byOp: Record<string, number>
  byRecipient: Record<string, number>
  byEntityType: Record<string, number>
  piiStats: { totalPIIHits: number; callsWithPII: number; byKind: Record<string, number> }
  manifest: {
    auditLogSha256: string
    reportSha256: string
    auditLogLineCount: number
    generatedAt: number
  }
}

interface ListPayload {
  success: boolean
  auditLogLineCount: number
  previousQuarter: { start: number; end: number; label: string }
  currentQuarter: { start: number; end: number; label: string }
}

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN')
}

function fmtTs(ms: number): string {
  const d = new Date(ms)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function shortHash(sha: string): string {
  return sha ? `${sha.slice(0, 8)}…${sha.slice(-8)}` : '(空)'
}

export function ComplianceReportPanel() {
  const [list, setList] = useState<ListPayload | null>(null)
  const [report, setReport] = useState<ReportPayload | null>(null)
  const [period, setPeriod] = useState<{ start: number; end: number; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedTo, setSavedTo] = useState<string | null>(null)

  // 初始:拉一次季度列表 + 行数
  const refreshList = useCallback(async () => {
    try {
      const r = await getAPI().compliance.list()
      if (r.success) {
        setList(r)
        setPeriod(r.previousQuarter)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refreshList()
  }, [refreshList])

  const handleGenerate = useCallback(async () => {
    if (!period) return
    setBusy(true)
    setError(null)
    setSavedTo(null)
    try {
      const r = await getAPI().compliance.generate(period.start, period.end, period.label)
      if (r.success && r.report) {
        setReport(r.report)
      } else {
        setError(r.error ?? '生成失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [period])

  const handleSave = useCallback(async () => {
    if (!report) return
    setBusy(true)
    setError(null)
    try {
      // 渲染端没有直接 saveDialog 调用 — 走 sys.saveDialog
      const dialog = (await getAPI().sys.saveDialog({
        title: '保存合规报告',
        defaultPath: `compliance-report-${report.period.label.replace(/\s+/g, '-')}-${report.reportId.slice(0, 8)}.json`,
        filters: [
          { name: 'JSON', extensions: ['json'] },
          { name: 'All', extensions: ['*'] },
        ],
      })) as { canceled: boolean; filePath?: string } | null
      if (!dialog || dialog.canceled || !dialog.filePath) {
        setBusy(false)
        return
      }
      const json = JSON.stringify(report, null, 2)
      const r = await getAPI().compliance.save(json, dialog.filePath)
      if (r.success) {
        setSavedTo(r.filePath ?? '')
      } else {
        setError(r.error ?? '保存失败')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [report])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">📋</span>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">隐私合规报告</h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-auto">
          Pillar 6 · SHA-256 防篡改清单
        </span>
      </div>

      <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
        基于隐私引擎的审计日志(append-only JSONL)汇总生成,带 SHA-256 清单,可作为学校 / 监管
        的合规凭据。
      </div>

      {/* 季度选择 + 操作 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="text-xs text-gray-600 dark:text-gray-300">时间窗:</div>
        {list ? (
          <>
            <button
              type="button"
              onClick={() => setPeriod(list.previousQuarter)}
              className={`px-2.5 py-1 text-[11px] rounded ${
                period?.label === list.previousQuarter.label
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}
            >
              上一季度 · {list.previousQuarter.label}
            </button>
            <button
              type="button"
              onClick={() => setPeriod(list.currentQuarter)}
              className={`px-2.5 py-1 text-[11px] rounded ${
                period?.label === list.currentQuarter.label
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
              }`}
            >
              本季度 · {list.currentQuarter.label}
            </button>
          </>
        ) : (
          <span className="text-[11px] text-gray-400">加载中…</span>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy || !period}
          className="ml-auto px-3 py-1 text-xs bg-blue-600 text-white rounded
            hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '生成中…' : '生成报告'}
        </button>
        {report && (
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="px-3 py-1 text-xs bg-emerald-600 text-white rounded
              hover:bg-emerald-700 disabled:opacity-50"
          >
            保存到本地
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-[11px] text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
      {savedTo && (
        <div className="mb-3 p-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded text-[11px] text-emerald-700 dark:text-emerald-300">
          ✅ 已保存: <code className="font-mono">{savedTo}</code>
        </div>
      )}

      {/* 汇总卡 */}
      {list && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
            <div className="text-[10px] text-gray-500 dark:text-gray-400">审计行数</div>
            <div className="text-base font-mono font-semibold text-gray-800 dark:text-gray-100">
              {fmtNum(list.auditLogLineCount)}
            </div>
          </div>
          {report && (
            <>
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
                <div className="text-[10px] text-gray-500 dark:text-gray-400">总调用</div>
                <div className="text-base font-mono font-semibold text-gray-800 dark:text-gray-100">
                  {fmtNum(report.summary.totalCalls)}
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
                <div className="text-[10px] text-gray-500 dark:text-gray-400">PII 命中</div>
                <div className="text-base font-mono font-semibold text-amber-600 dark:text-amber-400">
                  {fmtNum(report.piiStats.totalPIIHits)}
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
                <div className="text-[10px] text-gray-500 dark:text-gray-400">失败</div>
                <div className="text-base font-mono font-semibold text-red-600 dark:text-red-400">
                  {fmtNum(report.summary.failedCalls)}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 明细 */}
      {report && (
        <div className="space-y-2 text-[11px]">
          <details className="bg-gray-50 dark:bg-gray-900/50 rounded p-2" open>
            <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-200">
              操作分布(byOp)
            </summary>
            <table className="w-full mt-2 text-[11px]">
              <tbody>
                {Object.entries(report.byOp)
                  .sort((a, b) => b[1] - a[1])
                  .map(([op, count]) => (
                    <tr key={op} className="border-b border-gray-200 dark:border-gray-700">
                      <td className="py-1 font-mono">{op}</td>
                      <td className="py-1 text-right font-mono">{fmtNum(count)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
          {Object.keys(report.byRecipient).length > 0 && (
            <details className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
              <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-200">
                收件人分布(byRecipient)
              </summary>
              <table className="w-full mt-2 text-[11px]">
                <tbody>
                  {Object.entries(report.byRecipient)
                    .sort((a, b) => b[1] - a[1])
                    .map(([rcv, count]) => (
                      <tr key={rcv} className="border-b border-gray-200 dark:border-gray-700">
                        <td className="py-1 font-mono">{rcv}</td>
                        <td className="py-1 text-right font-mono">{fmtNum(count)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          )}
          <details className="bg-gray-50 dark:bg-gray-900/50 rounded p-2">
            <summary className="cursor-pointer font-medium text-gray-700 dark:text-gray-200">
              SHA-256 清单
            </summary>
            <div className="mt-2 space-y-1 font-mono text-[10px] text-gray-600 dark:text-gray-400 break-all">
              <div>
                <span className="text-gray-500">report: </span>
                {report.manifest.reportSha256}
              </div>
              <div>
                <span className="text-gray-500">audit: </span>
                {report.manifest.auditLogSha256 || '(无审计源)'}
              </div>
              <div className="text-gray-500">
                generated: {fmtTs(report.manifest.generatedAt)} · reportId:{' '}
                {report.reportId.slice(0, 8)}…
              </div>
            </div>
          </details>
        </div>
      )}

      {!report && !error && (
        <div className="text-center py-6 text-[11px] text-gray-400 dark:text-gray-500">
          选择时间窗后点击「生成报告」开始
        </div>
      )}

      <div className="mt-2 text-[10px] text-gray-400 dark:text-gray-500 font-mono text-right">
        {report ? shortHash(report.manifest.reportSha256) : '—'}
      </div>
    </div>
  )
}
