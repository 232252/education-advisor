// =============================================================
// 飞书 Bitable 同步任务 — 注册(幂等 upsert) + 执行(30s 超时) + __feishu__ 分支
// 从 cron-service.ts 下沉,逻辑逐行对照搬迁(仅超时实现改用 withTimeout 同语义替换)
// =============================================================

import type { CronLogEntry, CronTask } from '@shared/types'
import { log } from '../../utils/logger'
import { withTimeout } from '../agent/timeout'
import { syncBitableNow } from '../feishu-service'
import { keystoreService } from '../keystore-service'
import { settingsService } from '../settings-service'
import { resolveBitableSyncExpression } from './schedule-validation'

/** executeBitableSync 的返回结构 */
export interface BitableSyncResult {
  success: boolean
  skipped?: string
  recordId?: string
  error?: string
}

/** registerBitableSyncTask 所需的宿主能力(由 CronService 注入,保持薄委托) */
export interface BitableSyncRegistrationCtx {
  /** 任务表(直接增删 feishu-bitable-sync 系统任务) */
  tasks: Map<string, CronTask>
  schedule(id: string, task: CronTask): void
  unschedule(id: string): void
  resetCircuitBreaker(taskId: string): void
}

/** T4: 注册 bitable 同步任务(根据 settings.feishu.bitableSync)
 *  F2 修复: 改为幂等 upsert — 启动时与 settings:set 联动均可安全重复调用:
 *    - disabled → 移除既有 __feishu__ 任务(此前关闭开关后任务照旧跑)
 *    - enabled  → unschedule 旧 job 后按当前 syncInterval 重建(改间隔立即生效) */
export function registerBitableSyncTask(ctx: BitableSyncRegistrationCtx): void {
  const taskId = 'feishu-bitable-sync'
  try {
    const s = settingsService.getSettings()
    if (!s.feishu?.bitableSync?.enabled) {
      // 关闭开关: 移除既有任务(幂等,不存在时无副作用)
      ctx.unschedule(taskId)
      ctx.tasks.delete(taskId)
      ctx.resetCircuitBreaker(taskId)
      log('info', 'cron', 'bitableSync disabled, removed existing task (if any)')
      return
    }
    const intervalRaw = s.feishu.bitableSync.syncInterval ?? '0 */6 * * *'
    // syncInterval 可能是 cron 表达式(包含空格)或分钟数;
    // 校验/回退/防激进逻辑见 ./schedule-validation.ts
    const expr = resolveBitableSyncExpression(intervalRaw)
    const task: CronTask = {
      id: taskId,
      name: '飞书 Bitable 同步',
      agentId: '__feishu__',
      expression: expr,
      enabled: true,
      prompt: 'periodic bitable sync heartbeat',
      modelTier: 'low_cost',
    }
    // upsert: 先 unschedule 旧 job,再覆盖任务并重建,避免重复调度
    ctx.unschedule(taskId)
    ctx.tasks.set(taskId, task)
    ctx.schedule(taskId, task)
    log('info', 'cron', `bitableSync registered, expr='${expr}' taskId=${taskId}`)
  } catch (err) {
    log(
      'warn',
      'cron',
      `bitableSync register failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** M-3 修复: 30 秒总超时,防止 getTenantToken + addBitableRecord 累计 hang */
const BITABLE_SYNC_TIMEOUT_MS = 30_000

/** T4: 执行一次 bitable 同步(graceful 降级) */
export async function executeBitableSyncOnce(): Promise<BitableSyncResult> {
  try {
    const s = settingsService.getSettings()
    if (!s.feishu?.bitableSync?.enabled) {
      return { success: false, skipped: 'bitableSync disabled' }
    }
    const appId = s.feishu.appId ?? ''
    // appSecret 从 keystore 加密存储读取
    const appSecret = keystoreService.getSecret('feishu-app-secret') ?? ''
    // 域名版本: 国内版 feishu / 国际版 lark
    const domain = s.feishu.domain ?? 'feishu'
    // C-1 修复: 从 settings 读取 bitableAppToken 和 bitableTableId,
    // 不再用 userOpenId 占位 + tableId 硬编码 'log'
    const appToken = s.feishu.bitableAppToken ?? ''
    const tableId = s.feishu.bitableTableId ?? 'log'
    if (!appToken) {
      return {
        success: false,
        error: 'feishu.bitableAppToken 未配置,请在设置页面填写 Bitable App Token',
      }
    }
    const fields = {
      timestamp: new Date().toISOString(),
      source: 'education-advisor',
      level: 'info',
      message: 'periodic bitable sync heartbeat',
    }
    // M-3 修复: withTimeout 30 秒总超时(与手写 Promise.race 同语义:
    // 超时 reject → 外层 catch 转 { success:false, error };正常返回透传)
    return await withTimeout(
      syncBitableNow(appId, appSecret, appToken, tableId, fields, domain),
      BITABLE_SYNC_TIMEOUT_MS,
      'bitable sync',
    )
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** runBitableSyncExecution 所需的宿主能力(executeTask 的 __feishu__ 分支下沉) */
export interface BitableSyncExecutionCtx {
  task: CronTask
  taskId: string
  timestamp: number
  startTime: number
  recordSuccess(taskId: string): void
  pushLog(entry: CronLogEntry): void
}

/** executeTask 内 __feishu__ 分支(Critical 2.2 修复: __feishu__ 路由到 bitable 同步而非 agentRunner):
 *  执行同步并按结果记录 lastStatus/日志;skipped 不投喂熔断器 */
export async function runBitableSyncExecution(ctx: BitableSyncExecutionCtx): Promise<void> {
  const { task, taskId, timestamp, startTime } = ctx
  const result = await executeBitableSyncOnce()
  if (result.skipped) {
    // F2 修复: 返回值含 skipped(如开关已关闭/配置未就绪)不算 error,
    // lastStatus 记 'skipped',不投喂熔断器
    log('info', 'cron', `bitable sync skipped: ${result.skipped}`)
    task.lastRunAt = timestamp
    task.lastStatus = 'skipped'
    ctx.pushLog({
      taskId,
      agentId: task.agentId,
      timestamp,
      durationMs: Date.now() - startTime,
      status: 'skipped',
      error: result.skipped,
    })
  } else if (!result.success) {
    // 同步失败按 error 记录,但不算 throw,避免污染日志
    log('warn', 'cron', `bitable sync failed: ${result.error ?? 'unknown'}`)
    task.lastRunAt = timestamp
    task.lastStatus = 'error'
    ctx.pushLog({
      taskId,
      agentId: task.agentId,
      timestamp,
      durationMs: Date.now() - startTime,
      status: 'error',
      error: result.error ?? 'bitable sync failed',
    })
  } else {
    task.lastRunAt = timestamp
    task.lastStatus = 'success'
    ctx.recordSuccess(taskId)
    ctx.pushLog({
      taskId,
      agentId: task.agentId,
      timestamp,
      durationMs: Date.now() - startTime,
      status: 'success',
    })
  }
}
