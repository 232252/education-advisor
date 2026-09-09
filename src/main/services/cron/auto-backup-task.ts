// =============================================================
// 自动备份 cron 任务 (M33) — 注册(幂等 upsert) + 执行 + __backup__ 分支
// 骨架(注册/移除/三态落账)见 ./system-task.ts
// =============================================================

import cron from 'node-cron'
import { errText } from '../../utils/err-text'
import { log } from '../../utils/logger'
import { runAutoBackupOnce } from '../backup-service'
import { settingsService } from '../settings-service'
import {
  recordSystemTaskOutcome,
  removeSystemTask,
  type SystemTaskExecutionCtx,
  type SystemTaskRegistrationCtx,
  systemTaskRegisterError,
  upsertSystemTask,
} from './system-task'

/** 自动备份系统任务 ID(非用户任务,不占 MAX_USER_TASKS 配额,不落盘 cron.user.json) */
export const AUTO_BACKUP_TASK_ID = 'auto-backup'
/** 备份任务占位 agentId,executeCronTask 据此路由到备份执行而非 agentRunner */
export const AUTO_BACKUP_AGENT_ID = '__backup__'
/** 默认备份计划: 每日 03:00 */
const DEFAULT_AUTO_BACKUP_CRON = '0 3 * * *'

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

/**
 * M33: 注册定时自动备份任务(根据 settings.backup.autoBackupEnabled / autoBackupCron)
 * 幂等 upsert — 启动时与 settings:set 联动均可安全重复调用:
 *   - disabled → 移除既有 auto-backup 任务(关闭开关任务消失)
 *   - enabled  → unschedule 旧 job 后按当前 autoBackupCron 重建(改表达式立即重绑)
 */
export function registerAutoBackupTask(ctx: SystemTaskRegistrationCtx): void {
  try {
    const s = settingsService.getSettings()
    if (!s.backup?.autoBackupEnabled) {
      removeSystemTask(ctx, AUTO_BACKUP_TASK_ID, 'autoBackup')
      return
    }
    const expr = resolveAutoBackupCronExpression(s.backup.autoBackupCron)
    upsertSystemTask(
      ctx,
      {
        id: AUTO_BACKUP_TASK_ID,
        name: '定时自动备份',
        agentId: AUTO_BACKUP_AGENT_ID,
        expression: expr,
        enabled: true,
        prompt: 'periodic auto backup',
        modelTier: 'low_cost',
      },
      'autoBackup',
    )
  } catch (err) {
    systemTaskRegisterError('autoBackup', err)
  }
}

/**
 * executeTask 内 __backup__ 分支:
 * 调 runAutoBackupOnce 生成 zip 到 backups/ 并按结果记录 lastStatus/日志;
 * 返回 null(已有备份在跑,autoRunning 锁)记 'skipped',不投喂熔断器。
 */
export async function runAutoBackupExecution(ctx: SystemTaskExecutionCtx): Promise<void> {
  try {
    const info = await runAutoBackupOnce()
    if (info) {
      recordSystemTaskOutcome(ctx, { status: 'success' }, `auto backup completed: ${info.fileName}`)
    } else {
      recordSystemTaskOutcome(ctx, { status: 'skipped', error: 'auto backup already running' })
    }
  } catch (err) {
    const errMsg = errText(err)
    recordSystemTaskOutcome(
      ctx,
      { status: 'error', error: errMsg },
      `auto backup failed: ${errMsg}`,
    )
  }
}
