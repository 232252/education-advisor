// =============================================================
// 上下文状态条 — 显示模型 contextWindow / 已用 token / 压缩阈值进度
// 修复 Bug-1: 真正显示用户设置的 contextWindow (从 ai.listModels 拉的),
//              不在 UI 硬编码 900K
// =============================================================

import { useT } from '../../../i18n'
import { fmtK } from '../lib/format'

interface ContextStatusBarProps {
  modelContext: number
  modelMaxOutput: number
  lastUsage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
  } | null
  lastCost: number
}

/** 上下文状态条：token 用量 + 压缩阈值进度 */
export function ContextStatusBar({
  modelContext,
  modelMaxOutput,
  lastUsage,
  lastCost,
}: ContextStatusBarProps) {
  const { t } = useT()
  // 压缩阈值(默认 90% = reserve 10%) — 跟主进程 compaction-helper 自适应策略一致
  const reserve = modelContext > 0 ? Math.max(4096, Math.floor(modelContext * 0.1)) : 0
  const threshold = modelContext - reserve
  const used = lastUsage
    ? (lastUsage.inputTokens ?? 0) +
      (lastUsage.outputTokens ?? 0) +
      (lastUsage.cacheReadTokens ?? 0)
    : 0
  const pct = modelContext > 0 ? Math.min(100, (used / modelContext) * 100) : 0
  const thresholdPct = modelContext > 0 ? (threshold / modelContext) * 100 : 90
  // 颜色: <60% 绿, 60-90% 黄, >90% 红(即将压缩)
  const barColor = pct < 60 ? 'bg-green-500' : pct < thresholdPct ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="px-6 py-2 border-b border-gray-200/60 dark:border-white/[0.06] bg-gray-50/50 dark:bg-surface-tertiary/50">
      <div className="flex items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {t('page.chat.context.label', '上下文')}
          </span>
          <span className="font-mono">
            {modelContext > 0 ? `${fmtK(modelContext)}` : t('common.unset', '未设置')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>{t('page.chat.context.maxOutput', '输出上限')}</span>
          <span className="font-mono">{modelMaxOutput > 0 ? fmtK(modelMaxOutput) : '4K'}</span>
        </div>
        {lastUsage && (
          <>
            <div className="flex items-center gap-1.5">
              <span>{t('page.chat.context.used', '已用')}</span>
              <span className="font-mono">
                {fmtK(used)} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>{t('page.chat.context.input', '输入')}</span>
              <span className="font-mono">{fmtK(lastUsage.inputTokens ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>{t('page.chat.context.output', '输出')}</span>
              <span className="font-mono">{fmtK(lastUsage.outputTokens ?? 0)}</span>
            </div>
            {lastCost > 0 && (
              <div className="flex items-center gap-1.5">
                <span>{t('page.chat.context.cost', '费用')}</span>
                <span className="font-mono">${lastCost.toFixed(4)}</span>
              </div>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1.5 text-[10px]">
          {pct >= thresholdPct ? (
            <span className="text-red-500 font-medium">
              {t('page.chat.context.compacting', '⚠ 即将压缩')}
            </span>
          ) : pct >= 60 ? (
            <span className="text-yellow-600 dark:text-yellow-400">
              {t('page.chat.context.nearThreshold', '接近阈值')}
            </span>
          ) : (
            <span className="text-green-600 dark:text-green-400">
              {t('page.chat.context.sufficient', '充裕')}
            </span>
          )}
        </div>
      </div>
      {/* 进度条 — 显示 contextWindow 使用率 + 压缩阈值线 */}
      <div className="relative mt-1.5 h-1.5 bg-gray-200 dark:bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
        {modelContext > 0 && (
          <div
            className="absolute inset-y-0 w-px bg-gray-700 dark:bg-gray-300"
            style={{ left: `${thresholdPct}%` }}
            title={`${t('page.chat.context.threshold', '压缩阈值')} (${fmtK(threshold)} tokens)`}
          />
        )}
      </div>
    </div>
  )
}
