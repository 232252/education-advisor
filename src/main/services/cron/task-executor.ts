// =============================================================
// Cron 任务执行流程 — 熔断检查/per-task 锁/__feishu__ 路由/结果记录
// 从 cron-service.ts executeTask 下沉,逻辑零修改(逐行对照搬迁)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { AgentExecution, CronLogEntry, CronTask } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { log } from '../../utils/logger'
import { FEISHU_PUSH_AGENT_IDS, sendAgentAlert } from '../feishu/alerts'
import { settingsService } from '../settings-service'
import { runAutoBackupExecution } from './auto-backup-task'
import { runBitableSyncExecution } from './bitable-sync'
import {
  applyCircuitBreakerSkip,
  applyTaskError,
  CIRCUIT_BREAKER_THRESHOLD,
  type CircuitBreakerRegistry,
  recordAgentRunOutcome,
} from './execution'

/** agent 执行函数签名(由 agent-service 注入,延迟绑定避免循环依赖) */
export type AgentRunnerFn = (
  agentId: string,
  prompt: string,
  win: BrowserWindow,
) => Promise<AgentExecution | undefined>

/** executeCronTask 所需的宿主能力(由 CronService 注入,保持薄委托) */
export interface TaskExecutionCtx {
  /** 任务表 */
  tasks: Map<string, CronTask>
  /** 主窗口(状态广播 + agent 执行状态推送) */
  mainWindow: BrowserWindow | null
  /** circuit-breaker 状态机 */
  circuitBreaker: CircuitBreakerRegistry
  /** H-2.3: per-task 执行锁,防止 runNow 与 cron 定时同时触发同一任务造成竞态 */
  runningTasks: Set<string>
  /** 延迟注入的 agent 执行函数 */
  agentRunner: AgentRunnerFn | null
  pushLog(entry: CronLogEntry): void
  broadcastStatus(taskId: string, task: CronTask): void
}

// =============================================================
// R2-03 接线: general.maxConcurrentCronTasks(此前仅 UI 可配,后端不消费)
// 简易计数信号量 — 同刻多条 cron 触发时,超过上限的任务在队列中等待,
// 避免并发压 LLM API(2026-08 上游 429 配额错误的实证诱因之一)。
// 只闸 agent 类任务;__feishu__/__backup__ 为本地/低成本操作不设限。
// =============================================================
let activeAgentRuns = 0
const runSlotWaiters: Array<() => void> = []

async function acquireAgentRunSlot(): Promise<void> {
  const configured = settingsService.getSettings().general?.maxConcurrentCronTasks
  const max = Math.max(1, Number.isFinite(configured) ? (configured as number) : 5)
  if (activeAgentRuns >= max) {
    log('info', 'cron', `agent run queued (${activeAgentRuns}/${max} concurrent slots busy)`)
    await new Promise<void>((resolve) => runSlotWaiters.push(resolve))
  }
  activeAgentRuns++
}

function releaseAgentRunSlot(): void {
  activeAgentRuns = Math.max(0, activeAgentRuns - 1)
  const next = runSlotWaiters.shift()
  if (next) next()
}

/**
 * 执行任务 — Critical 2.2 修复: __feishu__ 路由到 executeBitableSync 而非 agentRunner
 * High 2.3 修复: per-task 锁防止 runNow + cron 定时并发执行同一任务
 * circuit-breaker: source='cron' 受熔断约束(连续配额错误后跳过);source='manual' 绕过熔断
 */
export async function executeCronTask(
  ctx: TaskExecutionCtx,
  taskId: string,
  source: 'cron' | 'manual' = 'cron',
): Promise<void> {
  const task = ctx.tasks.get(taskId)
  if (!task) return
  if (!ctx.mainWindow) return

  // circuit-breaker: cron 触发时若已熔断,跳过执行(避免配额耗尽后持续空转)
  // runNow(manual) 绕过此检查 —— 用户主动操作应执行,成功则顺带重置熔断
  if (source === 'cron' && ctx.circuitBreaker.isTripped(taskId)) {
    log(
      'warn',
      'cron',
      `Task ${taskId} skipped (circuit breaker tripped after ${CIRCUIT_BREAKER_THRESHOLD} consecutive quota errors); run manually or toggle off/on to reset`,
    )
    ctx.pushLog(applyCircuitBreakerSkip(task, taskId, Date.now()))
    // M7 修复: send 前判 isDestroyed,窗口销毁后此分支在 try 之外,异常会逃逸到 node-cron 回调
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send(IPC.IPC_CRON_STATUS_UPDATE, {
        taskId,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
      })
    }
    return
  }

  // High 2.3 修复: per-task 锁,避免 runNow + cron 同时触发同一任务
  if (ctx.runningTasks.has(taskId)) {
    log('info', 'cron', `Task ${taskId} already running, skip this trigger`)
    return
  }
  ctx.runningTasks.add(taskId)

  const timestamp = Date.now()
  const startTime = Date.now()

  try {
    // Critical 2.2 修复: __feishu__ 任务路由到 executeBitableSync(分支逻辑见 ./bitable-sync.ts)
    // 之前所有任务都调 agentRunner(task.agentId, ...),但 __feishu__ 不是真实 agentId,
    // agentRunner('__feishu__', ...) 必然抛 "Agent not found",真正的 executeBitableSync 从未被调用
    if (task.agentId === '__feishu__') {
      await runBitableSyncExecution({
        task,
        taskId,
        timestamp,
        startTime,
        recordSuccess: (id) => ctx.circuitBreaker.recordSuccess(id),
        pushLog: (entry) => ctx.pushLog(entry),
      })
    } else if (task.agentId === '__backup__') {
      // M33: __backup__ 任务路由到自动备份执行(分支逻辑见 ./auto-backup-task.ts)
      await runAutoBackupExecution({
        task,
        taskId,
        timestamp,
        startTime,
        recordSuccess: (id) => ctx.circuitBreaker.recordSuccess(id),
        pushLog: (entry) => ctx.pushLog(entry),
      })
    } else if (ctx.agentRunner) {
      // R2-03: 并发闸门 — 超过 maxConcurrentCronTasks 的任务在此排队
      await acquireAgentRunSlot()
      try {
        const execution = await ctx.agentRunner(task.agentId, task.prompt, ctx.mainWindow)
        recordAgentRunOutcome({
          task,
          taskId,
          timestamp,
          startTime,
          execution,
          circuitBreaker: ctx.circuitBreaker,
          pushLog: (entry) => ctx.pushLog(entry),
        })
        // 定时报告类任务(周报/风险预警等)产出后推送飞书 — 此前生成物只落
        // DB 与 GUI,教师不开应用就看不到;推送开关默认关闭(settings.feishu.agentPushEnabled)
        if (
          execution?.status === 'success' &&
          execution.output &&
          FEISHU_PUSH_AGENT_IDS.includes(task.agentId)
        ) {
          const s = settingsService.getSettings()
          if (s.feishu?.agentPushEnabled) {
            void sendAgentAlert(`${task.name} 完成`, execution.output).then((r) => {
              if (r.skipped) {
                log('info', 'cron', `agent push skipped (${task.agentId}): ${r.skipped}`)
              } else if (!r.success) {
                log('warn', 'cron', `agent push failed (${task.agentId}): ${r.error}`)
              } else {
                log('info', 'cron', `agent push sent (${task.agentId})`)
              }
            })
          }
        }
      } finally {
        releaseAgentRunSlot()
      }
    } else {
      console.warn(`[CronService] Agent runner not set, skipping task ${taskId}`)
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    // circuit-breaker: 仅配额类错误(429/quota/rate_limit)累计,普通错误(网络抖动等)不熔断
    ctx.circuitBreaker.recordFailure(taskId, errMsg)
    ctx.pushLog(applyTaskError(task, taskId, timestamp, startTime, errMsg))
  } finally {
    // High 2.3: 释放 per-task 锁
    ctx.runningTasks.delete(taskId)
    // 不管成功失败都发送状态更新（P1-10：被中止的 agent 也算完成了）
    ctx.broadcastStatus(taskId, task)
  }
}
