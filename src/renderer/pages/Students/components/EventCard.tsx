// =============================================================
// EventCard — 事件选项卡中的完整事件卡片
// 可展开显示备注/累计/标签,支持撤销操作
// =============================================================

import type { EAAHistoryEvent } from '@shared/types'
import { CARD_BASE, cn } from '../../../lib/ui-utils'

export function EventCard({
  event,
  expanded,
  onToggle,
  reasonLabel,
  onRevert,
}: {
  event: EAAHistoryEvent
  expanded: boolean
  onToggle: () => void
  reasonLabel?: string
  onRevert?: () => void
}) {
  const isBonus = event.score_delta > 0
  const isDeduct = event.score_delta < 0
  return (
    <div
      className={cn(
        'rounded-xl border p-3.5 transition-all',
        event.reverted
          ? 'bg-gray-50 dark:bg-[#1a1e28]/50 opacity-60 border-gray-100 dark:border-white/[0.06]'
          : `${CARD_BASE} shadow-sm hover:shadow-md`,
      )}
    >
      <div
        className="flex items-center justify-between cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`font-mono font-bold text-sm ${isBonus ? 'text-green-500' : isDeduct ? 'text-red-500' : 'text-gray-500'}`}
          >
            {isBonus ? '+' : ''}
            {event.score_delta.toFixed(1)}
          </span>
          <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full font-medium">
            {reasonLabel ?? event.reason_code}
          </span>
          {event.reverted && (
            <span className="text-[10px] bg-red-100 dark:bg-red-900/30 text-red-500 px-1.5 py-0.5 rounded">
              已撤销
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
          <span>{new Date(event.timestamp).toLocaleDateString()}</span>
          <span className="text-gray-300 dark:text-gray-600">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/[0.06] text-xs space-y-1.5">
          {event.note && <div className="text-gray-600 dark:text-gray-300">📝 {event.note}</div>}
          <div className="flex gap-4 text-gray-500 dark:text-gray-400">
            <span>
              累计: <span className="font-mono">{event.cumulative.toFixed(1)}</span>
            </span>
            <span>标签: {event.tags.join('; ') || '无'}</span>
          </div>
          {/* 撤销按钮：仅未撤销事件显示 */}
          {onRevert && !event.reverted && (
            <div className="pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRevert()
                }}
                className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs font-medium transition-colors"
              >
                ↩ 撤销此事件
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
