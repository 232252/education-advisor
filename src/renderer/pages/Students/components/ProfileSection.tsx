// =============================================================
// ProfileSection — 档案选项卡中的分组区块
// 提供标题 (icon + 文本) 与内容容器,包裹 ProfileField 等
// =============================================================

import type { ReactNode } from 'react'
import { CARD_BASE } from '../../../lib/ui-utils'

export function ProfileSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: string
  children: ReactNode
}) {
  return (
    <div className={`${CARD_BASE} shadow-sm overflow-hidden`}>
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-[#1a1e28]/80 border-b border-gray-100 dark:border-white/[0.06] flex items-center gap-2">
        <span>{icon}</span>
        <h5 className="text-xs font-semibold text-gray-600 dark:text-gray-300">{title}</h5>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}
