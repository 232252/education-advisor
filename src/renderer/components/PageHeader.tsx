// =============================================================
// PageHeader — 统一页面头部组件
// 解决 13 个页面头部字号/padding/布局不一致的问题。
// =============================================================

import type { ReactNode } from 'react'
import { cn } from '../lib/ui-utils'

interface PageHeaderProps {
  /** 主标题 */
  title: string
  /** 副标题 */
  subtitle?: string
  /** 右侧操作区 */
  actions?: ReactNode
  /** 标题字号 */
  size?: 'sm' | 'md' | 'lg'
  /** 是否粘性吸顶 */
  sticky?: boolean
  /** 额外样式 */
  className?: string
}

const titleSizeMap = {
  sm: 'text-base font-semibold',
  md: 'text-xl font-semibold',
  lg: 'text-2xl font-bold',
}

export function PageHeader({
  title,
  subtitle,
  actions,
  size = 'md',
  sticky = false,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-6 py-4 flex-shrink-0 border-b border-gray-200/80 dark:border-white/[0.06]',
        sticky &&
          'sticky top-0 z-10 bg-white/85 dark:bg-[#1a1e28]/85 backdrop-blur-md shadow-[0_1px_0_rgba(15,23,42,0.04)] dark:shadow-none',
        className,
      )}
    >
      <div className="min-w-0">
        <h1
          className={cn(
            'tracking-tight text-gray-900 dark:text-white truncate',
            titleSizeMap[size],
          )}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 truncate">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {actions}
        </div>
      )}
    </div>
  )
}
