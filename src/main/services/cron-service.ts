// =============================================================
// Cron Service — 定时任务调度器（编排层，通过 node-cron 驱动 Agent 定时执行）
// 历史: P1-8 nextRunAt / P1-9 日志异步落盘 / P1-10 取消清理 / R87 cron.user.json 持久化
// 重构: 领域逻辑拆分到 ./cron/ 子模块,本文件保留 CRUD 与执行编排:
//   schedule-validation(表达式校验) task-persistence(用户任务+agent schedule)
//   execution(熔断+日志+结果记录) bitable-sync(飞书同步) scheduler-binding(调度绑定)
//   task-executor(executeTask 执行流程: 熔断检查/per-task 锁/路由/结果记录)
// =============================================================

import path from 'node:path'
import * as IPC from '@shared/ipc-channels'
import type { AgentExecution, CronLogEntry, CronTask } from '@shared/types'
import { app, type BrowserWindow } from 'electron'
import type { ScheduledTask } from 'node-cron'
import { registerAutoBackupTask } from './cron/auto-backup-task'
import { executeBitableSyncOnce, registerBitableSyncTask } from './cron/bitable-sync'
import {
  CircuitBreakerRegistry,
  type CronLogBufferState,
  flushLogBuffer,
  pushLogEntry,
  readCronLogFile,
} from './cron/execution'
import {
  type SchedulerBindingState,
  scheduleCronJob,
  unscheduleCronJob,
} from './cron/scheduler-binding'
import { type AgentRunnerFn, executeCronTask } from './cron/task-executor'
import {
  isUserTask,
  persistUserTasksFile,
  restoreUserTasksFile,
  syncAgentScheduleTasks,
} from './cron/task-persistence'

// isTooAggressiveCron 已拆到 ./cron/schedule-validation,此处 re-export 保持既有导入契约
export { isTooAggressiveCron } from './cron/schedule-validation'

class CronService {
  private static readonly MAX_USER_TASKS = 100

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
  /** 待写入的日志缓冲(经 logBufferState 视图由 ./cron/execution.ts 读写;测试直接戳实例字段) */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: 测试直接读写实例 logBuffer(tests/main/cron-service-flush-retry.test.ts),静态分析看不到该访问路径
  private logBuffer: CronLogEntry[] = []
  /** 用户任务写入节流（避免 addTask 高频调用时每次都落盘） */
  private userTasksWriteTimer: NodeJS.Timeout | null = null
  private mainWindow: BrowserWindow | null = null
  /** H-2.3 修复: per-task 执行锁,防止 runNow 与 cron 定时同时触发同一任务造成竞态 */
  private runningTasks: Set<string> = new Set()
  /** circuit-breaker 状态机(见 ./cron/execution.ts) */
  private circuitBreaker = new CircuitBreakerRegistry()

  /** 延迟注入，避免循环依赖 */
  private agentRunner: AgentRunnerFn | null = null

  constructor() {
    this.logFilePath = path.join(app.getPath('userData'), 'cron-logs.jsonl')
    this.userTasksFilePath = path.join(app.getPath('userData'), 'cron.user.json')
  }

  /** 日志缓冲状态视图:字段本体留在实例上(测试直接戳实例 logBuffer 的访问路径),
   *  ./cron/execution.ts 模块函数经此读写同一份字段 */
  private get logBufferState(): CronLogBufferState {
    return this as unknown as CronLogBufferState
  }

  /** R87 BUG-1 修复：启动时从 cron.user.json 恢复用户任务（恢复逻辑见 ./cron/task-persistence.ts） */
  async loadUserTasks(): Promise<void> {
    await restoreUserTasksFile(this.userTasksFilePath, {
      addTask: (t) => this.addTask(t),
      tasks: this.tasks,
    })
  }

  /** R87 BUG-1 修复：将用户任务持久化到 cron.user.json（节流避免高频写盘；shutdown 时立即 flush） */
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
      if (isUserTask(id)) userTasks.push(task)
    }
    await persistUserTasksFile(this.userTasksFilePath, userTasks)
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
      if (isUserTask(id)) userTaskCount++
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
    if (isUserTask(id)) this.persistUserTasksDebounced()
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
    this.circuitBreaker.reset(id)
    // R87 BUG-1 修复：用户任务删除后落盘
    if (isUserTask(id)) this.persistUserTasksDebounced()
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
      this.circuitBreaker.reset(id)
    } else {
      this.unschedule(id)
    }

    // R87 BUG-1 修复：用户任务状态变更后落盘
    if (isUserTask(id)) this.persistUserTasksDebounced()
    return { success: true }
  }

  /** 立即执行任务（手动触发，绕过熔断；成功则重置熔断状态） */
  async runNow(id: string) {
    await this.executeTask(id, 'manual')
  }

  /** 模拟 cron 定时触发执行（供测试与外部调度器使用）。与 cron 回调走同一路径，受熔断器约束。 */
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

  /** T4: 注册 bitable 同步任务(幂等 upsert 逻辑见 ./cron/bitable-sync.ts) */
  registerBitableSync(): void {
    registerBitableSyncTask({
      tasks: this.tasks,
      schedule: (id, task) => this.schedule(id, task),
      unschedule: (id) => this.unschedule(id),
      resetCircuitBreaker: (id) => this.circuitBreaker.reset(id),
    })
  }

  /** M33: 注册定时自动备份任务(幂等 upsert 逻辑见 ./cron/auto-backup-task.ts) */
  registerAutoBackup(): void {
    registerAutoBackupTask({
      tasks: this.tasks,
      schedule: (id, task) => this.schedule(id, task),
      unschedule: (id) => this.unschedule(id),
      resetCircuitBreaker: (id) => this.circuitBreaker.reset(id),
    })
  }

  /** T4: 执行一次 bitable 同步(graceful 降级,30s 超时;见 ./cron/bitable-sync.ts) */
  async executeBitableSync(): Promise<{
    success: boolean
    skipped?: string
    recordId?: string
    error?: string
  }> {
    return executeBitableSyncOnce()
  }

  /** 启动时从磁盘恢复历史日志 */
  async loadPersistedLogs(): Promise<void> {
    const entries = await readCronLogFile(this.logFilePath)
    if (entries) this.logs = entries
  }

  /** 为 Agent 的 schedule 字段自动创建 cron 任务(转换逻辑见 ./cron/task-persistence.ts)
   *  返回 agentId → cron taskIds 映射,供 AgentService 聚合 nextRunAt(P1-1) */
  syncAgentSchedules(
    agents: Array<{
      id: string
      name: string
      schedule: string[]
      modelTier: 'high_quality' | 'low_cost'
    }>,
  ): Map<string, string[]> {
    return syncAgentScheduleTasks(agents, {
      tasks: this.tasks,
      schedule: (id, task) => this.schedule(id, task),
      unschedule: (id) => this.unschedule(id),
    })
  }

  // ===========================================================
  // 内部方法
  // ===========================================================

  /** 调度绑定(时区读取 + nextRunAt 刷新 + M35 错过调度补偿见 ./cron/scheduler-binding.ts) */
  private schedule(id: string, task: CronTask) {
    scheduleCronJob(this.bindingState(), id, task, () => this.executeTask(id, 'cron'))
  }

  private unschedule(id: string) {
    unscheduleCronJob(this.bindingState(), id)
  }

  /** 调度绑定状态视图(M35: runningTasks/pushLog 供错过调度补偿判定与 skipped_missed 日志记录) */
  private bindingState(): SchedulerBindingState {
    return {
      scheduledJobs: this.scheduledJobs,
      nextRunAt: this.nextRunAt,
      runningTasks: this.runningTasks,
      pushLog: (entry) => this.pushLog(entry),
    }
  }

  /** 执行任务 — 执行流程本体见 ./cron/task-executor.ts(纯重构搬移,this 依赖经 ctx 注入)
   *  Critical 2.2: __feishu__ 路由到 executeBitableSync;High 2.3: per-task 锁;
   *  circuit-breaker: source='cron' 受熔断约束,source='manual' 绕过 */
  private async executeTask(taskId: string, source: 'cron' | 'manual' = 'cron') {
    await executeCronTask(
      {
        tasks: this.tasks,
        mainWindow: this.mainWindow,
        circuitBreaker: this.circuitBreaker,
        runningTasks: this.runningTasks,
        agentRunner: this.agentRunner,
        pushLog: (entry) => this.pushLog(entry),
        broadcastStatus: (id, task) => this.broadcastStatus(id, task),
      },
      taskId,
      source,
    )
  }

  /** 广播任务状态到渲染进程 */
  private broadcastStatus(taskId: string, task: CronTask) {
    // M7 修复: send 前判 isDestroyed(与 agent 链路 sendAgentStatus 守卫模式对齐)
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send(IPC.IPC_CRON_STATUS_UPDATE, {
      taskId,
      lastRunAt: task.lastRunAt,
      lastStatus: task.lastStatus,
    })
  }

  /** 追加日志(内存上限 + 节流写盘见 ./cron/execution.ts) */
  private pushLog(entry: CronLogEntry) {
    pushLogEntry(this.logBufferState, entry)
  }

  /** 立即 flush 日志（graceful shutdown;失败回灌见 ./cron/execution.ts） */
  async flushLogs(): Promise<void> {
    await flushLogBuffer(this.logBufferState)
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
      void job.destroy()
    }
  }
}

export const cronService = new CronService()
