// =============================================================
// 任务调度中心 — 完整的 Cron 任务管理与执行日志（编排层）
// 结构: 表单(NewTaskForm) + 任务列表(TaskCard) + 日志(ExecutionLogPanel)
// =============================================================

import type { CronTask } from '@shared/types'
import { Clock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { EmptyState } from '../../components/EmptyState'
import { PageHeader } from '../../components/PageHeader'
import { Skeleton } from '../../components/Skeleton'
import { useT } from '../../i18n'
import { getAPI } from '../../lib/ipc-client'
import { btnStyle } from '../../lib/ui-utils'
import { toast } from '../../stores/toastStore'
import { ToggleSwitch } from '../Settings/components/ToggleSwitch'
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
  const [schedulerEnabled, setSchedulerEnabled] = useState(true)
  const [masterConfirm, setMasterConfirm] = useState(false)
  const {
    tasks,
    logs,
    agents,
    loading,
    reload,
    handleToggle,
    handleRunNow,
    handleRemove,
    handleCreate,
    handleEdit,
    confirmState,
    setConfirmState,
  } = useSchedulerData()

  useEffect(() => {
    let cancelled = false
    void getAPI()
      .settings.get()
      .then((s) => {
        if (!cancelled) setSchedulerEnabled(s.general?.schedulerEnabled !== false)
      })
      .catch(() => {
        /* 保持默认开,避免误关 */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const applyMaster = async (enabled: boolean) => {
    try {
      await getAPI().settings.set('general.schedulerEnabled', enabled)
      setSchedulerEnabled(enabled)
      toast.success(
        enabled
          ? t('toast.scheduler.masterOn', '定时任务已全部开启')
          : t('toast.scheduler.masterOff', '定时任务已全部暂停'),
      )
    } catch (err) {
      console.error('[Scheduler] Master toggle failed:', err)
      toast.error(t('toast.scheduler.toggleFailed'))
    }
  }

  const handleMasterToggle = (next: boolean) => {
    if (next) {
      setMasterConfirm(true)
      return
    }
    void applyMaster(false)
  }

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
        subtitle={t('page.scheduler.subtitle', '管理 Agent 定时调度')}
        size="md"
        actions={
          <>
            <span className="flex items-center gap-2 mr-2">
              <ToggleSwitch
                size="sm"
                checked={schedulerEnabled}
                label={t('page.scheduler.master.label', '定时任务总开关')}
                onChange={handleMasterToggle}
              />
              <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {schedulerEnabled
                  ? t('page.scheduler.master.on', '定时已开')
                  : t('page.scheduler.master.off', '定时已关')}
              </span>
            </span>
            <button type="button" onClick={reload} className={btnStyle('secondary')}>
              {t('common.refresh', '刷新')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingTaskId(null)
                setShowForm(!showForm)
              }}
              className={btnStyle(showForm ? 'secondary' : 'primary')}
            >
              {showForm ? t('common.cancel', '取消') : t('page.scheduler.newTask', '+ 新增任务')}
            </button>
          </>
        }
      />

      {/* 总开关关闭横幅 */}
      {!schedulerEnabled && !loading && (
        <div className="mx-4 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {t(
            'page.scheduler.master.banner',
            '定时任务总开关已关闭：日程不会自动跑。需要时再打开；打开会持续消耗大量 Token。',
          )}
        </div>
      )}

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
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：任务卡片骨架 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 border-r border-gray-200 dark:border-white/[0.06]">
            {Array.from({ length: 4 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素，不会重排序
              <Skeleton key={`task-${i}`} className="h-16 w-full rounded-xl" />
            ))}
          </div>
          {/* 右侧：执行日志骨架 */}
          <div className="w-96 p-3">
            <Skeleton className="h-4 w-24 mb-3" />
            <div className="space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 骨架屏静态元素，不会重排序
                <Skeleton key={`log-${i}`} className="h-5 w-full" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：任务列表 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 border-r border-gray-200 dark:border-white/[0.06]">
            {tasks.length === 0 ? (
              <EmptyState
                icon={<Clock size={28} />}
                title={t('page.scheduler.empty', '暂无定时任务')}
                description={t(
                  'page.scheduler.emptyDesc',
                  '点击「新增任务」或在 Agent 配置中设置 schedule',
                )}
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
        open={masterConfirm}
        title={t('page.scheduler.master.confirmTitle', '开启全部定时任务?')}
        message={t(
          'page.scheduler.master.confirm',
          '开启后各 Agent 会按日程自动跑(晨检/午检/晚检/周报等),会消耗大量 Token。如果按量付费,费用会非常吃紧。确定要打开吗?',
        )}
        variant="danger"
        onConfirm={() => {
          setMasterConfirm(false)
          void applyMaster(true)
        }}
        onCancel={() => setMasterConfirm(false)}
      />
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
