// =============================================================
// HiddenProviderList — 已隐藏(黑名单)的 Provider 区块
// 结构自 ModelsPage.tsx 逐字搬移
// =============================================================

import type { ProviderInfo } from '@shared/types'
import { btnStyle } from '../../../lib/ui-utils'

interface HiddenProviderListProps {
  providers: ProviderInfo[]
  onUnhide: (providerId: string) => void
}

export function HiddenProviderList({ providers, onUnhide }: HiddenProviderListProps) {
  return (
    <div>
      <h2 className="text-sm font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">
        已隐藏 ({providers.length})
      </h2>
      <div className="space-y-1">
        {providers.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between px-4 py-2 rounded-lg bg-gray-100 dark:bg-surface-tertiary opacity-60"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 dark:text-gray-400">{p.name}</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                {p.modelCount} models
              </span>
            </div>
            <button
              type="button"
              onClick={() => onUnhide(p.id)}
              aria-label="取消隐藏"
              className={btnStyle('ghost')}
            >
              取消隐藏
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
