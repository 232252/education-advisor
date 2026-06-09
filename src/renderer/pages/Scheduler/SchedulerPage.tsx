// =============================================================
// 任务调度中心 — 完整的 Cron 任务管理与执行日志
// =============================================================

import type { AgentListItem, CronLogEntry, CronTask } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

export function SchedulerPage() {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const { t } = useT()
  const [logs, setLogs] = useState<CronLogEntry[]>([])
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [taskData, logData, agentData] = await Promise.all([
        getAPI().cron.list(),
        getAPI().cron.getLogs(),
        getAPI().agent.list(),
      ])
      setTasks(taskData)
      setLogs(logData)
      setAgents(agentData)
    } catch (err) {
      console.error('[Scheduler] Failed to load:', err)
      toast.error('加载定时任务失败')
    } finally {
      setLoading(false)
    }
  }, [])

  // P2-3: 用 loadDataRef 包装 loadData,listener 回调里调用最新版本,避免闭包过期
  const loadDataRef = useRef(loadData)
  useEffect(() => {
    loadDataRef.current = loadData
  })

  useEffect(() => {
    loadData()
    // 监听状态更新
    const unsub = getAPI().cron.onStatusUpdate(() => {
      loadDataRef.current()
    })
    return unsub
  }, [loadData])

  // P2-6: setTimeout(loadData, 2000) 用 ref 管理 timer,unmount 时清理
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [])

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await getAPI().cron.toggle(id, enabled)
      loadData()
    } catch (err) {
      console.error('[Scheduler] Toggle failed:', err)
      toast.error('切换任务状态失败')
    }
  }

  const handleRunNow = async (id: string) => {
    try {
      await getAPI().cron.runNow(id)
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current)
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null
        loadData()
      }, 2000)
    } catch (err) {
      console.error('[Scheduler] Run now failed:', err)
      toast.error('立即执行任务失败')
    }
  }

  const handleRemove = async (id: string) => {
    if (!window.confirm('确定要删除此定时任务吗？')) return
    try {
      await getAPI().cron.remove(id)
      loadData()
    } catch (err) {
      console.error('[Scheduler] Remove failed:', err)
      toast.error('删除任务失败')
    }
  }

  const handleCreate = async (task: Omit<CronTask, 'id'>) => {
    try {
      await getAPI().cron.add(task)
      setShowForm(false)
      loadData()
    } catch (err) {
      console.error('[Scheduler] Create failed:', err)
      toast.error('创建任务失败')
    }
  }

  const selectedLogs = selectedTaskId ? logs.filter((l) => l.taskId === selectedTaskId) : logs

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-xl font-bold">{t('page.scheduler.title')}</h1>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={loadData}
            className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            刷新
          </button>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            {showForm ? '取消' : '+ 新增任务'}
          </button>
        </div>
      </div>

      {/* 新建表单 */}
      {showForm && (
        <NewTaskForm agents={agents} onCreate={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {/* 主体 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
          加载中...
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：任务列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 border-r border-gray-200 dark:border-gray-700">
            {tasks.length === 0 ? (
              <div className="text-center text-gray-400 dark:text-gray-500 py-8 text-sm">
                暂无定时任务
                <br />
                <span className="text-xs text-gray-400 dark:text-gray-600">
                  点击"新增任务"或在 Agent 配置中设置 schedule
                </span>
              </div>
            ) : (
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  agents={agents}
                  selected={selectedTaskId === task.id}
                  onSelect={() => setSelectedTaskId(selectedTaskId === task.id ? null : task.id)}
                  onToggle={handleToggle}
                  onRunNow={handleRunNow}
                  onRemove={handleRemove}
                />
              ))
            )}
          </div>

          {/* 右侧：执行日志 */}
          <div className="w-96 overflow-y-auto">
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300">
                {selectedTaskId ? '任务执行日志' : '全部执行日志'}
              </h3>
            </div>
            <div className="p-3 space-y-1">
              {selectedLogs.length === 0 ? (
                <div className="text-gray-400 dark:text-gray-600 text-xs text-center py-4">
                  暂无日志
                </div>
              ) : (
                [...selectedLogs]
                  .reverse()
                  .slice(0, 50)
                  .map((log) => (
                    // 使用 taskId + timestamp + status + error 组合 key (避免 index 重建)
                    <LogEntry
                      key={`${log.taskId}-${log.timestamp}-${log.status}-${log.error?.slice(0, 32) ?? ''}`}
                      log={log}
                    />
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================
// 任务卡片
// =============================================================

interface TaskCardProps {
  task: CronTask
  agents: AgentListItem[]
  selected: boolean
  onSelect: () => void
  onToggle: (id: string, enabled: boolean) => void
  onRunNow: (id: string) => void
  onRemove: (id: string) => void
}

function TaskCard({
  task,
  agents,
  selected,
  onSelect,
  onToggle,
  onRunNow,
  onRemove,
}: TaskCardProps) {
  const agent = agents.find((a) => a.id === task.agentId)

  const statusLabel = (status?: string) => {
    switch (status) {
      case 'success':
        return '成功'
      case 'error':
        return '失败'
      case 'timeout':
        return '超时'
      default:
        return ''
    }
  }

  const statusColor = (status?: string) => {
    switch (status) {
      case 'success':
        return 'text-green-500 dark:text-green-400'
      case 'error':
        return 'text-red-500 dark:text-red-400'
      case 'timeout':
        return 'text-yellow-500 dark:text-yellow-400'
      default:
        return 'text-gray-400 dark:text-gray-600'
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: 用 div 作为可点击卡片, 保持卡片视觉一致性
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
      className={`bg-gray-50 border rounded-xl px-4 py-3 cursor-pointer transition-colors dark:bg-gray-800
        ${selected ? 'border-blue-500' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}`}
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
            {task.id.startsWith('agent-schedule-') && (
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
            <div className={`text-xs ${statusColor(task.lastStatus)}`}>
              {statusLabel(task.lastStatus)}
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
            className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-2.5 py-1 rounded text-xs transition-colors"
          >
            执行
          </button>
          {!task.id.startsWith('agent-schedule-') && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(task.id)
              }}
              className="bg-gray-200 hover:bg-red-600 dark:bg-gray-700 dark:hover:bg-red-700 px-2.5 py-1 rounded text-xs transition-colors"
            >
              删除
            </button>
          )}
        </div>
      </div>

      {/* 展开显示 prompt */}
      {selected && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">执行指令:</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-900 rounded px-3 py-2 font-mono">
            {task.prompt}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================
// 执行日志条目
// =============================================================

function LogEntry({ log }: { log: CronLogEntry }) {
  const time = new Date(log.timestamp)
  const timeStr = `${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`

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
}

// =============================================================
// 新建任务表单
// =============================================================

interface NewTaskFormProps {
  agents: AgentListItem[]
  onCreate: (task: Omit<CronTask, 'id'>) => void
  onCancel: () => void
}

function NewTaskForm({ agents, onCreate, onCancel }: NewTaskFormProps) {
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [expression, setExpression] = useState('0 9 * * *')
  const [prompt, setPrompt] = useState('')
  const [modelTier, setModelTier] = useState<'high_quality' | 'low_cost'>('low_cost')

  const presets = [
    { label: '每天早上 9 点', value: '0 9 * * *' },
    { label: '每天下午 2 点', value: '0 14 * * *' },
    { label: '每周一 9 点', value: '0 9 * * 1' },
    { label: '每 30 分钟', value: '*/30 * * * *' },
    { label: '每小时', value: '0 * * * *' },
  ]

  const handleSubmit = () => {
    if (!name.trim() || !agentId || !expression.trim() || !prompt.trim()) return
    onCreate({
      name: name.trim(),
      agentId,
      expression: expression.trim(),
      prompt: prompt.trim(),
      enabled: true,
      modelTier,
    })
  }

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800/50">
      <h3 className="text-sm font-medium mb-3">新建定时任务</h3>

      <div className="grid grid-cols-2 gap-3">
        {/* 任务名称 */}
        <div>
          <label
            htmlFor="task-name"
            className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
          >
            任务名称
          </label>
          <input
            id="task-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 每日巡检"
            className="w-full bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Agent 选择 */}
        <div>
          <label
            htmlFor="task-agent"
            className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
          >
            Agent
          </label>
          <select
            id="task-agent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            {agents.length === 0 && <option value="">无可用 Agent</option>}
          </select>
        </div>

        {/* Cron 表达式 */}
        <div>
          <label
            htmlFor="task-cron"
            className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
          >
            Cron 表达式
          </label>
          <input
            id="task-cron"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="* * * * *"
            className="w-full bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {presets.map((p) => (
              <button
                type="button"
                key={p.value}
                onClick={() => setExpression(p.value)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors
                  ${expression === p.value ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* 模型层级 */}
        <div>
          <span className="text-xs text-gray-400 dark:text-gray-500 block mb-1">模型</span>
          <div className="flex gap-2" role="radiogroup" aria-label="模型层级">
            {/* biome-ignore lint/a11y/useSemanticElements: 用 button 模拟 radio 以保持视觉一致性 */}
            <button
              type="button"
              role="radio"
              aria-checked={modelTier === 'low_cost'}
              onClick={() => setModelTier('low_cost')}
              className={`flex-1 text-sm py-1.5 rounded transition-colors
                ${modelTier === 'low_cost' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
            >
              低成本
            </button>
            {/* biome-ignore lint/a11y/useSemanticElements: 用 button 模拟 radio 以保持视觉一致性 */}
            <button
              type="button"
              role="radio"
              aria-checked={modelTier === 'high_quality'}
              onClick={() => setModelTier('high_quality')}
              className={`flex-1 text-sm py-1.5 rounded transition-colors
                ${modelTier === 'high_quality' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}
            >
              高质量
            </button>
          </div>
        </div>
      </div>

      {/* Prompt */}
      <div className="mt-3">
        <label
          htmlFor="task-prompt"
          className="text-xs text-gray-400 dark:text-gray-500 block mb-1"
        >
          执行指令
        </label>
        <textarea
          id="task-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Agent 每次执行时收到的指令..."
          rows={2}
          className="w-full bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-600 rounded px-3 py-2 text-sm resize-none
            focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* 按钮 */}
      <div className="flex justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={onCancel}
          className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-4 py-1.5 rounded text-sm transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || !agentId || !expression.trim() || !prompt.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-1.5 rounded text-sm transition-colors"
        >
          创建
        </button>
      </div>
    </div>
  )
}
