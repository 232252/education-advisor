// =============================================================
// 自动备份 cron 任务 (M33) — 注册(幂等 upsert) + 执行 + __backup__ 分支
// 结构照抄 ./bitable-sync.ts(registerBitableSyncTask/runBitableSyncExecution 联动模式)
// =============================================================

import type { CronLogEntry, CronTask } from '@shared/types'
import cron from 'node-cron'
import { log } from '../../utils/logger'
import { runAutoBackupOnce } from '../backup-service'
import { settingsService } from '../settings-service'

/** 自动备份系统任务 ID(非用户任务,不占 MAX_USER_TASKS 配额,不落盘 cron.user.json) */
export const AUTO_BACKUP_TASK_ID = 'auto-backup'
/** 备份任务占位 agentId,executeCronTask 据此路由到备份执行而非 agentRunner */
export const AUTO_BACKUP_AGENT_ID = '__backup__'
/** 默认备份计划: 每日 03:00 */
export const DEFAULT_AUTO_BACKUP_CRON = '0 3 * * *'

/**
 * 根据 settings.backup.autoBackupCron 解析出安全合法的 cron 表达式。
 * 非法表达式(如空串/段数不对/字段越界)回退到默认每日 03:00,
 * 防止坏配置在 node-cron.schedule 处抛错导致注册中断。
 */
export function resolveAutoBackupCronExpression(raw: string | undefined): string {
  const candidate = (raw ?? '').trim()
  if (candidate && cron.validate(candidate)) return candidate
  if (candidate) {
    log(
      'warn',
      'cron',
      `backup.autoBackupCron='${candidate}' 不是合法 cron 表达式,回退到默认 ${DEFAULT_AUTO_BACKUP_CRON}`,
    )
  }
  return DEFAULT_AUTO_BACKUP_CRON
}

/** registerAutoBackupTask 所需的宿主能力(由 CronService 注入,与 bitable-sync 同构) */
export interface AutoBackupRegistrationCtx {
  /** 任务表(直接增删 auto-backup 系统任务) */
  tasks: Map<string, CronTask>
  schedule(id: string, task: CronTask): void
  unschedule(id: string): void
  resetCircuitBreaker(taskId: string): void
}

/**
 * M33: 注册定时自动备份任务(根据 settings.backup.autoBackupEnabled / autoBackupCron)
 * 幂等 upsert — 启动时与 settings:set 联动均可安全重复调用:
 *   - disabled → 移除既有 auto-backup 任务(关闭开关任务消失)
 *   - enabled  → unschedule 旧 job 后按当前 autoBackupCron 重建(改表达式立即重绑)
 */
export function registerAutoBackupTask(ctx: AutoBackupRegistrationCtx): void {
  const taskId = AUTO_BACKUP_TASK_ID
  try {
    const s = settingsService.getSettings()
    if (!s.backup?.autoBackupEnabled) {
      // 关闭开关: 移除既有任务(幂等,不存在时无副作用)
      ctx.unschedule(taskId)
      ctx.tasks.delete(taskId)
      ctx.resetCircuitBreaker(taskId)
      log('info', 'cron', 'autoBackup disabled, removed existing task (if any)')
      return
    }
    const expr = resolveAutoBackupCronExpression(s.backup.autoBackupCron)
    const task: CronTask = {
      id: taskId,
      name: '定时自动备份',
      agentId: AUTO_BACKUP_AGENT_ID,
      expression: expr,
      enabled: true,
      prompt: 'periodic auto backup',
      modelTier: 'low_cost',
    }
    // upsert: 先 unschedule 旧 job,再覆盖任务并重建,避免重复调度
    ctx.unschedule(taskId)
    ctx.tasks.set(taskId, task)
    ctx.schedule(taskId, task)
    log('info', 'cron', `autoBackup registered, expr='${expr}' taskId=${taskId}`)
  } catch (err) {
    log(
      'warn',
      'cron',
      `autoBackup register failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** runAutoBackupExecution 所需的宿主能力(与 bitable-sync 同构) */
export interface AutoBackupExecutionCtx {
  task: CronTask
  taskId: string
  timestamp: number
  startTime: number
  recordSuccess(taskId: string): void
  pushLog(entry: CronLogEntry): void
}

/**
 * executeTask 内 __backup__ 分支(照抄 runBitableSyncExecution 模式):
 * 调 runAutoBackupOnce 生成 zip 到 backups/ 并按结果记录 lastStatus/日志;
 * 返回 null(已有备份在跑,autoRunning 锁)记 'skipped',不投喂熔断器。
 */
export async function runAutoBackupExecution(ctx: AutoBackupExecutionCtx): Promise<void> {
  const { task, taskId, timestamp, startTime } = ctx
  try {
    const info = await runAutoBackupOnce()
    task.lastRunAt = timestamp
    if (info) {
      task.lastStatus = 'success'
      ctx.recordSuccess(taskId)
      ctx.pushLog({
        taskId,
        agentId: task.agentId,
        timestamp,
        durationMs: Date.now() - startTime,
        status: 'success',
      })
      log('info', 'cron', `auto backup completed: ${info.fileName}`)
    } else {
      // runAutoBackupOnce 返回 null = 上一次备份尚未结束,本次跳过
      task.lastStatus = 'skipped'
      ctx.pushLog({
        taskId,
        agentId: task.agentId,
        timestamp,
        durationMs: Date.now() - startTime,
        status: 'skipped',
        error: 'auto backup already running',
      })
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    log('warn', 'cron', `auto backup failed: ${errMsg}`)
    task.lastRunAt = timestamp
    task.lastStatus = 'error'
    ctx.pushLog({
      taskId,
      agentId: task.agentId,
      timestamp,
      durationMs: Date.now() - startTime,
      status: 'error',
      error: errMsg,
    })
  }
}
