// =============================================================
// GradeWatchlistCard — 待关注学生（不及格 / 缺考 / 未录入）
// 点击同样进入学生 AI 分析。
// =============================================================

import { AlertTriangle } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import type { GradeWatchStatus, StudentGradeRow } from '../dashboard-academic-stats'

function formatScore(row: StudentGradeRow): string {
  if (row.displayScore == null) return '—'
  const n = row.displayScore.toFixed(1)
  return row.kind === 'percent' ? `${n}%` : n
}

export function GradeWatchlistCard({
  items,
  onSelectStudent,
}: {
  items: StudentGradeRow[]
  onSelectStudent: (entityId: string) => void
}) {
  const { t } = useT()
  const statusLabel = (status: GradeWatchStatus): string => {
    if (status === 'fail') return t('page.dashboard.academic.watchlist.fail')
    if (status === 'absent') return t('page.dashboard.academic.watchlist.absent')
    return t('page.dashboard.academic.watchlist.missing')
  }

  return (
    <Card
      padding="md"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
        {t('page.dashboard.academic.watchlist')}
      </h3>
      <div className="space-y-2">
        {items.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle size={28} />}
            title={t('page.dashboard.academic.watchlist.empty')}
            className="py-6"
          />
        ) : (
          items.map((r) => (
            <button
              type="button"
              key={r.entityId}
              onClick={() => onSelectStudent(r.entityId)}
              title={`${r.name} · ${statusLabel(r.status)} · ${t('page.dashboard.academic.jumpAi')}`}
              className="w-full text-left flex items-center justify-between gap-2 text-xs p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors cursor-pointer bg-transparent border-0 min-w-0"
            >
              <span className="text-gray-700 dark:text-gray-200 font-medium truncate min-w-0">
                {r.name}
              </span>
              <span className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] text-red-600 dark:text-red-400">
                  {statusLabel(r.status)}
                </span>
                <span className="font-mono text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/[0.06] px-2 py-0.5 rounded">
                  {formatScore(r)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </Card>
  )
}
