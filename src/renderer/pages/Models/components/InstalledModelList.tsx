// =============================================================
// InstalledModelList — 已安装本地模型列表(含删除)
// 结构自 LocalModelsSection.tsx 逐字搬移
// =============================================================

import type { OllamaModelInfo } from '@shared/types'
import { formatBytes } from '../lib/local-models'

interface InstalledModelListProps {
  installed: OllamaModelInfo[]
  onDelete: (name: string) => void
}

export function InstalledModelList({ installed, onDelete }: InstalledModelListProps) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-2">
        已安装模型（{installed.length}）
      </div>
      <div className="space-y-1">
        {installed.map((m) => (
          <div
            key={m.name}
            className="flex items-center justify-between bg-white/60 dark:bg-surface-elevated/40 rounded-lg px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-700 dark:text-gray-200 font-mono">{m.name}</span>
              {m.size > 0 && (
                <span className="text-[10px] text-gray-400">{formatBytes(m.size)}</span>
              )}
              {m.details?.parameter_size && (
                <span className="text-[10px] text-gray-400">{m.details.parameter_size}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDelete(m.name)}
              className="text-[10px] text-gray-400 hover:text-rose-500 transition-colors"
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
