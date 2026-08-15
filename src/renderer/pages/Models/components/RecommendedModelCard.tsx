// =============================================================
// RecommendedModelCard — 单个推荐模型卡(下载按钮/进度条/手动下载链接)
// 结构与行内计算自 LocalModelsSection.tsx 逐字搬移
// =============================================================

import type { OllamaModelInfo, OllamaPullProgressInfo } from '@shared/types'
import type { RecommendedModel } from '../lib/local-models'

interface RecommendedModelCardProps {
  model: RecommendedModel
  installed: OllamaModelInfo[]
  pulling: string | null
  progress: OllamaPullProgressInfo | null
  serveRunning: boolean
  expandedManual: string | null
  onToggleExpandedManual: (tag: string) => void
  onPull: (tag: string) => void
}

export function RecommendedModelCard({
  model: m,
  installed,
  pulling,
  progress,
  serveRunning,
  expandedManual,
  onToggleExpandedManual,
  onPull,
}: RecommendedModelCardProps) {
  const isInstalled = installed.some((i) => i.name === m.tag)
  const isPullingThis = pulling === m.tag
  const progPct =
    progress && progress.model === m.tag && progress.total
      ? Math.round(((progress.completed ?? 0) / progress.total) * 100)
      : 0
  return (
    <div className="bg-white/80 dark:bg-surface-elevated/60 border border-gray-200 dark:border-white/[0.06]/60 rounded-lg p-3">
      <div className="flex items-start justify-between mb-1">
        <div>
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{m.name}</span>
          <span className="ml-2 text-[10px] text-gray-400">{m.size}</span>
          <span
            className={`ml-1 text-[10px] px-1 py-0.5 rounded ${
              m.tier === 'GPU/大内存'
                ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                : m.tier === 'CPU进阶'
                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'
            }`}
          >
            {m.tier}
          </span>
          <span
            className={`ml-1 text-[10px] px-1 py-0.5 rounded ${
              m.chinese === '优秀'
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-gray-100 text-gray-500 dark:bg-surface-elevated dark:text-gray-400'
            }`}
          >
            中文{m.chinese}
          </span>
        </div>
        {isInstalled ? (
          <span className="text-[10px] text-emerald-500 dark:text-emerald-400 flex-shrink-0">
            ✓ 已安装
          </span>
        ) : isPullingThis ? (
          <span className="text-[10px] text-indigo-500 flex-shrink-0">{progPct}%</span>
        ) : (
          <button
            type="button"
            onClick={() => onPull(m.tag)}
            disabled={!serveRunning || !!pulling}
            className="text-[10px] px-2 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 disabled:opacity-40 transition-colors flex-shrink-0"
          >
            下载
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">{m.desc}</p>
      {/* 下载进度条 */}
      {isPullingThis && (
        <div className="mt-2 h-1.5 bg-gray-200 dark:bg-surface-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${progPct}%` }}
          />
        </div>
      )}
      {/* 手动下载链接 */}
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          onClick={() => onToggleExpandedManual(m.tag)}
          className="text-[10px] text-gray-400 hover:text-indigo-500 transition-colors"
        >
          {expandedManual === m.tag ? '收起' : '手动下载'}
        </button>
        {expandedManual === m.tag && (
          <div className="flex gap-2">
            {m.manual.map((url) => (
              <a
                key={url.url}
                href={url.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-indigo-500 dark:text-indigo-400 underline"
              >
                {url.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
