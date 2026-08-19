// =============================================================
// useSchedulerData — Cron 任务/日志/Agent 列表数据加载与动作 handlers
// =============================================================

import type { AgentListItem, CronLogEntry, CronTask } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { toast } from '../../../stores/toastStore'

/** 删除确认对话框状态 */
export interface SchedulerConfirmState {
  open: boolean
  message: string
  title?: string
  onConfirm: () => void
  variant?: 'default' | 'danger'
}

export function useSchedulerData() {
  const { t } = useT()
  const [tasks, setTasks] = useState<CronTask[]>([])
  const [logs, setLogs] = useState<CronLogEntry[]>([])
  const [agents, setAgents] = useState<AgentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmState, setConfirmState] = useState<SchedulerConfirmState>({
    open: false,
    message: '',
    onConfirm: () => {},
  })

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
      toast.error(t('toast.scheduler.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

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
      toast.error(t('toast.scheduler.toggleFailed'))
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
      toast.error(t('toast.scheduler.runNowFailed'))
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
          toast.error(t('toast.scheduler.deleteFailed'))
        } finally {
          setConfirmState((prev) => ({ ...prev, open: false }))
        }
      },
    })
  }

  // 返回是否成功: 成功时由页面关闭表单(原页面 setShowForm 逻辑)
  // cron:add 校验失败时返回 { success: false, error } 而非抛异常,必须检查 success
  const handleCreate = async (task: Omit<CronTask, 'id'>): Promise<boolean> => {
    try {
      const result = await getAPI().cron.add(task)
      if (result.success) {
        loadData()
        return true
      }
      console.error('[Scheduler] Create rejected:', result.error)
      toast.error(
        result.error
          ? `${t('toast.scheduler.createFailed')}: ${result.error}`
          : t('toast.scheduler.createFailed'),
      )
      return false
    } catch (err) {
      console.error('[Scheduler] Create failed:', err)
      toast.error(t('toast.scheduler.createFailed'))
      return false
    }
  }

  // CONCERN 修复: 编辑任务入口 — 调用 IPC_CRON_UPDATE 更新已有任务
  // 返回是否成功: 成功时由页面关闭表单并清除编辑态
  const handleEdit = async (id: string, patch: Partial<CronTask>): Promise<boolean> => {
    try {
      const result = await getAPI().cron.update(id, patch)
      if (result.success) {
        loadData()
        toast.success(t('toast.scheduler.taskUpdated'))
        return true
      }
      toast.error(t('toast.scheduler.updateFailed'))
      return false
    } catch (err) {
      console.error('[Scheduler] Edit failed:', err)
      toast.error(t('toast.scheduler.updateFailed'))
      return false
    }
  }

  return {
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
  }
}
