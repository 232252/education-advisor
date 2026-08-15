// =============================================================
// Cron 执行辅助 — 熔断状态机 + 日志持久化/缓冲节流 + 执行结果记录
// 从 cron-service.ts 抽出,逻辑零修改(逐行对照搬迁)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { AgentExecution, CronLogEntry, CronTask } from '@shared/types'
import { log } from '../../utils/logger'

/** circuit-breaker: 连续配额类错误达此阈值后,暂停该任务的 cron 触发 */
export const CIRCUIT_BREAKER_THRESHOLD = 3

/** 判断错误是否为配额类(持续会失败,值得熔断)。与 agent-service.ts isNonRetryableError 关键词对齐。 */
export function isQuotaError(msg: string): boolean {
  if (!msg) return false
  const lower = msg.toLowerCase()
  return (
    lower.includes('429') ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('quota') ||
    lower.includes('用量上限') ||
    lower.includes('配额')
  )
}

/** circuit-breaker 状态机: per-task 连续失败计数 + 熔断状态
 *  修复 Agent 调度配额耗尽后空转 —— 配额(429/quota)耗尽时,后续 cron 触发持续失败空转。
 *  达阈值后跳过 cron 触发;runNow 手动触发绕过熔断(成功则重置)。
 *  纯内存,不持久化(重启给配额恢复一次重新尝试的机会)。 */
export class CircuitBreakerRegistry {
  private states: Map<string, { consecutiveFails: number; tripped: boolean }> = new Map()

  /** 记录任务失败:仅配额类错误累加计数,达阈值则熔断 */
  recordFailure(taskId: string, errMsg: string): void {
    if (!isQuotaError(errMsg)) return
    const state = this.states.get(taskId) ?? { consecutiveFails: 0, tripped: false }
    state.consecutiveFails += 1
    if (state.consecutiveFails >= CIRCUIT_BREAKER_THRESHOLD && !state.tripped) {
      state.tripped = true
      log(
        'warn',
        'cron',
        `Task ${taskId} circuit breaker TRIPPED after ${state.consecutiveFails} consecutive quota errors; subsequent cron triggers will be skipped until a manual run succeeds or the task is toggled`,
      )
    }
    this.states.set(taskId, state)
  }

  /** 记录任务成功:清零失败计数,解除熔断 */
  recordSuccess(taskId: string): void {
    const state = this.states.get(taskId)
    if (!state) return
    if (state.tripped || state.consecutiveFails > 0) {
      log('info', 'cron', `Task ${taskId} circuit breaker reset (successful execution)`)
    }
    this.states.delete(taskId)
  }

  /** 查询任务是否已熔断 */
  isTripped(taskId: string): boolean {
    return this.states.get(taskId)?.tripped === true
  }

  /** 重置任务熔断状态(供 toggleTask 关再开时调用,给用户手动恢复手段) */
  reset(taskId: string): void {
    this.states.delete(taskId)
  }
}

/**
 * 读取持久化日志文件(仅加载最近 1000 条)。
 * 文件不存在或读取失败时返回 null,调用方保持现有内存日志不变。
 */
export async function readCronLogFile(filePath: string): Promise<CronLogEntry[] | null> {
  try {
    await fsp.access(filePath, fs.constants.F_OK)
  } catch {
    return null
  }
  try {
    const content = await fsp.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter((l) => l.trim().length > 0)
    // 仅加载最近 1000 条
    const recent = lines.slice(-1000)
    const entries: CronLogEntry[] = []
    for (const line of recent) {
      try {
        const entry = JSON.parse(line) as CronLogEntry
        if (entry && typeof entry.taskId === 'string') {
          entries.push(entry)
        }
      } catch {
        // 忽略单行解析错误
      }
    }
    return entries
  } catch (err) {
    console.warn('[CronService] Failed to load persisted logs:', err)
    return null
  }
}

/**
 * 追加写入日志并按需轮转(文件超过 5MB 时截断为最近 1000 条,轮转失败不影响主流程)。
 * 写入失败时抛错,由调用方负责把日志恢复到 buffer 前部(避免数据丢失)。
 */
export async function appendCronLogLines(filePath: string, toWrite: CronLogEntry[]): Promise<void> {
  const lines = `${toWrite.map((e) => JSON.stringify(e)).join('\n')}\n`
  await fsp.appendFile(filePath, lines, 'utf-8')
  // 日志轮转: 文件超过 5MB 时截断为最近 1000 条
  try {
    const stat = await fsp.stat(filePath)
    if (stat.size > 5 * 1024 * 1024) {
      const content = await fsp.readFile(filePath, 'utf-8')
      const allLines = content.split('\n').filter((l) => l.trim().length > 0)
      const recent = allLines.slice(-1000)
      await fsp.writeFile(filePath, `${recent.join('\n')}\n`, 'utf-8')
      log('info', 'cron', `log file rotated: ${allLines.length} -> ${recent.length} entries`)
    }
  } catch {
    // 轮转失败不影响主流程
  }
}

// -------------------------------------------------------------
// 日志缓冲节流(P1-9: 异步持久化到磁盘 + 内存上限 + 失败回灌)
// 从 cron-service.ts 的 pushLog/scheduleLogWrite/flushLogs 下沉,
// 状态字段本体留在 CronService 实例上(经 state 引用读写同一份字段)
// -------------------------------------------------------------

/** 内存日志上限(条) */
const MAX_MEMORY_LOGS = 1000
/** 失败回灌后的待写缓冲上限(条),防磁盘满等持续失败场景无限增长 */
const MAX_RETRY_LOG_BUFFER = 500
/** 日志写盘节流间隔(ms):500ms 内合并 */
const LOG_WRITE_THROTTLE_MS = 500

/** 日志缓冲节流状态(由 CronService 实例以 getter/setter 适配器提供同一份字段) */
export interface CronLogBufferState {
  /** 内存日志(上限 1000 条) */
  logs: CronLogEntry[]
  /** 待写入磁盘的日志缓冲 */
  logBuffer: CronLogEntry[]
  /** 日志写入节流定时器 */
  logWriteTimer: NodeJS.Timeout | null
  /** 持久化日志文件路径 */
  logFilePath: string
}

/** 追加一条日志:内存上限裁剪 + 进入待写缓冲并节流调度写盘(P1-9) */
export function pushLogEntry(state: CronLogBufferState, entry: CronLogEntry): void {
  state.logs.push(entry)
  if (state.logs.length > MAX_MEMORY_LOGS) {
    state.logs = state.logs.slice(-MAX_MEMORY_LOGS)
  }
  // 异步持久化到磁盘(P1-9): 节流写,500ms 内合并(原 scheduleLogWrite)
  state.logBuffer.push(entry)
  if (state.logWriteTimer) return
  state.logWriteTimer = setTimeout(() => {
    state.logWriteTimer = null
    void flushLogBuffer(state)
  }, LOG_WRITE_THROTTLE_MS)
}

/** 立即 flush 缓冲日志(graceful shutdown)
 *  修复: 写入失败时恢复日志到 buffer 前部,避免日志数据丢失 */
export async function flushLogBuffer(state: CronLogBufferState): Promise<void> {
  if (state.logBuffer.length === 0) return
  const toWrite = state.logBuffer
  state.logBuffer = []
  try {
    await appendCronLogLines(state.logFilePath, toWrite)
  } catch (err) {
    console.error('[CronService] Failed to persist logs:', err)
    // 写入失败时恢复日志到 buffer 前部,下次 flush 会重试
    // 限制 buffer 上限防止无限增长(磁盘满等持续失败场景)
    state.logBuffer.unshift(...toWrite)
    if (state.logBuffer.length > MAX_RETRY_LOG_BUFFER) {
      state.logBuffer = state.logBuffer.slice(-MAX_RETRY_LOG_BUFFER)
    }
  }
}

// -------------------------------------------------------------
// executeTask 结果记录辅助(熔断跳过 / agent 执行结果)
// -------------------------------------------------------------

/** 熔断跳过时置任务状态并产出日志条目(executeTask 的 cron 触发被熔断拦截时) */
export function applyCircuitBreakerSkip(
  task: CronTask,
  taskId: string,
  timestamp: number,
): CronLogEntry {
  task.lastRunAt = timestamp
  task.lastStatus = 'skipped_circuit_breaker'
  return {
    taskId,
    agentId: task.agentId,
    timestamp,
    durationMs: 0,
    status: 'skipped_circuit_breaker',
    error: '配额类错误连续失败,熔断保护已触发',
  }
}

/** 执行抛错时置任务状态并产出日志条目(熔断投喂由调用方处理) */
export function applyTaskError(
  task: CronTask,
  taskId: string,
  timestamp: number,
  startTime: number,
  errMsg: string,
): CronLogEntry {
  task.lastRunAt = timestamp
  task.lastStatus = 'error'
  return {
    taskId,
    agentId: task.agentId,
    timestamp,
    durationMs: Date.now() - startTime,
    status: 'error',
    error: errMsg,
  }
}

/** recordAgentRunOutcome 所需的宿主能力(由 CronService 注入) */
export interface AgentOutcomeCtx {
  task: CronTask
  taskId: string
  timestamp: number
  startTime: number
  /** R169 修复: runAgent 内部吞错(经状态事件上报),依据返回的 AgentExecution.status 记日志;
   *  undefined = 排队期间被 abort 放弃执行,记 error */
  execution: AgentExecution | undefined
  circuitBreaker: CircuitBreakerRegistry
  pushLog(entry: CronLogEntry): void
}

/** 记录一次 agent 执行结果:成功/失败置 lastStatus,error 时投喂熔断器(429/quota) */
export function recordAgentRunOutcome(ctx: AgentOutcomeCtx): void {
  const { task, taskId, timestamp, startTime, execution } = ctx
  task.lastRunAt = timestamp
  if (execution && execution.status === 'success') {
    task.lastStatus = 'success'
    // circuit-breaker: 成功执行重置失败计数(含 runNow 手动成功恢复熔断)
    ctx.circuitBreaker.recordSuccess(taskId)

    ctx.pushLog({
      taskId,
      agentId: task.agentId,
      timestamp,
      durationMs: Date.now() - startTime,
      status: 'success',
    })
  } else {
    // R170: errMsg 截断 — 失败时 execution.output 可能含上千字部分输出,全量进内存日志+JSONL 会膨胀
    const rawErr = execution
      ? execution.output || `agent 执行失败(status=${execution.status})`
      : '执行被中止(排队期间 abort)'
    const errMsg = rawErr.length > 500 ? `${rawErr.slice(0, 500)}…` : rawErr
    task.lastStatus = 'error'
    ctx.circuitBreaker.recordFailure(taskId, errMsg)

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
