// =============================================================
// Cron 调度绑定 — node-cron 任务的注册/注销 + nextRunAt 刷新
// 从 cron-service.ts 的 schedule/unschedule 下沉,逻辑逐行对照搬迁
// =============================================================

import type { CronTask } from '@shared/types'
import cron, { type ScheduledTask } from 'node-cron'
import { settingsService } from '../settings-service'

/** 调度绑定状态(宿主 CronService 持有对应 Map 并以引用传入,模块仅做 set/delete) */
export interface SchedulerBindingState {
  scheduledJobs: Map<string, ScheduledTask>
  /** 下次执行时间 ISO 字符串 */
  nextRunAt: Map<string, string>
}

/** 注册 cron 任务:时区读取 + node-cron 包装 + nextRunAt 刷新(P1-8) */
export function scheduleCronJob(
  state: SchedulerBindingState,
  id: string,
  task: CronTask,
  onFire: () => void,
): void {
  if (!task.enabled || !cron.validate(task.expression)) return
  // H-4 修复: 时区从 settings.general.timezone 读取,不再硬编码 'Asia/Shanghai'
  // 读取失败时回退到 'Asia/Shanghai'(保持向后兼容)
  let timezone = 'Asia/Shanghai'
  try {
    const tz = settingsService.getSettings().general?.timezone
    if (typeof tz === 'string' && tz.length > 0) timezone = tz
  } catch (err) {
    console.warn('[CronService] Failed to read timezone from settings, using default:', err)
  }
  const job = cron.schedule(task.expression, onFire, { timezone })
  state.scheduledJobs.set(id, job)
  // node-cron v4: 用 getNextRun() 取代 v3 的 'scheduled' 事件获取下次运行时间,
  // 并在每次执行结束后刷新(P1-8 nextRunAt 记录)
  const refreshNextRun = () => {
    const next = job.getNextRun()
    state.nextRunAt.set(id, (next ?? new Date(Date.now() + 60_000)).toISOString())
  }
  job.on('execution:finished', refreshNextRun)
  job.on('execution:failed', refreshNextRun)
  refreshNextRun()
}

/** 注销 cron 任务:destroy 彻底移除并清理监听器/定时器,同时清掉 nextRunAt */
export function unscheduleCronJob(state: SchedulerBindingState, id: string): void {
  const job = state.scheduledJobs.get(id)
  if (job) {
    // node-cron v4: destroy() 彻底移除任务并清理其全部监听器/定时器
    // (v3 时代需手动 removeAllListeners 防累积, v4 destroy 一站式处理)
    try {
      void job.destroy()
    } catch {}
  }
  state.scheduledJobs.delete(id)
  state.nextRunAt.delete(id)
}
