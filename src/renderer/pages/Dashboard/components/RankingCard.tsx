// =============================================================
// RankingCard — 学生排行榜卡片（Top 10）
// 点击条目跳转学生详情（entity_id 定位）
// =============================================================

import type { EAARankItem } from '@shared/types'
import { Trophy } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'

export function RankingCard({
  items,
  onSelectStudent,
}: {
  items: EAARankItem[]
  onSelectStudent: (entityId: string) => void
}) {
  const { t } = useT()
  return (
    <Card
      padding="md"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span>
        {t('page.dashboard.chart.top10')}
      </h3>
      <div className="space-y-2">
        {items.length === 0 ? (
          <EmptyState icon={<Trophy size={28} />} title="暂无排行数据" className="py-6" />
        ) : (
          items.slice(0, 10).map((r) => (
            <button
              type="button"
              key={r.entity_id}
              onClick={() => onSelectStudent(r.entity_id)}
              title={`${r.name} · ${(typeof r.score === 'number' ? r.score : 0).toFixed(1)}`}
              className="w-full text-left flex items-center justify-between gap-2 text-xs p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer bg-transparent border-0 min-w-0"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold
                    ${
                      r.rank === 1
                        ? 'bg-yellow-400 text-white shadow-lg shadow-yellow-400/30'
                        : r.rank === 2
                          ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-100 shadow-md'
                          : r.rank === 3
                            ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                            : 'bg-gray-100 dark:bg-surface-elevated text-gray-500 dark:text-gray-400'
                    }`}
                >
                  {r.rank}
                </span>
                <span className="text-gray-700 dark:text-gray-200 font-medium truncate min-w-0">
                  {r.name}
                </span>
              </div>
              <span className="font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/[0.06] px-2 py-0.5 rounded flex-shrink-0">
                {(typeof r.score === 'number' ? r.score : 0).toFixed(1)}
              </span>
            </button>
          ))
        )}
      </div>
    </Card>
  )
}
