// =============================================================
// Card — 统一卡片容器组件
// 提供一致的卡片样式，支持交互态、padding 变体。
// =============================================================

import type { ReactNode } from 'react'
import { cn } from '../lib/ui-utils'

interface CardProps {
  children: ReactNode
  /** 是否可交互（添加 hover 效果） */
  interactive?: boolean
  /** padding 变体 */
  padding?: 'none' | 'sm' | 'md' | 'lg'
  /** 是否显示阴影 */
  shadow?: boolean
  /** 额外样式 */
  className?: string
  /** 点击事件 */
  onClick?: () => void
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-7',
}

export function Card({
  children,
  interactive = false,
  padding = 'md',
  shadow = false,
  className,
  onClick,
}: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-gray-200/70 dark:border-white/[0.06] bg-white dark:bg-surface-tertiary shadow-sm',
        paddingMap[padding],
        shadow && 'shadow-card',
        interactive &&
          'transition-all duration-200 hover:shadow-xl hover:-translate-y-1 hover:border-blue-300/60 dark:hover:border-blue-500/30 cursor-pointer',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

/** 卡片标题区（含分隔线） */
export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 tracking-tight truncate">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0 ml-3">{action}</div>}
    </div>
  )
}
