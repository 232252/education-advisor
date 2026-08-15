// =============================================================
// FutureCard — 未来扩展位占位卡（不可点击，仅展示设计蓝图）
// 结构自 tabs/PluginsTab.tsx 逐字搬移
// =============================================================

import { Card } from '../../../components/Card'

export function FutureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Card className="flex flex-col p-4 gap-2 opacity-70 border-dashed">
      <div className="flex items-start gap-3">
        <span
          className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/10 to-indigo-500/10 dark:from-blue-500/15 dark:to-indigo-500/15 text-blue-500 dark:text-blue-400 ring-1 ring-blue-200/60 dark:ring-blue-400/20"
          aria-hidden
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-700 dark:text-gray-300 truncate">
            <span className="text-xs align-middle mr-1.5 px-1.5 py-0.5 rounded bg-gray-200 dark:bg-surface-elevated text-gray-500 dark:text-gray-400">
              SOON
            </span>
            {title}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
            {description}
          </p>
        </div>
      </div>
    </Card>
  )
}
