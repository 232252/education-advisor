// =============================================================
// GradeRankingCard — 本场考试成绩排行 Top 10
// 点击跳转学生档案 AI 分析（entity_id + tab=ai）
// =============================================================

import { Trophy } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import type { StudentGradeRow } from '../dashboard-academic-stats'

function formatScore(row: StudentGradeRow): string {
  if (row.displayScore == null) return '—'
  const n = row.displayScore.toFixed(1)
  return row.kind === 'percent' ? `${n}%` : n
}

export function GradeRankingCard({
  items,
  onSelectStudent,
}: {
  items: StudentGradeRow[]
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
        {t('page.dashboard.academic.ranking')}
      </h3>
      <div className="space-y-2">
        {items.length === 0 ? (
          <EmptyState
            icon={<Trophy size={28} />}
            title={t('page.dashboard.academic.ranking.empty')}
            className="py-6"
          />
        ) : (
          items.map((r, idx) => {
            const rank = idx + 1
            return (
              <button
                type="button"
                key={r.entityId}
                onClick={() => onSelectStudent(r.entityId)}
                title={`${r.name} · ${formatScore(r)} · ${t('page.dashboard.academic.jumpAi')}`}
                className="w-full text-left flex items-center justify-between gap-2 text-xs p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors cursor-pointer bg-transparent border-0 min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className={`w-6 h-6 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold
                      ${
                        rank === 1
                          ? 'bg-yellow-400 text-white shadow-lg shadow-yellow-400/30'
                          : rank === 2
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-100 shadow-md'
                            : rank === 3
                              ? 'bg-amber-600 text-white shadow-md shadow-amber-600/20'
                              : 'bg-gray-100 dark:bg-surface-elevated text-gray-500 dark:text-gray-400'
                      }`}
                  >
                    {rank}
                  </span>
                  <span className="text-gray-700 dark:text-gray-200 font-medium truncate min-w-0">
                    {r.name}
                  </span>
                </div>
                <span className="font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/[0.06] px-2 py-0.5 rounded flex-shrink-0">
                  {formatScore(r)}
                </span>
              </button>
            )
          })
        )}
      </div>
    </Card>
  )
}
