// =============================================================
// EmptyState — 空状态占位组件
// 用于列表/页面为空时展示友好的提示信息。
// =============================================================

import { cn } from '../lib/ui-utils'

interface EmptyStateProps {
  /** 图标 (SVG 或 emoji) */
  icon?: string | React.ReactNode
  /** 标题 */
  title: string
  /** 描述 */
  description?: string
  /** 操作按钮 */
  action?: React.ReactNode
  /** 额外样式 */
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-8 text-center animate-fade-in',
        className,
      )}
    >
      {icon && (
        <div className="mb-4">
          {typeof icon === 'string' ? (
            <span className="text-5xl drop-shadow-sm">{icon}</span>
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-surface-elevated dark:to-surface-secondary ring-1 ring-blue-100/70 dark:ring-white/[0.06] flex items-center justify-center text-blue-400/80 dark:text-blue-400/60 shadow-sm">
              {icon}
            </div>
          )}
        </div>
      )}
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs mb-4 leading-relaxed">
          {description}
        </p>
      )}
      {action}
    </div>
  )
}
