// =============================================================
// 学生对比表 — 总分 A/B、总分变化、进步/退步科目数、操行分变化
// =============================================================

import { Card } from '../../../../components/Card'
import { DeltaBadge } from '../../../../components/DeltaBadge'
import { useT } from '../../../../i18n'
import type { StudentComparison } from '../../../../lib/academics'
import { cn, TABLE_ROW, TABLE_STICKY_HEAD, TABLE_TD, TABLE_TH } from '../../../../lib/ui-utils'

interface StudentComparisonTableProps {
  studentComparisons: StudentComparison[]
}

export function StudentComparisonTable({ studentComparisons }: StudentComparisonTableProps) {
  const { t } = useT()

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={cn(TABLE_STICKY_HEAD)}>
            <tr>
              <th className={TABLE_TH}>{t('page.academics.common.student', '学生')}</th>
              <th className={cn(TABLE_TH, 'text-center')}>
                {t('page.academics.compare.totalA', '总分 A')}
              </th>
              <th className={cn(TABLE_TH, 'text-center')}>
                {t('page.academics.compare.totalB', '总分 B')}
              </th>
              <th className={cn(TABLE_TH, 'text-center')}>
                {t('page.academics.compare.totalChange', '总分变化')}
              </th>
              <th className={cn(TABLE_TH, 'text-center')}>
                {t('page.academics.compare.improvedDeclined', '进步/退步')}
              </th>
              <th className={cn(TABLE_TH, 'text-center')}>
                {t('page.academics.compare.conductChange', '操行分变化')}
              </th>
            </tr>
          </thead>
          <tbody>
            {studentComparisons.map((sc) => (
              <tr key={sc.studentName} className={TABLE_ROW}>
                <td className={cn(TABLE_TD, 'text-gray-700 dark:text-gray-300')}>
                  {sc.studentName}
                </td>
                <td
                  className={cn(TABLE_TD, 'text-center font-mono text-gray-600 dark:text-gray-300')}
                >
                  {sc.totalScoreA ?? '-'}
                </td>
                <td
                  className={cn(TABLE_TD, 'text-center font-mono text-gray-600 dark:text-gray-300')}
                >
                  {sc.totalScoreB ?? '-'}
                </td>
                <td className={cn(TABLE_TD, 'text-center')}>
                  <DeltaBadge
                    delta={sc.totalScoreDelta}
                    suffix={t('page.academics.common.scoreUnit', '分')}
                  />
                </td>
                <td className={cn(TABLE_TD, 'text-center text-xs')}>
                  <span className="text-green-600 dark:text-green-400">{sc.improvedSubjects}</span>
                  <span className="text-gray-300 mx-1">/</span>
                  <span className="text-red-600 dark:text-red-400">{sc.declinedSubjects}</span>
                </td>
                <td className={cn(TABLE_TD, 'text-center')}>
                  {sc.conductDelta !== null ? (
                    <DeltaBadge
                      delta={sc.conductDelta}
                      suffix={t('page.academics.common.scoreUnit', '分')}
                    />
                  ) : (
                    <span className="text-gray-400 text-xs">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
