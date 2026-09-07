// =============================================================
// useSchedulerData — Cron 任务/日志/Agent 列表数据加载与动作 handlers
// 三源并行加载复用 useMultiLoader(allSettled + stale guard + reload),
// 单源失败不阻塞其他数据,失败仅 console.warn(与旧实现一致,不弹 toast)
// =============================================================

import type { AgentListItem, CronLogEntry, CronTask } from '@shared/types'
import { useEffect, useRef } from 'react'
import { useConfirmAction } from '../../../hooks/useConfirmAction'
import { useIpcSubscription } from '../../../hooks/useIpcSubscription'
import { useMultiLoader } from '../../../hooks/useMultiLoader'
import { useT } from '../../../i18n'
import { getAPI } from '../../../lib/ipc-client'
import { runIpcMutation } from '../../../lib/mutation'
import { toast } from '../../../stores/toastStore'

const SCHEDULER_FALLBACKS = {
  tasks: [] as CronTask[],
  logs: [] as CronLogEntry[],
  agents: [] as AgentListItem[],
}

export function useSchedulerData() {
  const { t } = useT()
  // 删除确认对话框状态(状态机统一走 useConfirmAction,字段与旧 SchedulerConfirmState 同形)
  const { state: confirmState, setState: setConfirmState, ask, close } = useConfirmAction()

  const { data, loading, errors, reload } = useMultiLoader(
    {
      tasks: async () => getAPI().cron.list(),
      logs: async () => getAPI().cron.getLogs(),
      agents: async () => getAPI().agent.list(),
    },
    { fallbacks: SCHEDULER_FALLBACKS },
  )
  const tasks = data.tasks as CronTask[]
  const logs = data.logs as CronLogEntry[]
  const agents = data.agents as AgentListItem[]

  // 局部失败与旧实现一致: 仅 console.warn,数据各自兜底 [] 不阻塞其他源
  useEffect(() => {
    const failed = Object.entries(errors)
    if (failed.length > 0) {
      console.warn(
        `[Scheduler] ${failed.length}/3 calls failed:`,
        failed.map(([, reason]) => String(reason)),
      )
    }
  }, [errors])

  // 监听状态更新(handler 经 ref 持有最新闭包,无需依赖 reload 身份)
  useIpcSubscription(
    (cb) => getAPI().cron.onStatusUpdate(cb),
    () => reload(),
  )

  // P2-6: setTimeout(reload, 2000) 用 ref 管理 timer,unmount 时清理
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
      reload()
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
        reload()
      }, 2000)
    } catch (err) {
      console.error('[Scheduler] Run now failed:', err)
      toast.error(t('toast.scheduler.runNowFailed'))
    }
  }

  const handleRemove = (id: string) => {
    ask(
      t('scheduler.confirmDelete'),
      async () => {
        try {
          await getAPI().cron.remove(id)
          reload()
        } catch (err) {
          console.error('[Scheduler] Remove failed:', err)
          toast.error(t('toast.scheduler.deleteFailed'))
        } finally {
          close()
        }
      },
      { variant: 'danger' },
    )
  }

  // 返回是否成功: 成功时由页面关闭表单(原页面 setShowForm 逻辑)
  // cron:add 校验失败时返回 { success: false, error } 而非抛异常,必须检查 success
  const handleCreate = (task: Omit<CronTask, 'id'>): Promise<boolean> =>
    runIpcMutation(() => getAPI().cron.add(task), {
      onOk: () => reload(),
      failMsg: (r) =>
        r.error
          ? `${t('toast.scheduler.createFailed')}: ${r.error}`
          : t('toast.scheduler.createFailed'),
      failLog: '[Scheduler] Create rejected:',
      catchMsg: t('toast.scheduler.createFailed'),
      catchLog: '[Scheduler] Create failed:',
    })

  // CONCERN 修复: 编辑任务入口 — 调用 IPC_CRON_UPDATE 更新已有任务
  // 返回是否成功: 成功时由页面关闭表单并清除编辑态
  const handleEdit = (id: string, patch: Partial<CronTask>): Promise<boolean> =>
    runIpcMutation(() => getAPI().cron.update(id, patch), {
      onOk: () => {
        reload()
        toast.success(t('toast.scheduler.taskUpdated'))
      },
      failMsg: t('toast.scheduler.updateFailed'),
      catchMsg: t('toast.scheduler.updateFailed'),
      catchLog: '[Scheduler] Edit failed:',
    })

  return {
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
  }
}
