// =============================================================
// 对比汇总卡片 — 平均分变化 / 进步最多 / 退步最多 / 参与对比
// =============================================================

import { Card } from '../../../../components/Card'
import { DeltaBadge } from '../../../../components/DeltaBadge'
import { useT } from '../../../../i18n'
import type { ClassComparisonSummary } from '../../../../lib/academics'
import { cn, deltaColor } from '../../../../lib/ui-utils'

interface ComparisonSummaryCardsProps {
  summary: ClassComparisonSummary
}

export function ComparisonSummaryCards({ summary }: ComparisonSummaryCardsProps) {
  const { t } = useT()

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card padding="sm">
        <div className="text-xs text-gray-400 mb-1">
          {t('page.academics.compare.avgScoreChange', '班级平均分变化')}
        </div>
        <div className={cn('text-lg font-bold', deltaColor(summary.avgScoreDelta))}>
          {summary.avgScoreDelta > 0 ? '+' : ''}
          {summary.avgScoreDelta.toFixed(1)}
        </div>
      </Card>
      <Card padding="sm">
        <div className="text-xs text-gray-400 mb-1">
          {t('page.academics.compare.mostImproved', '进步最多')}
        </div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
          {summary.mostImprovedStudent ?? '-'}
        </div>
        {summary.mostImprovedDelta !== null && (
          <DeltaBadge
            delta={summary.mostImprovedDelta}
            suffix={t('page.academics.common.scoreUnit', '分')}
          />
        )}
      </Card>
      <Card padding="sm">
        <div className="text-xs text-gray-400 mb-1">
          {t('page.academics.compare.mostDeclined', '退步最多')}
        </div>
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
          {summary.mostDeclinedStudent ?? '-'}
        </div>
        {summary.mostDeclinedDelta !== null && (
          <DeltaBadge
            delta={summary.mostDeclinedDelta}
            suffix={t('page.academics.common.scoreUnit', '分')}
          />
        )}
      </Card>
      <Card padding="sm">
        <div className="text-xs text-gray-400 mb-1">
          {t('page.academics.compare.participants', '参与对比')}
        </div>
        <div className="text-lg font-bold text-gray-700 dark:text-gray-200">
          {summary.totalStudents}
        </div>
      </Card>
    </div>
  )
}
