// =============================================================
// LatestExamSummaryCard — 本场考试摘要（对齐 PeriodSummaryCard）
// 录入概况 + 科目均分 Top 列表
// =============================================================

import type { ExamDef } from '@shared/types'
import { BookOpen } from 'lucide-react'
import { Card } from '../../../components/Card'
import { EmptyState } from '../../../components/EmptyState'
import { useT } from '../../../i18n'
import type { AcademicStatsSummary, SubjectAvgItem } from '../dashboard-academic-stats'

export function LatestExamSummaryCard({
  exam,
  stats,
  subjectAvgs,
}: {
  exam: ExamDef | null
  stats: AcademicStatsSummary
  subjectAvgs: SubjectAvgItem[]
}) {
  const { t } = useT()
  return (
    <Card
      padding="md"
      className="shadow-card hover:shadow-card-hover transition-shadow duration-300"
    >
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-pink-500"></span>
        {t('page.dashboard.academic.summary')}
        {exam && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 font-normal ml-1 truncate">
            {exam.name}
            {exam.date ? ` · ${exam.date}` : ''}
          </span>
        )}
      </h3>
      {!exam ? (
        <EmptyState
          icon={<BookOpen size={28} />}
          title={t('page.dashboard.academic.summary.empty')}
          className="py-6"
        />
      ) : (
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-3 border border-green-200/50 dark:border-green-700/30">
              <div className="text-gray-400 dark:text-gray-500">
                {t('page.dashboard.academic.stat.recorded')}
              </div>
              <div className="text-green-600 dark:text-green-400 font-bold text-lg">
                {stats.recordedLabel}
              </div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-50 dark:from-red-900/20 dark:to-red-900/20 rounded-xl p-3 border border-red-200/50 dark:border-red-700/30">
              <div className="text-gray-400 dark:text-gray-500">
                {t('page.dashboard.academic.stat.low')}
              </div>
              <div className="text-red-600 dark:text-red-400 font-bold text-lg">
                {stats.lowCount}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            {subjectAvgs.length === 0 ? (
              <p className="text-gray-400 dark:text-gray-500 py-2">
                {t('page.dashboard.academic.noGrades')}
              </p>
            ) : (
              subjectAvgs.slice(0, 6).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-300 truncate">{s.name}</span>
                  <span className="font-mono text-gray-700 dark:text-gray-200">
                    {s.avg.toFixed(1)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
