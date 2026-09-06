// =============================================================
// cron 系统任务骨架 — 注册(幂等 upsert)/移除/执行三态落账
// auto-backup-task 与 bitable-sync 的共同结构单一来源
// (此前两份 27 行注册流程 + 42 行执行管线逐字互抄)
// =============================================================

import type { CronLogEntry, CronTask } from '@shared/types'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'

/** 系统任务注册所需宿主能力(由 CronService 注入) */
export interface SystemTaskRegistrationCtx {
  /** 任务表(直接增删系统任务) */
  tasks: Map<string, CronTask>
  schedule(id: string, task: CronTask): void
  unschedule(id: string): void
  resetCircuitBreaker(taskId: string): void
}

/** 系统任务执行所需宿主能力 */
export interface SystemTaskExecutionCtx {
  task: CronTask
  taskId: string
  timestamp: number
  startTime: number
  recordSuccess(taskId: string): void
  pushLog(entry: CronLogEntry): void
}

/** 幂等 upsert:先 unschedule 旧 job,再覆盖任务并重建,避免重复调度 */
export function upsertSystemTask(
  ctx: SystemTaskRegistrationCtx,
  task: CronTask,
  label: string,
): void {
  ctx.unschedule(task.id)
  ctx.tasks.set(task.id, task)
  ctx.schedule(task.id, task)
  log('info', 'cron', `${label} registered, expr='${task.expression}' taskId=${task.id}`)
}

/** 移除系统任务(幂等,不存在时无副作用);关闭开关时调用 */
export function removeSystemTask(
  ctx: SystemTaskRegistrationCtx,
  taskId: string,
  label: string,
): void {
  ctx.unschedule(taskId)
  ctx.tasks.delete(taskId)
  ctx.resetCircuitBreaker(taskId)
  log('info', 'cron', `${label} disabled, removed existing task (if any)`)
}

/** 注册期兜底:坏配置等异常只记 warn,不中断其余任务注册 */
export function systemTaskRegisterError(label: string, err: unknown): void {
  log('warn', 'cron', `${label} register failed: ${errText(err)}`)
}

/**
 * 执行结果三态落账:统一 lastRunAt/lastStatus/日志字段与写入顺序。
 * success 才投喂 recordSuccess(熔断恢复);skipped/error 不投喂。
 */
export function recordSystemTaskOutcome(
  ctx: SystemTaskExecutionCtx,
  outcome: { status: 'success' | 'skipped' | 'error'; error?: string },
  logLine?: string,
): void {
  const { task, taskId, timestamp, startTime } = ctx
  task.lastRunAt = timestamp
  task.lastStatus = outcome.status
  if (outcome.status === 'success') ctx.recordSuccess(taskId)
  ctx.pushLog({
    taskId,
    agentId: task.agentId,
    timestamp,
    durationMs: Date.now() - startTime,
    status: outcome.status,
    ...(outcome.error !== undefined ? { error: outcome.error } : {}),
  })
  if (logLine !== undefined) {
    log(outcome.status === 'error' ? 'warn' : 'info', 'cron', logLine)
  }
}
