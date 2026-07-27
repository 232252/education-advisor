// =============================================================
// SettingRow — 设置项行布局
// 左侧 label + 描述(可选)+ HintIcon, 右侧 children 控件
// =============================================================

import type { ReactNode } from 'react'
import { HintIcon } from './HintIcon'

export interface SettingRowProps {
  label: string
  path: string
  description?: string
  children: ReactNode
}

export function SettingRow({ label, path, description, children }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-6 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
          <HintIcon path={path} />
        </div>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-0.5">
            {description}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center">{children}</div>
    </div>
  )
}
