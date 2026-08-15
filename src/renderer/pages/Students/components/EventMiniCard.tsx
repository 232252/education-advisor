// =============================================================
// EventMiniCard — 概览选项卡"最近事件"列表中的迷你事件卡片
// 单行紧凑显示: 分数变动 + 原因码 + 备注 + 日期
// =============================================================

import type { EAAHistoryEvent } from '@shared/types'

export function EventMiniCard({ event }: { event: EAAHistoryEvent }) {
  const isBonus = event.score_delta > 0
  return (
    <div className="flex items-center justify-between text-sm p-2.5 bg-gray-50 dark:bg-surface-tertiary/50 rounded-lg border border-gray-100 dark:border-white/[0.06]">
      <div className="flex items-center gap-2 min-w-0">
        <span className={`font-mono font-bold ${isBonus ? 'text-green-500' : 'text-red-500'}`}>
          {isBonus ? '+' : ''}
          {event.score_delta.toFixed(1)}
        </span>
        <span className="text-[10px] bg-gray-200 dark:bg-surface-elevated px-1.5 py-0.5 rounded font-mono">
          {event.reason_code}
        </span>
        {event.note && (
          <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{event.note}</span>
        )}
      </div>
      <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-2 flex-shrink-0">
        {new Date(event.timestamp).toLocaleDateString()}
      </span>
    </div>
  )
}
