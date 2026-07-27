// =============================================================
// DashboardStatCard — 仪表盘统计卡片
// 渐变色 + 阴影 + hover 效果的概览卡片，用于展示学生数/事件数等
// 关键指标。从 DashboardPage 抽出，便于复用与单测。
// =============================================================

import type { LucideIcon } from 'lucide-react'
import { memo } from 'react'
import { Card } from '../../../components/Card'

// 渐变色配色方案
const GRADIENT_COLORS = {
  blue: {
    from: '#3b82f6',
    to: '#1d4ed8',
    bg: 'from-blue-500/10 to-blue-600/5',
    border: 'border-blue-500/20',
    text: 'text-blue-600 dark:text-blue-400',
    shadow: 'shadow-blue-500/10',
  },
  green: {
    from: '#22c55e',
    to: '#15803d',
    bg: 'from-green-500/10 to-green-600/5',
    border: 'border-green-500/20',
    text: 'text-green-600 dark:text-green-400',
    shadow: 'shadow-green-500/10',
  },
  yellow: {
    from: '#eab308',
    to: '#a16207',
    bg: 'from-yellow-500/10 to-yellow-600/5',
    border: 'border-yellow-500/20',
    text: 'text-yellow-600 dark:text-yellow-400',
    shadow: 'shadow-yellow-500/10',
  },
  purple: {
    from: '#a855f7',
    to: '#7e22ce',
    bg: 'from-purple-500/10 to-purple-600/5',
    border: 'border-purple-500/20',
    text: 'text-purple-600 dark:text-purple-400',
    shadow: 'shadow-purple-500/10',
  },
  red: {
    from: '#ef4444',
    to: '#b91c1c',
    bg: 'from-red-500/10 to-red-600/5',
    border: 'border-red-500/20',
    text: 'text-red-600 dark:text-red-400',
    shadow: 'shadow-red-500/10',
  },
}

export const DashboardStatCard = memo(function DashboardStatCard({
  title,
  value,
  color,
  icon: Icon,
}: {
  title: string
  value: string | number
  color: string
  icon: LucideIcon
}) {
  const c = GRADIENT_COLORS[color as keyof typeof GRADIENT_COLORS] ?? GRADIENT_COLORS.blue
  return (
    <Card
      padding="md"
      className={`relative overflow-hidden bg-gradient-to-br ${c.bg} ${c.border}
                  shadow-card hover:shadow-card-hover hover:-translate-y-0.5
                  transition-all duration-200 cursor-default group`}
    >
      {/* 装饰性渐变圆 */}
      <div
        className="absolute -top-6 -right-6 w-16 h-16 rounded-full opacity-[0.12] group-hover:opacity-[0.2] transition-opacity duration-300"
        style={{ background: `linear-gradient(135deg, ${c.from}, ${c.to})` }}
        aria-hidden="true"
      />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide">
            {title}
          </span>
          <Icon
            size={16}
            strokeWidth={1.8}
            className={`${c.text} opacity-70 group-hover:opacity-100 transition-opacity duration-200`}
            aria-label={title}
          />
        </div>
        <div className={`text-2xl font-bold tracking-tight ${c.text}`}>{value}</div>
        <div
          className="mt-2 h-[3px] rounded-full w-0 group-hover:w-full transition-all duration-500 ease-out"
          style={{ background: `linear-gradient(90deg, ${c.from}, ${c.to})` }}
          aria-hidden="true"
        />
      </div>
    </Card>
  )
})
