// =============================================================
// FeishuNetworkDiagnostics — 飞书网络诊断(步骤结果 + 开始诊断按钮)
// 诊断状态与 handler 内聚,自 sections/FeishuSection.tsx 逐字搬移
// =============================================================

import { useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'

export function FeishuNetworkDiagnostics() {
  const { t } = useT()
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagnoseResult, setDiagnoseResult] = useState<{
    steps: Array<{
      name: string
      status: 'pass' | 'fail' | 'skip'
      latencyMs?: number
      detail: string
      suggestion?: string
    }>
    overall: 'pass' | 'fail'
  } | null>(null)

  const handleDiagnose = async () => {
    setDiagnosing(true)
    setDiagnoseResult(null)
    try {
      const result = await getAPI().feishu.diagnose()
      setDiagnoseResult(result)
    } catch {
      setDiagnoseResult({
        steps: [],
        overall: 'fail',
      })
    } finally {
      setDiagnosing(false)
    }
  }

  return (
    <div className="px-5 py-3 border-t border-gray-200 dark:border-white/[0.06]/60">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
          {t('page.settings.feishu.networkDiagnostics', '网络诊断')}
        </span>
        <button
          type="button"
          onClick={handleDiagnose}
          disabled={diagnosing}
          className="text-[10px] px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
        >
          {diagnosing
            ? t('page.settings.feishu.diagnosing', '诊断中...')
            : t('page.settings.feishu.startDiagnose', '开始诊断')}
        </button>
        {diagnoseResult && !diagnosing && (
          <span
            className={`text-[10px] font-medium ${
              diagnoseResult.overall === 'pass'
                ? 'text-emerald-500 dark:text-emerald-400'
                : 'text-rose-500 dark:text-rose-400'
            }`}
          >
            {diagnoseResult.overall === 'pass'
              ? `✓ ${t('page.settings.feishu.allPassed', '全部通过')}`
              : `✗ ${t('page.settings.feishu.hasIssues', '存在问题')}`}
          </span>
        )}
      </div>
      {diagnoseResult && diagnoseResult.steps.length > 0 && (
        <div className="space-y-1.5">
          {diagnoseResult.steps.map((step) => (
            <div
              key={`diagnose-${step.name}`}
              className="flex items-start gap-2 text-[11px] leading-relaxed"
            >
              <span
                className={`flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                  step.status === 'pass'
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : step.status === 'fail'
                      ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
                      : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
                }`}
              >
                {step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : '-'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-600 dark:text-gray-300">{step.name}</span>
                  {step.latencyMs !== undefined && (
                    <span className="text-gray-400 dark:text-gray-500">{step.latencyMs}ms</span>
                  )}
                </div>
                <div className="text-gray-500 dark:text-gray-400">{step.detail}</div>
                {step.suggestion && (
                  <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                    {t('page.settings.feishu.suggestion', '建议')}: {step.suggestion}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {diagnoseResult && diagnoseResult.steps.length === 0 && (
        <div className="text-[11px] text-rose-500 dark:text-rose-400">
          {t('page.settings.feishu.diagnoseFailed', '诊断失败,请检查应用日志')}
        </div>
      )}
    </div>
  )
}
