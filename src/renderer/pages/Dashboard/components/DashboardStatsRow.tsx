// =============================================================
// DashboardStatsRow — 概览统计卡行
// 5 张统计卡片（学生数/事件数/撤销/分数变化/高风险），
// 按班级筛选时显示班级口径数据。
// =============================================================

import { AlertTriangle, BarChart3, CheckCircle2, Undo2, Users } from 'lucide-react'
import { useT } from '../../../i18n'
import { DashboardStatCard } from './DashboardStatCard'

export function DashboardStatsRow({
  isAllClasses,
  studentCount,
  eventCount,
  revokedCount,
  scoreChange,
  highRiskCount,
}: {
  /** 是否为「全部班级」口径（影响学生卡片标题与分数变化取值口径） */
  isAllClasses: boolean
  studentCount: number
  eventCount: number
  revokedCount: number
  /** 已格式化好的分数变化展示值 */
  scoreChange: string
  highRiskCount: number
}) {
  const { t } = useT()
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <DashboardStatCard
        title={isAllClasses ? t('page.dashboard.stat.students') : '班级学生'}
        value={studentCount}
        color="blue"
        icon={Users}
        className="animate-slide-up stagger-1"
      />
      <DashboardStatCard
        title={t('page.dashboard.stat.events')}
        value={eventCount}
        color="green"
        icon={CheckCircle2}
        className="animate-slide-up stagger-2"
      />
      <DashboardStatCard
        title={t('page.dashboard.stat.revoked')}
        value={revokedCount}
        color="yellow"
        icon={Undo2}
        className="animate-slide-up stagger-3"
      />
      <DashboardStatCard
        title={t('page.dashboard.stat.scoreChange')}
        value={scoreChange}
        color="purple"
        icon={BarChart3}
        className="animate-slide-up stagger-4"
      />
      <DashboardStatCard
        title={t('page.dashboard.stat.highRisk')}
        value={highRiskCount}
        color="red"
        icon={AlertTriangle}
        className="animate-slide-up stagger-5"
      />
    </div>
  )
}
