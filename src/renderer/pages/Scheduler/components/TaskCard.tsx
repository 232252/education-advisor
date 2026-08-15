// =============================================================
// 任务卡片 — 开关/立即执行/编辑/删除 + 展开显示 prompt
// =============================================================

import type { AgentListItem, CronTask } from '@shared/types'
import { memo } from 'react'
import { btnStyle } from '../../../lib/ui-utils'
import { cronStatusColor, cronStatusLabel, isAutoTask } from '../lib/scheduler-utils'

interface TaskCardProps {
  task: CronTask
  agents: AgentListItem[]
  selected: boolean
  onSelect: () => void
  onToggle: (id: string, enabled: boolean) => void
  onRunNow: (id: string) => void
  onRemove: (id: string) => void
  onEdit: (id: string) => void
}

export const TaskCard = memo(function TaskCard({
  task,
  agents,
  selected,
  onSelect,
  onToggle,
  onRunNow,
  onRemove,
  onEdit,
}: TaskCardProps) {
  const agent = agents.find((a) => a.id === task.agentId)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={`bg-gray-50 border rounded-xl px-4 py-3 cursor-pointer transition-colors dark:bg-surface-tertiary
        ${selected ? 'border-blue-500' : 'border-gray-200 dark:border-white/[0.06] hover:border-gray-300 dark:hover:border-white/[0.1]'}`}
    >
      <div className="flex items-center gap-3">
        {/* 开关 */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(task.id, !task.enabled)
          }}
          aria-label={task.enabled ? '停用任务' : '启用任务'}
          className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0
            ${task.enabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span
            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
              ${task.enabled ? 'left-5' : 'left-0.5'}`}
          />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm whitespace-nowrap">{task.name}</span>
            {isAutoTask(task.id) && (
              <span className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded whitespace-nowrap">
                自动
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 flex items-center gap-2 min-w-0">
            <span className="truncate">{agent?.name ?? task.agentId}</span>
            <span className="text-gray-300 dark:text-gray-700">|</span>
            <code className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {task.expression}
            </code>
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          {task.lastStatus && (
            <div className={`text-xs ${cronStatusColor(task.lastStatus)}`}>
              {cronStatusLabel(task.lastStatus)}
            </div>
          )}
          {task.lastRunAt && (
            <div className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">
              {new Date(task.lastRunAt).toLocaleString('zh-CN')}
            </div>
          )}
        </div>

        <div className="flex gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRunNow(task.id)
            }}
            className={btnStyle('secondary')}
          >
            执行
          </button>
          {!isAutoTask(task.id) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(task.id)
              }}
              className={btnStyle('secondary')}
            >
              编辑
            </button>
          )}
          {!isAutoTask(task.id) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(task.id)
              }}
              className={btnStyle('danger')}
            >
              删除
            </button>
          )}
        </div>
      </div>

      {/* 展开显示 prompt */}
      {selected && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/[0.06]">
          <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">执行指令:</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-surface-tertiary rounded px-3 py-2 font-mono">
            {task.prompt}
          </div>
        </div>
      )}
    </div>
  )
})
