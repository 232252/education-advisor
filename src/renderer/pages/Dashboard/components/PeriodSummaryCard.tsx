// =============================================================
// PeriodSummaryCard — 周期摘要卡片
// 加分/扣分双栏摘要 + 进步/退步最快 Top 3
// =============================================================

import { AlertTriangle, Calendar, Trophy } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import type { PeriodSummary } from '../dashboard-stats'

export function PeriodSummaryCard({
  data,
  period,
}: {
  data: PeriodSummary | undefined
  /** 全局周期范围（since ~ until），来自 summary 接口 */
  period?: { since: string | null; until: string | null } | null
}) {
  const { t } = useT()
  return (
    <Card
      padding="md"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-pink-500"></span>
        周期摘要
        {period?.since && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal ml-1">
            {period.since} ~ {period.until ?? '至今'}
          </span>
        )}
      </h3>
      {data ? (
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-3 border border-green-200/50 dark:border-green-700/30">
              <div className="text-gray-400 dark:text-gray-500">
                {t('page.dashboard.summary.up')}
              </div>
              <div className="text-green-600 dark:text-green-400 font-bold text-lg">
                {data.events.bonus_count}
              </div>
              <div className="text-green-500/70 dark:text-green-400/70">
                +{data.events.bonus_total.toFixed(1)}
              </div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 rounded-xl p-3 border border-red-200/50 dark:border-red-700/30">
              <div className="text-gray-400 dark:text-gray-500">
                {t('page.dashboard.summary.down')}
              </div>
              <div className="text-red-600 dark:text-red-400 font-bold text-lg">
                {data.events.deduct_count}
              </div>
              <div className="text-red-500/70 dark:text-red-400/70">
                {data.events.deduct_total.toFixed(1)}
              </div>
            </div>
          </div>
          {data.top_gainers.length > 0 && (
            <div>
              <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium flex items-center gap-1.5">
                <Trophy size={16} className="text-yellow-500" /> 进步最快
              </div>
              {data.top_gainers.slice(0, 3).map((g) => (
                <div
                  key={g.name}
                  className="flex justify-between gap-2 py-1 border-b border-gray-100 dark:border-white/[0.04] last:border-0 min-w-0"
                >
                  <span className="text-gray-600 dark:text-gray-300 truncate min-w-0 flex-1">
                    {g.name}
                  </span>
                  <span className="text-green-500 dark:text-green-400 font-mono font-medium flex-shrink-0">
                    +{g.delta.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {data.top_losers.length > 0 && (
            <div>
              <div className="text-gray-500 dark:text-gray-400 mb-2 font-medium flex items-center gap-1.5">
                <AlertTriangle size={16} className="text-red-400" /> 退步最快
              </div>
              {data.top_losers.slice(0, 3).map((l) => (
                <div
                  key={l.name}
                  className="flex justify-between gap-2 py-1 border-b border-gray-100 dark:border-white/[0.04] last:border-0 min-w-0"
                >
                  <span className="text-gray-600 dark:text-gray-300 truncate min-w-0 flex-1">
                    {l.name}
                  </span>
                  <span className="text-red-500 dark:text-red-400 font-mono font-medium flex-shrink-0">
                    {l.delta.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState icon={<Calendar size={28} />} title="暂无数据" className="py-6" />
      )}
    </Card>
  )
}
