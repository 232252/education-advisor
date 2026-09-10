// =============================================================
// AcademicStatsRow — 成绩优先概览统计卡行
// 5 张统计卡片（考试场次/已录入/班级均分/缺考未录/待关注），
// 视觉与 DashboardStatsRow 同一套 DashboardStatCard。
// =============================================================

import { AlertTriangle, BookOpen, ClipboardList, TrendingDown, Users } from 'lucide-react'
import { useT } from '../../../i18n'
import type { AcademicStatsSummary } from '../dashboard-academic-stats'
import { DashboardStatCard } from './DashboardStatCard'

export function AcademicStatsRow({
  stats,
  avgLabel,
}: {
  stats: AcademicStatsSummary
  /** 已格式化的均分展示（百分制或单科原始分由调用方决定） */
  avgLabel: string
}) {
  const { t } = useT()
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <DashboardStatCard
        title={t('page.dashboard.academic.stat.exams')}
        value={stats.examCount}
        color="blue"
        icon={BookOpen}
        className="animate-slide-up stagger-1"
      />
      <DashboardStatCard
        title={t('page.dashboard.academic.stat.recorded')}
        value={stats.recordedLabel}
        color="green"
        icon={Users}
        className="animate-slide-up stagger-2"
      />
      <DashboardStatCard
        title={t('page.dashboard.academic.stat.avg')}
        value={avgLabel}
        color="purple"
        icon={ClipboardList}
        className="animate-slide-up stagger-3"
      />
      <DashboardStatCard
        title={t('page.dashboard.academic.stat.absent')}
        value={stats.absentCount}
        color="yellow"
        icon={TrendingDown}
        className="animate-slide-up stagger-4"
      />
      <DashboardStatCard
        title={t('page.dashboard.academic.stat.low')}
        value={stats.lowCount}
        color="red"
        icon={AlertTriangle}
        className="animate-slide-up stagger-5"
      />
    </div>
  )
}
