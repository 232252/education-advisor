// =============================================================
// Cron Service — 定时任务调度器
// 通过 node-cron 驱动 Agent 定时执行
// 修复：
//   P1-8: 记录 nextRunAt（监听 node-cron 'scheduled' 事件 + 初始估算）
//   P1-9: 日志改为异步持久化到磁盘（同时保留内存 1000 条上限）
//   P1-10: 取消的 agent 在 finally 块清理
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, type BrowserWindow } from 'electron'
import cron, { type ScheduledTask } from 'node-cron'
import * as IPC from '../../shared/ipc-channels'
import type { AgentExecution, CronLogEntry, CronTask } from '../../shared/types'
import { log } from '../utils/logger'
import { syncBitableNow } from './feishu-service'
import { keystoreService } from './keystore-service'
import { settingsService } from './settings-service'

/**
 * 判断 5 字段 cron 表达式是否"过于激进"(触发间隔 < minMinutes 分钟)。
 * 用于防止 bitable 同步等系统任务被配置成每秒/每分钟执行,导致 LLM/API 成本失控。
 *
 * 策略: 解析分钟字段,若为星号(每分钟)或"星号斜杠 N"步进(N < minMinutes)则判定为激进。
 * 仅做保守下限判断,不覆盖所有边界情况——足够拦截最常见的危险配置。
 */
export function isTooAggressiveCron(expr: string, minMinutes = 5): boolean {
  const fields = expr.trim().split(/\s+/)
  if (fields.length < 5) return false
  const minuteField = fields[0]
  // `*` = 每分钟
  if (minuteField === '*') return true
  // `*/N` = 每 N 分钟
  const stepMatch = minuteField.match(/^\*\/(\d+)$/)
  if (stepMatch) {
    const step = Number(stepMatch[1])
    return Number.isFinite(step) && step < minMinutes
  }
  return false
}

class CronService {
  private static readonly MAX_USER_TASKS = 100
  /** circuit-breaker: 连续配额类错误达此阈值后,暂停该任务的 cron 触发 */
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3

  private tasks: Map<string, CronTask> = new Map()
  private scheduledJobs: Map<string, ScheduledTask> = new Map()
  /** 下次执行时间 ISO 字符串 */
  private nextRunAt: Map<string, string> = new Map()
  private logs: CronLogEntry[] = []
  /** 持久化日志路径（追加写入避免频繁重写） */
  private logFilePath: string
  /** 用户任务持久化路径（R87 BUG-1 修复：补齐 cron.user.json 持久化） */
  private userTasksFilePath: string
  /** 日志写入节流 */
  private logWriteTimer: NodeJS.Timeout | null = null
  /** 待写入的日志缓冲 */
  private logBuffer: CronLogEntry[] = []
  /** 用户任务写入节流（避免 addTask 高频调用时每次都落盘） */
  private userTasksWriteTimer: NodeJS.Timeout | null = null
  private mainWindow: BrowserWindow | null = null
  /** H-2.3 修复: per-task 执行锁,防止 runNow 与 cron 定时同时触发同一任务造成竞态 */
  private runningTasks: Set<string> = new Set()
  /** circuit-breaker: per-task 连续失败计数 + 熔断状态
   *  修复 Agent 调度配额耗尽后空转 —— 配额(429/quota)耗尽时,后续 cron 触发持续失败空转。
   *  达阈值后跳过 cron 触发;runNow 手动触发绕过熔断(成功则重置)。
   *  纯内存,不持久化(重启给配额恢复一次重新尝试的机会)。 */
  private circuitBreaker: Map<string, { consecutiveFails: number; tripped: boolean }> = new Map()

  /** 延迟注入，避免循环依赖 */
  private agentRunner:
    | ((agentId: string, prompt: string, win: BrowserWindow) => Promise<AgentExecution | undefined>)
    | null = null

  constructor() {
    this.logFilePath = path.join(app.getPath('userData'), 'cron-logs.jsonl')
    this.userTasksFilePath = path.join(app.getPath('userData'), 'cron.user.json')
  }

  /** 判断是否为用户任务（非系统任务）。系统任务包括 agent-schedule-* 和 feishu-bitable-sync */
  private isUserTask(id: string): boolean {
    return !id.startsWith('agent-schedule-') && id !== 'feishu-bitable-sync'
  }

  /**
   * R87 BUG-1 修复：启动时从 cron.user.json 恢复用户任务
   * 仅恢复用户创建的任务（系统任务由 registerBitableSync / syncAgentSchedules 重建）
   */
  async loadUserTasks(): Promise<void> {
    try {
      await fsp.access(this.userTasksFilePath, fs.constants.F_OK)
    } catch {
      // 文件不存在（首次启动或旧版本），无需恢复
      return
    }
    try {
      const content = await fsp.readFile(this.userTasksFilePath, 'utf-8')
      const parsed = JSON.parse(content) as { tasks?: CronTask[] }
      if (!parsed || !Array.isArray(parsed.tasks)) {
        log('warn', 'cron', 'cron.user.json 格式错误，跳过恢复')
        return
      }
      let restored = 0
      for (const task of parsed.tasks) {
        if (!task || typeof task.id !== 'string' || !this.isUserTask(task.id)) continue
        // 不直接复用旧 id，避免与当前会话冲突；用 addTask 重新生成 id
        // 但保留 expression/name/agentId/prompt/enabled/modelTier 等业务字段
        try {
          const newId = this.addTask({
            name: task.name,
            agentId: task.agentId,
            expression: task.expression,
            prompt: task.prompt,
            enabled: task.enabled ?? true,
            modelTier: task.modelTier,
          })
          // 恢复 lastRunAt/lastStatus（如果存在）
          if (task.lastRunAt || task.lastStatus) {
            const t = this.tasks.get(newId)
            if (t) {
              if (task.lastRunAt) t.lastRunAt = task.lastRunAt
              if (task.lastStatus) t.lastStatus = task.lastStatus
            }
          }
          restored++
        } catch (err) {
          log('warn', 'cron', `恢复任务 "${task.name}" 失败: ${err}`)
        }
      }
      log('info', 'cron', `cron.user.json 恢复了 ${restored} 个用户任务`)
    } catch (err) {
      console.warn('[CronService] Failed to load persisted user tasks:', err)
    }
  }

  /**
   * R87 BUG-1 修复：将用户任务持久化到 cron.user.json
   * 使用节流避免高频写盘；shutdown 时立即 flush
   */
  private persistUserTasksDebounced(): void {
    if (this.userTasksWriteTimer) return
    this.userTasksWriteTimer = setTimeout(() => {
      this.userTasksWriteTimer = null
      void this.persistUserTasksNow()
    }, 500)
  }

  /** 立即落盘（graceful shutdown 调用） */
  async persistUserTasksNow(): Promise<void> {
    const userTasks: CronTask[] = []
    for (const [id, task] of this.tasks) {
      if (this.isUserTask(id)) userTasks.push(task)
    }
    try {
      const json = JSON.stringify({ tasks: userTasks, savedAt: Date.now() }, null, 2)
      // 原子写：tmp + rename（与 profile-service 一致策略）
      const tmpPath = `${this.userTasksFilePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      // A6 修复: fd 写入 + fsync 确保任务落盘后再 rename (与 settings/keystore 一致)
      const fd = await fsp.open(tmpPath, 'w')
      try {
        await fd.writeFile(json, 'utf-8')
        await fd.sync()
      } finally {
        await fd.close()
      }
      await fsp.rename(tmpPath, this.userTasksFilePath)
    } catch (err) {
      console.error('[CronService] Failed to persist user tasks:', err)
    }
  }

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
  }

  /** 注入 agent 执行函数（由 agent-service 在初始化时调用） */
  setAgentRunner(
    fn: (
      agentId: string,
      prompt: string,
      win: BrowserWindow,
    ) => Promise<AgentExecution | undefined>,
  ) {
    this.agentRunner = fn
  }

  /** 列出所有任务 */
  listTasks(): CronTask[] {
    return Array.from(this.tasks.values())
  }

  /** 获取任务下次执行时间（P1-8） */
  getNextRunAt(taskId: string): string | undefined {
    return this.nextRunAt.get(taskId)
  }

  /** 添加任务 */
  addTask(task: Omit<CronTask, 'id'>): string {
    // 仅统计用户任务(排除 agent-schedule-* 和 feishu-bitable-sync 等系统任务)
    let userTaskCount = 0
    for (const id of this.tasks.keys()) {
      if (!id.startsWith('agent-schedule-') && id !== 'feishu-bitable-sync') {
        userTaskCount++
      }
    }
    if (userTaskCount >= CronService.MAX_USER_TASKS) {
      throw new Error(`Task limit reached (max ${CronService.MAX_USER_TASKS} user tasks)`)
    }
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const fullTask: CronTask = { ...task, id }
    this.tasks.set(id, fullTask)
    this.schedule(id, fullTask)
    // R87 BUG-1 修复：用户任务落盘
    this.persistUserTasksDebounced()
    return id
  }

  /** 更新任务 */
  updateTask(id: string, patch: Partial<CronTask>) {
    const task = this.tasks.get(id)
    if (!task) return { success: false, error: 'Task not found' }

    this.unschedule(id)
    Object.assign(task, patch)
    this.schedule(id, task)

    // R87 BUG-1 修复：用户任务更新后落盘
    if (this.isUserTask(id)) this.persistUserTasksDebounced()
    return { success: true }
  }

  /** 删除任务 */
  removeTask(id: string) {
    // R169 修复: removeTask 对不存在的任务返回 success:true,与 toggleTask 行为不一致
    // 此前 removeTask('non-existent') 返回 {success:true},导致前端误以为删除成功
    if (!this.tasks.has(id)) {
      return { success: false, error: 'Task not found' }
    }
    this.unschedule(id)
    this.tasks.delete(id)
    this.nextRunAt.delete(id)
    this.resetCircuitBreaker(id)
    // R87 BUG-1 修复：用户任务删除后落盘
    if (this.isUserTask(id)) this.persistUserTasksDebounced()
    return { success: true }
  }

  /** 启用/禁用任务 */
  toggleTask(id: string, enabled: boolean) {
    const task = this.tasks.get(id)
    if (!task) return { success: false, error: 'Task not found' }

    task.enabled = enabled

    if (enabled) {
      this.schedule(id, task)
      // circuit-breaker: 重新启用任务时重置熔断,给用户"关掉再开"的恢复手段
      this.resetCircuitBreaker(id)
    } else {
      this.unschedule(id)
    }

    // R87 BUG-1 修复：用户任务状态变更后落盘
    if (this.isUserTask(id)) this.persistUserTasksDebounced()
    return { success: true }
  }

  /** 立即执行任务（手动触发，绕过熔断；成功则重置熔断状态） */
  async runNow(id: string) {
    await this.executeTask(id, 'manual')
  }

  /**
   * 模拟 cron 定时触发执行（供测试与外部调度器使用）。
   * 与 cron 回调走同一路径，受熔断器约束。
   */
  async triggerScheduled(id: string) {
    await this.executeTask(id, 'cron')
  }

  /** 获取执行日志 */
  getLogs(taskId?: string): CronLogEntry[] {
    if (taskId) {
      return this.logs.filter((l) => l.taskId === taskId)
    }
    return [...this.logs]
  }

  /** T4: 注册 bitable 同步任务(根据 settings.feishu.bitableSync) */
  registerBitableSync(): void {
    try {
      const s = settingsService.getSettings()
      if (!s.feishu?.bitableSync?.enabled) {
        log('info', 'cron', 'bitableSync disabled, skipping task registration')
        return
      }
      const intervalRaw = s.feishu.bitableSync.syncInterval ?? '0 */6 * * *'
      // syncInterval 可能是 cron 表达式(包含空格)或分钟数
      let expr: string
      if (typeof intervalRaw === 'string' && intervalRaw.trim().split(/\s+/).length >= 5) {
        // 已经是完整的 cron 表达式（5 字段）。B6-2 修复: 必须通过 node-cron 校验,
        // 否则任意 "a b c d e" 或 "* * * * *" 都会被当作合法 cron,导致无限/错误调度。
        const candidate = intervalRaw.trim()
        if (!cron.validate(candidate)) {
          log(
            'warn',
            'cron',
            `bitableSync.syncInterval='${candidate}' 不是合法 cron 表达式,回退到默认 6 小时`,
          )
          expr = '0 */6 * * *'
        } else if (isTooAggressiveCron(candidate)) {
          // B6-2 修复: 拒绝过于激进的调度(如每秒/每分钟),防止 bitable 同步+LLM 成本失控
          log(
            'warn',
            'cron',
            `bitableSync.syncInterval='${candidate}' 过于激进(< 5 分钟),已放宽到每 5 分钟以控制成本`,
          )
          expr = '*/5 * * * *'
        } else {
          expr = candidate
        }
      } else {
        // 视为分钟数，转换为 cron 表达式
        const minutes = typeof intervalRaw === 'number' ? intervalRaw : Number(intervalRaw) || 360
        if (minutes < 60) {
          // B6-2: 分钟数模式下也强制不低于 5 分钟
          const safeMinutes = Math.max(5, Math.round(minutes))
          expr = `*/${safeMinutes} * * * *`
        } else {
          const hours = Math.max(1, Math.round(minutes / 60))
          expr = `0 */${Math.min(23, hours)} * * *`
        }
      }
      const taskId = 'feishu-bitable-sync'
      const task: CronTask = {
        id: taskId,
        name: '飞书 Bitable 同步',
        agentId: '__feishu__',
        expression: expr,
        enabled: true,
        prompt: 'periodic bitable sync heartbeat',
        modelTier: 'low_cost',
      }
      this.tasks.set(taskId, task)
      this.schedule(taskId, task)
      log('info', 'cron', `bitableSync registered, expr='${expr}' taskId=${taskId}`)
    } catch (err) {
      log(
        'warn',
        'cron',
        `bitableSync register failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /** T4: 执行一次 bitable 同步(graceful 降级) */
  // M-3 修复: 添加 30 秒总超时,防止网络 hang 导致 cron 任务卡死
  async executeBitableSync(): Promise<{
    success: boolean
    skipped?: string
    recordId?: string
    error?: string
  }> {
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
      // M-3 修复: 30 秒总超时,防止 getTenantToken + addBitableRecord 累计 hang
      const BITABLE_SYNC_TIMEOUT_MS = 30_000
      let timeoutHandle: NodeJS.Timeout | undefined
      try {
        const result = await Promise.race([
          syncBitableNow(appId, appSecret, appToken, tableId, fields, domain),
          new Promise<{ success: false; error: string }>((resolve) => {
            timeoutHandle = setTimeout(
              () => resolve({ success: false, error: 'bitable sync timed out (30s)' }),
              BITABLE_SYNC_TIMEOUT_MS,
            )
          }),
        ])
        return result
      } finally {
        // R131 修复: 成功路径下主动 clearTimeout,避免 timer 持有 resolve 闭包泄漏 (参考 mcp-client-pool.ts:159-173 R5-1 修复)
        if (timeoutHandle) clearTimeout(timeoutHandle)
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** 启动时从磁盘恢复历史日志 */
  async loadPersistedLogs(): Promise<void> {
    try {
      await fsp.access(this.logFilePath, fs.constants.F_OK)
    } catch {
      return
    }
    try {
      const content = await fsp.readFile(this.logFilePath, 'utf-8')
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
      this.logs = entries
    } catch (err) {
      console.warn('[CronService] Failed to load persisted logs:', err)
    }
  }

  /** 为 Agent 的 schedule 字段自动创建 cron 任务
   * 返回 agentId → cron taskIds 映射,供 AgentService 聚合 nextRunAt(P1-1)
   */
  syncAgentSchedules(
    agents: Array<{
      id: string
      name: string
      schedule: string[]
      modelTier: 'high_quality' | 'low_cost'
    }>,
  ): Map<string, string[]> {
    const mapping: Map<string, string[]> = new Map()

    // 清理已有的 agent-schedule-* 前缀任务
    for (const [id] of this.tasks) {
      if (id.startsWith('agent-schedule-')) {
        this.unschedule(id)
        this.tasks.delete(id)
      }
    }

    for (const agent of agents) {
      const taskIds: string[] = []
      for (let i = 0; i < agent.schedule.length; i++) {
        const expression = agent.schedule[i]
        if (!cron.validate(expression)) continue

        const id = `agent-schedule-${agent.id}-${i}`
        const task: CronTask = {
          id,
          name: `${agent.name} 定时任务 ${i + 1}`,
          agentId: agent.id,
          expression,
          prompt: `执行 ${agent.name} 的定时任务`,
          enabled: true,
          modelTier: agent.modelTier,
        }
        this.tasks.set(id, task)
        this.schedule(id, task)
        taskIds.push(id)
      }
      if (taskIds.length > 0) {
        mapping.set(agent.id, taskIds)
      }
    }
    return mapping
  }

  // ===========================================================
  // 内部方法
  // ===========================================================

  private schedule(id: string, task: CronTask) {
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
    const job = cron.schedule(task.expression, () => this.executeTask(id, 'cron'), {
      timezone,
    })
    this.scheduledJobs.set(id, job)
    // node-cron v4 移除了 'scheduled' 事件, 改用 getNextRun() 同步读取下次执行时间 (P1-8)
    const next = job.getNextRun()
    if (next) {
      this.nextRunAt.set(id, next.toISOString())
    } else {
      // 保守回退: 1 分钟后
      this.nextRunAt.set(id, new Date(Date.now() + 60_000).toISOString())
    }
  }

  private unschedule(id: string) {
    const job = this.scheduledJobs.get(id)
    if (job) {
      job.stop()
    }
    this.scheduledJobs.delete(id)
    this.nextRunAt.delete(id)
  }

  /** 执行任务 — Critical 2.2 修复: __feishu__ 路由到 executeBitableSync 而非 agentRunner
   *  High 2.3 修复: per-task 锁防止 runNow + cron 定时并发执行同一任务
   *  circuit-breaker: source='cron' 受熔断约束(连续配额错误后跳过);source='manual' 绕过熔断 */
  private async executeTask(taskId: string, source: 'cron' | 'manual' = 'cron') {
    const task = this.tasks.get(taskId)
    if (!task) return
    if (!this.mainWindow) return

    // circuit-breaker: cron 触发时若已熔断,跳过执行(避免配额耗尽后持续空转)
    // runNow(manual) 绕过此检查 —— 用户主动操作应执行,成功则顺带重置熔断
    if (source === 'cron' && this.isCircuitTripped(taskId)) {
      const timestamp = Date.now()
      task.lastRunAt = timestamp
      task.lastStatus = 'skipped_circuit_breaker'
      log(
        'warn',
        'cron',
        `Task ${taskId} skipped (circuit breaker tripped after ${CronService.CIRCUIT_BREAKER_THRESHOLD} consecutive quota errors); run manually or toggle off/on to reset`,
      )
      this.pushLog({
        taskId,
        agentId: task.agentId,
        timestamp,
        durationMs: 0,
        status: 'skipped_circuit_breaker',
        error: '配额类错误连续失败,熔断保护已触发',
      })
      this.mainWindow?.webContents.send(IPC.IPC_CRON_STATUS_UPDATE, {
        taskId,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
      })
      return
    }

    // High 2.3 修复: per-task 锁,避免 runNow + cron 同时触发同一任务
    if (this.runningTasks.has(taskId)) {
      log('info', 'cron', `Task ${taskId} already running, skip this trigger`)
      return
    }
    this.runningTasks.add(taskId)

    const timestamp = Date.now()
    const startTime = Date.now()

    try {
      // Critical 2.2 修复: __feishu__ 任务路由到 executeBitableSync
      // 之前所有任务都调 agentRunner(task.agentId, ...),但 __feishu__ 不是真实 agentId,
      // agentRunner('__feishu__', ...) 必然抛 "Agent not found",真正的 executeBitableSync 从未被调用
      if (task.agentId === '__feishu__') {
        const result = await this.executeBitableSync()
        if (!result.success) {
          // 同步失败按 error 记录,但不算 throw,避免污染日志
          log('warn', 'cron', `bitable sync failed: ${result.error ?? result.skipped ?? 'unknown'}`)
          task.lastRunAt = timestamp
          task.lastStatus = 'error'
          this.pushLog({
            taskId,
            agentId: task.agentId,
            timestamp,
            durationMs: Date.now() - startTime,
            status: 'error',
            error: result.error ?? result.skipped ?? 'bitable sync failed',
          })
        } else {
          task.lastRunAt = timestamp
          task.lastStatus = 'success'
          this.recordTaskSuccess(taskId)
          this.pushLog({
            taskId,
            agentId: task.agentId,
            timestamp,
            durationMs: Date.now() - startTime,
            status: 'success',
          })
        }
      } else if (this.agentRunner) {
        // R169 修复: runAgent 内部吞错(经状态事件上报),不再仅凭"未抛错"记 success。
        // 改为依据返回的 AgentExecution.status 记日志;error 时投喂熔断器(429/quota)。
        // undefined = 排队期间被 abort 放弃执行,记 error(skipped)。
        const execution = await this.agentRunner(task.agentId, task.prompt, this.mainWindow)
        task.lastRunAt = timestamp
        if (execution && execution.status === 'success') {
          task.lastStatus = 'success'
          // circuit-breaker: 成功执行重置失败计数(含 runNow 手动成功恢复熔断)
          this.recordTaskSuccess(taskId)

          this.pushLog({
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
          this.recordTaskFailure(taskId, errMsg)

          this.pushLog({
            taskId,
            agentId: task.agentId,
            timestamp,
            durationMs: Date.now() - startTime,
            status: 'error',
            error: errMsg,
          })
        }
      } else {
        console.warn(`[CronService] Agent runner not set, skipping task ${taskId}`)
      }
    } catch (err: unknown) {
      task.lastRunAt = timestamp
      task.lastStatus = 'error'
      const errMsg = err instanceof Error ? err.message : String(err)
      // circuit-breaker: 仅配额类错误(429/quota/rate_limit)累计,普通错误(网络抖动等)不熔断
      this.recordTaskFailure(taskId, errMsg)

      this.pushLog({
        taskId,
        agentId: task.agentId,
        timestamp,
        durationMs: Date.now() - startTime,
        status: 'error',
        error: errMsg,
      })
    } finally {
      // High 2.3: 释放 per-task 锁
      this.runningTasks.delete(taskId)
      // 不管成功失败都发送状态更新（P1-10：被中止的 agent 也算完成了）
      this.mainWindow?.webContents.send(IPC.IPC_CRON_STATUS_UPDATE, {
        taskId,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
      })
    }
  }

  // ===========================================================
  // circuit-breaker 内部方法
  // ===========================================================

  /** 判断错误是否为配额类(持续会失败,值得熔断)。与 agent-service.ts isNonRetryableError 关键词对齐。 */
  private isQuotaError(msg: string): boolean {
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

  /** 记录任务失败:仅配额类错误累加计数,达阈值则熔断 */
  private recordTaskFailure(taskId: string, errMsg: string): void {
    if (!this.isQuotaError(errMsg)) return
    const state = this.circuitBreaker.get(taskId) ?? { consecutiveFails: 0, tripped: false }
    state.consecutiveFails += 1
    if (state.consecutiveFails >= CronService.CIRCUIT_BREAKER_THRESHOLD && !state.tripped) {
      state.tripped = true
      log(
        'warn',
        'cron',
        `Task ${taskId} circuit breaker TRIPPED after ${state.consecutiveFails} consecutive quota errors; subsequent cron triggers will be skipped until a manual run succeeds or the task is toggled`,
      )
    }
    this.circuitBreaker.set(taskId, state)
  }

  /** 记录任务成功:清零失败计数,解除熔断 */
  private recordTaskSuccess(taskId: string): void {
    const state = this.circuitBreaker.get(taskId)
    if (!state) return
    if (state.tripped || state.consecutiveFails > 0) {
      log('info', 'cron', `Task ${taskId} circuit breaker reset (successful execution)`)
    }
    this.circuitBreaker.delete(taskId)
  }

  /** 查询任务是否已熔断 */
  private isCircuitTripped(taskId: string): boolean {
    return this.circuitBreaker.get(taskId)?.tripped === true
  }

  /** 重置任务熔断状态(供 toggleTask 关再开时调用,给用户手动恢复手段) */
  private resetCircuitBreaker(taskId: string): void {
    this.circuitBreaker.delete(taskId)
  }

  private pushLog(entry: CronLogEntry) {
    this.logs.push(entry)
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000)
    }
    // 异步持久化到磁盘（P1-9）
    this.logBuffer.push(entry)
    this.scheduleLogWrite()
  }

  /** 节流写日志：500ms 内合并 */
  private scheduleLogWrite(): void {
    if (this.logWriteTimer) return
    this.logWriteTimer = setTimeout(() => {
      this.logWriteTimer = null
      void this.flushLogs()
    }, 500)
  }

  /** 立即 flush 日志（graceful shutdown）
   *  修复: 写入失败时恢复日志到 buffer 前部,避免日志数据丢失
   *  修复: 文件超过 5MB 时自动轮转,只保留最近 1000 条 */
  async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return
    const toWrite = this.logBuffer
    this.logBuffer = []
    try {
      const lines = `${toWrite.map((e) => JSON.stringify(e)).join('\n')}\n`
      await fsp.appendFile(this.logFilePath, lines, 'utf-8')
      // 日志轮转: 文件超过 5MB 时截断为最近 1000 条
      try {
        const stat = await fsp.stat(this.logFilePath)
        if (stat.size > 5 * 1024 * 1024) {
          const content = await fsp.readFile(this.logFilePath, 'utf-8')
          const allLines = content.split('\n').filter((l) => l.trim().length > 0)
          const recent = allLines.slice(-1000)
          await fsp.writeFile(this.logFilePath, `${recent.join('\n')}\n`, 'utf-8')
          log('info', 'cron', `log file rotated: ${allLines.length} -> ${recent.length} entries`)
        }
      } catch {
        // 轮转失败不影响主流程
      }
    } catch (err) {
      console.error('[CronService] Failed to persist logs:', err)
      // 写入失败时恢复日志到 buffer 前部,下次 flush 会重试
      // 限制 buffer 上限防止无限增长(磁盘满等持续失败场景)
      this.logBuffer.unshift(...toWrite)
      if (this.logBuffer.length > 500) {
        this.logBuffer = this.logBuffer.slice(-500)
      }
    }
  }

  /** 优雅关闭 */
  async shutdown(): Promise<void> {
    if (this.logWriteTimer) {
      clearTimeout(this.logWriteTimer)
      this.logWriteTimer = null
    }
    if (this.userTasksWriteTimer) {
      clearTimeout(this.userTasksWriteTimer)
      this.userTasksWriteTimer = null
    }
    await Promise.all([this.flushLogs(), this.persistUserTasksNow()])
    for (const [, job] of this.scheduledJobs) {
      job.stop()
    }
  }
}

export const cronService = new CronService()
