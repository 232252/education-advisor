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
        <div className="mb-4 relative">
          {typeof icon === 'string' ? (
            <span className="text-5xl drop-shadow-sm">{icon}</span>
          ) : (
            <>
              {/* 外层柔光晕: 在图标容器之前绘制(z-0), 被 .mb-4 relative 包裹创建层叠上下文,
                  不会被祖先 Card/页面的不透明背景遮挡。容器半透明底叠加其上, 形成柔和光晕。 */}
              <span
                className="absolute inset-0 w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-400/25 to-indigo-400/15 blur-lg"
                aria-hidden="true"
              />
              {/* 空状态图标容器: 品牌蓝渐变底, relative + z-10 确保在柔光晕之上 */}
              <div className="relative z-10 w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/15 dark:to-indigo-500/15 ring-1 ring-blue-200/60 dark:ring-blue-400/20 flex items-center justify-center text-blue-500 dark:text-blue-400 shadow-sm shadow-blue-500/10">
                {icon}
              </div>
            </>
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
