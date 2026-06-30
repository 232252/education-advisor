// =============================================================
// 任务调度中心 — 完整的 Cron 任务管理与执行日志
// =============================================================

import type { AgentListItem, CronLogEntry, CronTask } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { toast } from '../../stores/toastStore'

// =============================================================
// Cron 表达式前端基本格式校验 (不依赖 IPC, 输入时实时反馈)
//  格式: minute hour day-of-month month day-of-week
//  支持: * / - , 数字, */n, a-b/n
// =============================================================

interface CronValidationResult {
  valid: boolean
  error?: string
}

const CRON_FIELD_RANGES = [
  { name: '分钟', min: 0, max: 59 },
  { name: '小时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12 },
  { name: '周', min: 0, max: 7 }, // 0 和 7 都是周日
] as const

function validateCronField(
  field: string,
  range: { name: string; min: number; max: number },
): string | null {
  if (field === '*') return null
  const subFields = field.split(',')
  for (const sub of subFields) {
    if (sub === '') return `空字段 "${field}"`
    // 处理 */n
    if (sub.startsWith('*/')) {
      const step = Number.parseInt(sub.slice(2), 10)
      if (Number.isNaN(step) || step < 1) return `步长 "${sub}" 无效`
      continue
    }
    // 处理 a-b 或 a-b/n
    const rangeMatch = sub.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (rangeMatch) {
      const [, startStr, endStr, stepStr] = rangeMatch
      const start = Number.parseInt(startStr, 10)
      const end = Number.parseInt(endStr, 10)
      const effectiveMaxStart = range.name === '周' && start === 7 ? 7 : range.max
      const effectiveMaxEnd = range.name === '周' && end === 7 ? 7 : range.max
      if (start < range.min || start > effectiveMaxStart)
        return `${start} 超出范围 ${range.min}-${range.max}`
      if (end < range.min || end > effectiveMaxEnd)
        return `${end} 超出范围 ${range.min}-${range.max}`
      if (stepStr) {
        const step = Number.parseInt(stepStr, 10)
        if (step < 1) return `步长 ${step} 无效`
      }
      continue
    }
    // 处理纯数字
    const num = Number.parseInt(sub, 10)
    if (Number.isNaN(num)) return `"${sub}" 不是有效数字`
    // 周的特殊处理: 0 和 7 都表示周日
    const effectiveMax = range.name === '周' && num === 7 ? 7 : range.max
    if (num < range.min || num > effectiveMax) return `${num} 超出范围 ${range.min}-${range.max}`
  }
  return null
}

/** 基本 cron 表达式校验 — 5 段格式 + 每段范围检查
 *  支持宏表达式 (@daily, @hourly 等,与 node-cron 兼容) */
const CRON_MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

function validateCron(expr: string): CronValidationResult {
  if (!expr || typeof expr !== 'string') return { valid: false, error: '表达式不能为空' }
  // 宏表达式支持 (@daily 等与 node-cron 兼容)
  const macroKey = expr.trim().toLowerCase()
  if (macroKey.startsWith('@')) {
    if (macroKey in CRON_MACROS) return { valid: true }
    return {
      valid: false,
      error: `未知宏表达式: ${expr} (支持: @yearly/@monthly/@weekly/@daily/@hourly)`,
    }
  }
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return { valid: false, error: '需要 5 段: 分 时 日 月 周' }
  for (let i = 0; i < 5; i++) {
    const err = validateCronField(parts[i], CRON_FIELD_RANGES[i])
    if (err) return { valid: false, error: `${CRON_FIELD_RANGES[i].name}: ${err}` }
  }
  return { valid: true }
}

export function SchedulerPage() {
  const [tasks, setTasks] = useState<CronTask[]>([])
  const { t } = useT()
  const [logs, setLogs] = useState<CronLogEntry[]>([])
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // CONCERN 修复: 编辑任务模式 — 当 editingTaskId 非空时,表单填充该任务数据
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [confirmState, setConfirmState] = useState<{
    open: boolean
    message: string
    title?: string
    onConfirm: () => void
    variant?: 'default' | 'danger'
  }>({ open: false, message: '', onConfirm: () => {} })

  const loadData = useCallback(async () => {
    try {
      // 使用 allSettled: 单个 IPC 调用失败不阻塞其他数据加载
      // 例如 agent.list() 失败时,cron 任务和日志仍能正常显示
      const results = await Promise.allSettled([
        getAPI().cron.list(),
        getAPI().cron.getLogs(),
        getAPI().agent.list(),
      ])
      const [taskData, logData, agentData] = results.map((r) =>
        r.status === 'fulfilled' ? r.value : [],
      )
      setTasks(taskData as CronTask[])
      setLogs(logData as CronLogEntry[])
      setAgents(agentData as AgentListItem[])
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        console.warn(
          `[Scheduler] ${failed.length}/${results.length} calls failed:`,
          failed.map((r) => String((r as PromiseRejectedResult).reason)),
        )
      }
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

  // MEDIUM 修复: 校验 editingTaskId 有效性
  // 场景: 用户点击"编辑"后,任务被外部(如 cron 状态更新触发的 loadData)替换或删除,
  //       editingTaskId 指向的任务在 tasks 中找不到,editingTask=null → isEditing=false,
  //       表单会显示"新建"而非"编辑",提交时调用 onCreate 会创建重复任务。
  // 修复: tasks 变化时检查 editingTaskId 是否仍存在,失效则清除并关闭表单。
  useEffect(() => {
    if (editingTaskId && !tasks.find((t) => t.id === editingTaskId)) {
      setEditingTaskId(null)
      setShowForm(false)
      toast.warning('编辑的任务已不存在,表单已关闭')
    }
  }, [tasks, editingTaskId])

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

  const handleRemove = (id: string) => {
    setConfirmState({
      open: true,
      message: '确定要删除此定时任务吗？',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await getAPI().cron.remove(id)
          loadData()
        } catch (err) {
          console.error('[Scheduler] Remove failed:', err)
          toast.error('删除任务失败')
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
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

  // CONCERN 修复: 编辑任务入口 — 调用 IPC_CRON_UPDATE 更新已有任务
  const handleEdit = async (id: string, patch: Partial<CronTask>) => {
    try {
      const result = await getAPI().cron.update(id, patch)
      if (result.success) {
        setShowForm(false)
        setEditingTaskId(null)
        loadData()
        toast.success('任务已更新')
      } else {
        toast.error('更新任务失败')
      }
    } catch (err) {
      console.error('[Scheduler] Edit failed:', err)
      toast.error('更新任务失败')
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
            onClick={() => {
              setEditingTaskId(null)
              setShowForm(!showForm)
            }}
            className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg text-sm transition-colors"
          >
            {showForm ? '取消' : '+ 新增任务'}
          </button>
        </div>
      </div>

      {/* 新建/编辑表单 */}
      {showForm && (
        <NewTaskForm
          agents={agents}
          editingTask={editingTaskId ? (tasks.find((tk) => tk.id === editingTaskId) ?? null) : null}
          onCreate={handleCreate}
          onUpdate={handleEdit}
          onCancel={() => {
            setShowForm(false)
            setEditingTaskId(null)
          }}
        />
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
                  onEdit={(id) => {
                    setEditingTaskId(id)
                    setShowForm(true)
                  }}
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

      <ConfirmDialog
        open={confirmState.open}
        title={confirmState.title}
        message={confirmState.message}
        variant={confirmState.variant}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState((prev) => ({ ...prev, open: false }))}
      />
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
  onEdit: (id: string) => void
}

function TaskCard({
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
            className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-2.5 py-1 rounded-lg text-xs transition-colors"
          >
            执行
          </button>
          {!task.id.startsWith('agent-schedule-') && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onEdit(task.id)
              }}
              className="bg-gray-200 hover:bg-blue-600 dark:bg-gray-700 dark:hover:bg-blue-700 px-2.5 py-1 rounded-lg text-xs transition-colors"
            >
              编辑
            </button>
          )}
          {!task.id.startsWith('agent-schedule-') && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(task.id)
              }}
              className="bg-gray-200 hover:bg-red-600 dark:bg-gray-700 dark:hover:bg-red-700 px-2.5 py-1 rounded-lg text-xs transition-colors"
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
  /** 编辑模式:传入已有任务则填充表单,提交时调用 onUpdate */
  editingTask: CronTask | null
  onCreate: (task: Omit<CronTask, 'id'>) => void
  onUpdate: (id: string, patch: Partial<CronTask>) => void
  onCancel: () => void
}

function NewTaskForm({ agents, editingTask, onCreate, onUpdate, onCancel }: NewTaskFormProps) {
  const isEditing = editingTask !== null
  const [name, setName] = useState(editingTask?.name ?? '')
  const [agentId, setAgentId] = useState(editingTask?.agentId ?? agents[0]?.id ?? '')
  const [expression, setExpression] = useState(editingTask?.expression ?? '0 9 * * *')
  const [prompt, setPrompt] = useState(editingTask?.prompt ?? '')
  const [modelTier, setModelTier] = useState<'high_quality' | 'low_cost'>(
    editingTask?.modelTier ?? 'low_cost',
  )

  // LOW 修复: 切换 editingTask 时(从"编辑任务 A"切到"编辑任务 B",
  // 或在打开表单状态下从其他位置触发编辑)同步表单字段。
  // useState 初始化只在 mount 时执行一次,editingTask prop 变化不会自动同步,
  // 导致切到 B 后表单仍显示 A 的数据,提交时覆盖错任务。
  // 仅当 editingTask.id 实际变化时才同步,避免每次父组件重渲都重置用户输入。
  const lastEditingIdRef = useRef<string | null>(editingTask?.id ?? null)
  useEffect(() => {
    const currentId = editingTask?.id ?? null
    if (currentId === lastEditingIdRef.current) return
    lastEditingIdRef.current = currentId
    setName(editingTask?.name ?? '')
    setAgentId(editingTask?.agentId ?? agents[0]?.id ?? '')
    setExpression(editingTask?.expression ?? '0 9 * * *')
    setPrompt(editingTask?.prompt ?? '')
    setModelTier(editingTask?.modelTier ?? 'low_cost')
  }, [editingTask, agents])

  // LOW 修复: 编辑模式下,若 editingTask.agentId 不在 agents 列表中(已被删除),
  // 自动回退到第一个可用 agent 并提示用户,避免提交时使用无效 agentId。
  // 也覆盖 agents 列表异步加载完成后 agentId 仍指向已删除 agent 的场景。
  useEffect(() => {
    if (agents.length === 0) return
    if (agentId && agents.find((a) => a.id === agentId)) return
    // 当前 agentId 无效,回退到第一个可用 agent
    const fallback = agents[0]?.id ?? ''
    if (fallback && fallback !== agentId) {
      setAgentId(fallback)
      if (isEditing) {
        toast.warning('原 Agent 已删除,已回退到第一个可用 Agent')
      }
    }
  }, [agents, agentId, isEditing])

  // P0: cron 表达式实时校验 (前端基本格式校验, 提交前再次校验避免漏判)
  const cronValidation = validateCron(expression)
  const isCronValid = cronValidation.valid

  const presets = [
    { label: '每天早上 9 点', value: '0 9 * * *' },
    { label: '每天下午 2 点', value: '0 14 * * *' },
    { label: '每周一 9 点', value: '0 9 * * 1' },
    { label: '每 30 分钟', value: '*/30 * * * *' },
    { label: '每小时', value: '0 * * * *' },
  ]

  const handleSubmit = () => {
    if (!name.trim() || !agentId || !expression.trim() || !prompt.trim()) return
    // 提交前再次校验, 防止绕过 disabled 的情况 (如直接触发)
    if (!isCronValid) {
      toast.error(`Cron 表达式无效: ${cronValidation.error ?? ''}`)
      return
    }
    if (isEditing && editingTask) {
      onUpdate(editingTask.id, {
        name: name.trim(),
        agentId,
        expression: expression.trim(),
        prompt: prompt.trim(),
        modelTier,
      })
    } else {
      onCreate({
        name: name.trim(),
        agentId,
        expression: expression.trim(),
        prompt: prompt.trim(),
        enabled: true,
        modelTier,
      })
    }
  }

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800/50">
      <h3 className="text-sm font-medium mb-3">{isEditing ? '编辑定时任务' : '新建定时任务'}</h3>

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
            aria-invalid={!isCronValid}
            className={`w-full bg-white border rounded px-3 py-1.5 text-sm font-mono focus:outline-none
              ${isCronValid ? 'border-gray-300 dark:bg-gray-900 dark:border-gray-600 focus:border-blue-500' : 'border-red-400 dark:border-red-500 dark:bg-gray-900 focus:border-red-500'}`}
          />
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {presets.map((p) => (
              <button
                type="button"
                key={p.value}
                onClick={() => setExpression(p.value)}
                className={`text-[10px] px-2 py-0.5 rounded-lg transition-colors
                  ${expression === p.value ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* 实时校验提示 */}
          <div
            className={`mt-1 text-[11px] leading-tight ${
              isCronValid ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
            }`}
            role={isCronValid ? 'status' : 'alert'}
          >
            {isCronValid ? '✓ 表达式有效' : `✗ ${cronValidation.error ?? '无效'}`}
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
              className={`flex-1 text-sm py-1.5 rounded-lg transition-colors
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
              className={`flex-1 text-sm py-1.5 rounded-lg transition-colors
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
          className="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-4 py-1.5 rounded-lg text-sm transition-colors"
        >
          取消
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={
            !name.trim() || !agentId || !expression.trim() || !prompt.trim() || !isCronValid
          }
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-1.5 rounded-lg text-sm transition-colors"
        >
          {isEditing ? '保存' : '创建'}
        </button>
      </div>
    </div>
  )
}
