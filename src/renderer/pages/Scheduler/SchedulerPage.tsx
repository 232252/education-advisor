// =============================================================
// 任务调度中心 — 完整的 Cron 任务管理与执行日志（编排层）
// 结构: 表单(NewTaskForm) + 任务列表(TaskCard) + 日志(ExecutionLogPanel)
// =============================================================

import type { CronTask } from '@shared/types'
import { Clock, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { useT } from '../../i18n'
import { btnStyle } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { ExecutionLogPanel } from './components/ExecutionLogPanel'
import { NewTaskForm } from './components/NewTaskForm'
import { TaskCard } from './components/TaskCard'
import { useSchedulerData } from './hooks/useSchedulerData'

export function SchedulerPage() {
  const { t } = useT()
  const [showForm, setShowForm] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // CONCERN 修复: 编辑任务模式 — 当 editingTaskId 非空时,表单填充该任务数据
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const {
    tasks,
    logs,
    agents,
    loading,
    loadData,
    handleToggle,
    handleRunNow,
    handleRemove,
    handleCreate,
    handleEdit,
    confirmState,
    setConfirmState,
  } = useSchedulerData()

  // MEDIUM 修复: 校验 editingTaskId 有效性
  // 场景: 用户点击"编辑"后,任务被外部(如 cron 状态更新触发的 loadData)替换或删除,
  //       editingTaskId 指向的任务在 tasks 中找不到,editingTask=null → isEditing=false,
  //       表单会显示"新建"而非"编辑",提交时调用 onCreate 会创建重复任务。
  // 修复: tasks 变化时检查 editingTaskId 是否仍存在,失效则清除并关闭表单。
  // biome-ignore lint/correctness/useExhaustiveDependencies: t is stable from useT()
  useEffect(() => {
    if (editingTaskId && !tasks.find((t) => t.id === editingTaskId)) {
      setEditingTaskId(null)
      setShowForm(false)
      toast.warning(t('toast.scheduler.taskGone'))
    }
  }, [tasks, editingTaskId])

  // 创建/更新成功后关闭表单（原 handleCreate/handleEdit 内的 setShowForm 逻辑）
  const handleCreateAndClose = async (task: Omit<CronTask, 'id'>) => {
    if (await handleCreate(task)) {
      setShowForm(false)
    }
  }

  const handleEditAndClose = async (id: string, patch: Partial<CronTask>) => {
    if (await handleEdit(id, patch)) {
      setShowForm(false)
      setEditingTaskId(null)
    }
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* 头部 */}
      <PageHeader
        title={t('page.scheduler.title')}
        subtitle="管理 Agent 定时调度"
        size="md"
        actions={
          <>
            <button type="button" onClick={loadData} className={btnStyle('secondary')}>
              刷新
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingTaskId(null)
                setShowForm(!showForm)
              }}
              className={btnStyle(showForm ? 'secondary' : 'primary')}
            >
              {showForm ? '取消' : '+ 新增任务'}
            </button>
          </>
        }
      />

      {/* 新建/编辑表单 */}
      {showForm && (
        <NewTaskForm
          agents={agents}
          editingTask={editingTaskId ? (tasks.find((tk) => tk.id === editingTaskId) ?? null) : null}
          onCreate={handleCreateAndClose}
          onUpdate={handleEditAndClose}
          onCancel={() => {
            setShowForm(false)
            setEditingTaskId(null)
          }}
        />
      )}

      {/* 主体 */}
      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-500">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm">加载中...</span>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：任务列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 border-r border-gray-200 dark:border-white/[0.06]">
            {tasks.length === 0 ? (
              <EmptyState
                icon={<Clock size={28} />}
                title="暂无定时任务"
                description="点击「新增任务」或在 Agent 配置中设置 schedule"
              />
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
          <ExecutionLogPanel logs={logs} selectedTaskId={selectedTaskId} />
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
