// =============================================================
// 执行日志面板 — 右侧日志列表（按选中任务过滤,取最近 50 条倒序展示）
// =============================================================

import type { CronLogEntry } from '@shared/types'
import { ClipboardList } from 'lucide-react'
import { EmptyState } from '../../../components/EmptyState'
import { getRecentLogs, selectLogsForTask } from '../lib/scheduler-utils'
import { LogEntry } from './LogEntry'

interface ExecutionLogPanelProps {
  logs: CronLogEntry[]
  selectedTaskId: string | null
}

export function ExecutionLogPanel({ logs, selectedTaskId }: ExecutionLogPanelProps) {
  const selectedLogs = selectLogsForTask(logs, selectedTaskId)

  return (
    <div className="w-96 overflow-y-auto">
      <div className="p-3 border-b border-gray-200 dark:border-white/[0.06]">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
          {selectedTaskId ? '任务执行日志' : '全部执行日志'}
        </h3>
      </div>
      <div className="p-3 space-y-1">
        {selectedLogs.length === 0 ? (
          <EmptyState icon={<ClipboardList size={28} />} title="暂无日志" className="py-4" />
        ) : (
          getRecentLogs(selectedLogs, 50).map((log) => (
            // 使用 taskId + timestamp + status + error 组合 key (避免 index 重建)
            <LogEntry
              key={`${log.taskId}-${log.timestamp}-${log.status}-${log.error?.slice(0, 32) ?? ''}`}
              log={log}
            />
          ))
        )}
      </div>
    </div>
  )
}
