// =============================================================
// Cron 调度绑定 — node-cron 任务的注册/注销 + nextRunAt 刷新 + 错过调度补偿(M35)
// 从 cron-service.ts 的 schedule/unschedule 下沉,逻辑逐行对照搬迁
// =============================================================

import type { CronLogEntry, CronTask } from '@shared/types'
import cron, { type ScheduledTask } from 'node-cron'
import { log } from '../../utils/logger'
import { settingsService } from '../settings-service'

/** 调度绑定状态(宿主 CronService 持有对应 Map 并以引用传入,模块仅做 set/delete) */
export interface SchedulerBindingState {
  scheduledJobs: Map<string, ScheduledTask>
  /** 下次执行时间 ISO 字符串 */
  nextRunAt: Map<string, string>
  /** M35: per-task 执行锁(与 CronService.runningTasks 同一引用;同批多个 missed
   *  槽位事件相邻触发时,补跑仍在执行则不重复补跑) */
  runningTasks: Set<string>
  /** M35: 记录 skipped_missed 日志条目(与 CronService.pushLog 同一入口) */
  pushLog(entry: CronLogEntry): void
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
  // M35: 错过调度补偿 — 系统睡眠/事件循环阻塞导致某应跑槽位整体错过时,
  // node-cron v4 只发 execution:missed 而不会执行该槽位(教师合盖过夜的
  // bitable 同步整夜丢失即此场景)。判定+补跑见 compensateMissedExecution
  job.on('execution:missed', (context) => {
    compensateMissedExecution(state, id, task, onFire, context.date)
  })
  refreshNextRun()
}

/**
 * M35: 错过调度补偿(轻量韧性项)
 * node-cron 判定 missedSlot(表达式推导的应跑槽位)被整体错过时,对比 task.lastRunAt:
 *   - lastRunAt 落后于该槽位(该周期内没有任何执行覆盖它,含从未执行过)⇒ 落后 ≥1 周期
 *     → 记一条 skipped_missed 日志并立即补跑一次。
 *     保守"补一次"而非追帧:系统睡眠多天醒来也只补一帧,避免补跑风暴。
 *   - lastRunAt ≥ 槽位时间(runNow 手动跑过/首个补跑已完成并刷新 lastRunAt)→ 不补。
 *   - 首个补跑仍在执行(runningTasks 持锁,同一批多个 missed 槽位事件同步相邻触发)
 *     → 不重复补。
 * 补跑走 onFire 原路径:受熔断器/per-task 锁/mainWindow 前置检查约束。
 */
export function compensateMissedExecution(
  state: SchedulerBindingState,
  id: string,
  task: CronTask,
  onFire: () => void,
  missedSlot: Date,
): void {
  // 任务刚被禁用(unschedule 与 missed 事件到达之间的窗口)→ 不补
  if (!task.enabled) return
  const slotMs = missedSlot.getTime()
  // 该槽位已被覆盖(手动 runNow 或先前补跑已执行过)→ 不补
  if (task.lastRunAt !== undefined && task.lastRunAt >= slotMs) return
  // 同一批 missed 槽位的首个补跑仍在执行 → 保守只补一次
  if (state.runningTasks.has(id)) return

  state.pushLog({
    taskId: id,
    agentId: task.agentId,
    timestamp: Date.now(),
    durationMs: 0,
    status: 'skipped_missed',
    error: `错过计划调度 ${missedSlot.toISOString()}(系统睡眠或事件循环阻塞),已立即补跑一次`,
  })
  log(
    'warn',
    'cron',
    `Task ${id} missed scheduled execution at ${missedSlot.toISOString()}; compensating with a single catch-up run`,
  )
  onFire()
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
