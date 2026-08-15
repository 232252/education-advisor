// =============================================================
// 执行日志条目
// =============================================================

import type { CronLogEntry } from '@shared/types'
import { memo } from 'react'
import { formatLogTime } from '../lib/scheduler-utils'

export const LogEntry = memo(function LogEntry({ log }: { log: CronLogEntry }) {
  const timeStr = formatLogTime(log.timestamp)

  return (
    <div className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800/50">
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0
        ${
          log.status === 'success'
            ? 'bg-green-400'
            : log.status === 'error'
              ? 'bg-red-400'
              : 'bg-yellow-400'
        }`}
      />
      <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{timeStr}</span>
      <span className="text-gray-500 dark:text-gray-400 truncate">{log.agentId}</span>
      <span className="text-gray-400 dark:text-gray-600 ml-auto flex-shrink-0">
        {(log.durationMs / 1000).toFixed(1)}s
      </span>
      {log.status === 'success' && (
        <span className="text-green-500 dark:text-green-400 flex-shrink-0" title="执行成功">
          ✓
        </span>
      )}
      {log.error && (
        <span className="text-red-500 dark:text-red-400 truncate max-w-[120px]" title={log.error}>
          {log.error}
        </span>
      )}
    </div>
  )
})
