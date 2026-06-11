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
import cron from 'node-cron'
import * as IPC from '../../shared/ipc-channels'
import type { CronLogEntry, CronTask } from '../../shared/types'
import { log } from '../utils/logger'
import { syncBitableNow } from './feishu-service'
import { keystoreService } from './keystore-service'
import { settingsService } from './settings-service'

class CronService {
  private tasks: Map<string, CronTask> = new Map()
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map()
  /** 下次执行时间 ISO 字符串 */
  private nextRunAt: Map<string, string> = new Map()
  private logs: CronLogEntry[] = []
  /** 持久化日志路径（追加写入避免频繁重写） */
  private logFilePath: string
  /** 日志写入节流 */
  private logWriteTimer: NodeJS.Timeout | null = null
  /** 待写入的日志缓冲 */
  private logBuffer: CronLogEntry[] = []
  private mainWindow: BrowserWindow | null = null

  /** 延迟注入，避免循环依赖 */
  private agentRunner:
    | ((agentId: string, prompt: string, win: BrowserWindow) => Promise<void>)
    | null = null

  constructor() {
    this.logFilePath = path.join(app.getPath('userData'), 'cron-logs.jsonl')
  }

  setMainWindow(win: BrowserWindow) {
    this.mainWindow = win
  }

  /** 注入 agent 执行函数（由 agent-service 在初始化时调用） */
  setAgentRunner(fn: (agentId: string, prompt: string, win: BrowserWindow) => Promise<void>) {
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
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const fullTask: CronTask = { ...task, id }
    this.tasks.set(id, fullTask)
    this.schedule(id, fullTask)
    return id
  }

  /** 更新任务 */
  updateTask(id: string, patch: Partial<CronTask>) {
    const task = this.tasks.get(id)
    if (!task) return { success: false, error: 'Task not found' }

    this.unschedule(id)
    Object.assign(task, patch)
    this.schedule(id, task)

    return { success: true }
  }

  /** 删除任务 */
  removeTask(id: string) {
    this.unschedule(id)
    this.tasks.delete(id)
    this.nextRunAt.delete(id)
    return { success: true }
  }

  /** 启用/禁用任务 */
  toggleTask(id: string, enabled: boolean) {
    const task = this.tasks.get(id)
    if (!task) return { success: false, error: 'Task not found' }

    task.enabled = enabled

    if (enabled) {
      this.schedule(id, task)
    } else {
      this.unschedule(id)
    }

    return { success: true }
  }

  /** 立即执行任务 */
  async runNow(id: string) {
    await this.executeTask(id)
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
        // 已经是完整的 cron 表达式（5 字段），直接使用
        expr = intervalRaw
      } else {
        // 视为分钟数，转换为 cron 表达式
        const minutes = typeof intervalRaw === 'number' ? intervalRaw : Number(intervalRaw) || 360
        if (minutes < 60) {
          expr = `*/${Math.max(1, Math.round(minutes))} * * * *`
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
  async executeBitableSync(): Promise<{
    success: boolean
    skipped?: string
    recordId?: string
    error?: string
    // U-12: bitable 写入可能含 PII — 透传 addBitableRecord 的预检报告
    piiReport?: {
      hasPII: boolean
      entities: Array<{ kind: string; count: number }>
      privacyEnabled: boolean
    }
  }> {
    try {
      const s = settingsService.getSettings()
      if (!s.feishu?.bitableSync?.enabled) {
        return { success: false, skipped: 'bitableSync disabled' }
      }
      const appId = s.feishu.appId ?? ''
      // appSecret 从 keystore 加密存储读取
      const appSecret = keystoreService.getSecret('feishu-app-secret') ?? ''
      // appToken 暂用 userOpenId 当占位(实际应配独立字段),tableId 硬编码 'log'
      const appToken = s.feishu.userOpenId ?? ''
      const tableId = 'log'
      const fields = {
        timestamp: new Date().toISOString(),
        source: 'education-advisor',
        level: 'info',
        message: 'periodic bitable sync heartbeat',
      }
      return await syncBitableNow(appId, appSecret, appToken, tableId, fields)
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
    const job = cron.schedule(task.expression, () => this.executeTask(id), {
      timezone: 'Asia/Shanghai',
    })
    this.scheduledJobs.set(id, job)
    // 监听 scheduled 事件更新 nextRunAt（P1-8）
    job.on('scheduled', (next: Date) => {
      this.nextRunAt.set(id, next.toISOString())
    })
    // 初始估算：1 分钟后（保守值，会被 scheduled 事件覆盖）
    this.nextRunAt.set(id, new Date(Date.now() + 60_000).toISOString())
  }

  private unschedule(id: string) {
    this.scheduledJobs.get(id)?.stop()
    this.scheduledJobs.delete(id)
    this.nextRunAt.delete(id)
  }

  /** 执行任务 — 调用 agentService.runAgent() */
  private async executeTask(taskId: string) {
    const task = this.tasks.get(taskId)
    if (!task) return
    if (!this.mainWindow) return

    const timestamp = Date.now()
    const startTime = Date.now()

    try {
      if (this.agentRunner) {
        await this.agentRunner(task.agentId, task.prompt, this.mainWindow)
      } else {
        console.warn(`[CronService] Agent runner not set, skipping task ${taskId}`)
      }

      task.lastRunAt = timestamp
      task.lastStatus = 'success'

      this.pushLog({
        taskId,
        agentId: task.agentId,
        timestamp,
        durationMs: Date.now() - startTime,
        status: 'success',
      })
    } catch (err: unknown) {
      task.lastRunAt = timestamp
      task.lastStatus = 'error'

      this.pushLog({
        taskId,
        agentId: task.agentId,
        timestamp,
        durationMs: Date.now() - startTime,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      // 不管成功失败都发送状态更新（P1-10：被中止的 agent 也算完成了）
      this.mainWindow?.webContents.send(IPC.IPC_CRON_STATUS_UPDATE, {
        taskId,
        lastRunAt: task.lastRunAt,
        lastStatus: task.lastStatus,
      })
    }
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

  /** 立即 flush 日志（graceful shutdown） */
  async flushLogs(): Promise<void> {
    if (this.logBuffer.length === 0) return
    const toWrite = this.logBuffer
    this.logBuffer = []
    try {
      const lines = `${toWrite.map((e) => JSON.stringify(e)).join('\n')}\n`
      await fsp.appendFile(this.logFilePath, lines, 'utf-8')
    } catch (err) {
      console.error('[CronService] Failed to persist logs:', err)
    }
  }

  /** 优雅关闭 */
  async shutdown(): Promise<void> {
    if (this.logWriteTimer) {
      clearTimeout(this.logWriteTimer)
      this.logWriteTimer = null
    }
    await this.flushLogs()
    for (const [, job] of this.scheduledJobs) {
      job.stop()
    }
  }
}

export const cronService = new CronService()
