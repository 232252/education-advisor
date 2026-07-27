// =============================================================
// Badge — 统一标签/徽章组件
// 支持语义变体、圆点指示器、风险等级专用。
// =============================================================

import type { EAARiskLevel } from '@shared/types'
import { cn, riskBgColor } from '../lib/ui-utils'

interface BadgeProps {
  children: React.ReactNode
  /** 语义变体 */
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'neutral'
  /** 额外样式 */
  className?: string
}

const variantMap = {
  info: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  success: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  warning: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  danger: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  neutral: 'bg-gray-100 dark:bg-[#1e222c] text-gray-600 dark:text-gray-400',
}

export function Badge({ children, variant = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full',
        variantMap[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** 风险等级专用 Badge */
export function RiskBadge({
  risk,
  className,
}: {
  risk: EAARiskLevel | string
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full',
        riskBgColor(risk),
        className,
      )}
    >
      {risk}
    </span>
  )
}

/** 状态圆点 + 文字 */
export function StatusDot({
  status,
  label,
  pulse = false,
  className,
}: {
  status: 'green' | 'red' | 'blue' | 'yellow' | 'gray'
  label?: string
  pulse?: boolean
  className?: string
}) {
  const dotColors = {
    green: 'bg-green-400',
    red: 'bg-red-400',
    blue: 'bg-blue-400',
    yellow: 'bg-yellow-400',
    gray: 'bg-gray-400 dark:bg-gray-500',
  }

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <span className={cn('w-2 h-2 rounded-full', dotColors[status], pulse && 'animate-pulse')} />
      {label && <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>}
    </span>
  )
}
