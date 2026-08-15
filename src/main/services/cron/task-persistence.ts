// =============================================================
// Cron 用户任务持久化 (cron.user.json 加载/保存) + agent schedule 任务转换
// 从 cron-service.ts 抽出,逻辑零修改(逐行对照搬迁)
// =============================================================

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import type { CronTask } from '@shared/types'
import cron from 'node-cron'
import { log } from '../../utils/logger'

/** 判断是否为用户任务（非系统任务）。系统任务包括 agent-schedule-* 和 feishu-bitable-sync */
export function isUserTask(id: string): boolean {
  return !id.startsWith('agent-schedule-') && id !== 'feishu-bitable-sync'
}

/** restoreUserTasksFile 所需的宿主能力(由 CronService 注入,保持薄委托) */
export interface UserTasksRestoreCtx {
  /** 经宿主 addTask 重建(重新生成 id 并走调度/落盘逻辑) */
  addTask(task: Omit<CronTask, 'id'>): string
  /** 重建后按 newId 回填 lastRunAt/lastStatus */
  tasks: Map<string, CronTask>
}

/**
 * R87 BUG-1 修复：启动时从 cron.user.json 恢复用户任务。
 * 仅恢复用户创建的任务（系统任务由 registerBitableSync / syncAgentSchedules 重建）。
 */
export async function restoreUserTasksFile(
  filePath: string,
  ctx: UserTasksRestoreCtx,
): Promise<void> {
  const persisted = await readUserTasksFile(filePath)
  if (!persisted) return
  let restored = 0
  for (const task of persisted) {
    if (!task || typeof task.id !== 'string' || !isUserTask(task.id)) continue
    // 不直接复用旧 id，避免与当前会话冲突；用 addTask 重新生成 id
    // 但保留 expression/name/agentId/prompt/enabled/modelTier 等业务字段
    try {
      const newId = ctx.addTask({
        name: task.name,
        agentId: task.agentId,
        expression: task.expression,
        prompt: task.prompt,
        enabled: task.enabled ?? true,
        modelTier: task.modelTier,
      })
      // 恢复 lastRunAt/lastStatus（如果存在）
      if (task.lastRunAt || task.lastStatus) {
        const t = ctx.tasks.get(newId)
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
}

/**
 * 读取 cron.user.json 中持久化的用户任务(原始数组)。
 * 文件不存在(首次启动或旧版本)或格式错误时返回 null,由调用方跳过恢复。
 */
export async function readUserTasksFile(filePath: string): Promise<CronTask[] | null> {
  try {
    await fsp.access(filePath, fs.constants.F_OK)
  } catch {
    // 文件不存在（首次启动或旧版本），无需恢复
    return null
  }
  try {
    const content = await fsp.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as { tasks?: CronTask[] }
    if (!parsed || !Array.isArray(parsed.tasks)) {
      log('warn', 'cron', 'cron.user.json 格式错误，跳过恢复')
      return null
    }
    return parsed.tasks
  } catch (err) {
    console.warn('[CronService] Failed to load persisted user tasks:', err)
    return null
  }
}

/**
 * 将用户任务持久化到 cron.user.json (R87 BUG-1 修复)。
 * 原子写: tmp + fsync + rename(与 settings/keystore/profile-service 一致策略)。
 */
export async function persistUserTasksFile(filePath: string, tasks: CronTask[]): Promise<void> {
  try {
    const json = JSON.stringify({ tasks, savedAt: Date.now() }, null, 2)
    // 原子写：tmp + rename（与 profile-service 一致策略）
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    // A6 修复: fd 写入 + fsync 确保任务落盘后再 rename (与 settings/keystore 一致)
    const fd = await fsp.open(tmpPath, 'w')
    try {
      await fd.writeFile(json, 'utf-8')
      await fd.sync()
    } finally {
      await fd.close()
    }
    await fsp.rename(tmpPath, filePath)
  } catch (err) {
    console.error('[CronService] Failed to persist user tasks:', err)
  }
}

// -------------------------------------------------------------
// agent schedule → cron 任务转换(syncAgentSchedules 下沉)
// -------------------------------------------------------------

/** syncAgentSchedules 的入参(与 CronService 公共方法签名保持一致) */
export interface AgentScheduleInput {
  id: string
  name: string
  schedule: string[]
  modelTier: 'high_quality' | 'low_cost'
}

/** syncAgentScheduleTasks 所需的宿主能力(由 CronService 注入,保持薄委托) */
export interface AgentScheduleSyncCtx {
  /** 任务表(直接清理/重建 agent-schedule-* 系统任务) */
  tasks: Map<string, CronTask>
  schedule(id: string, task: CronTask): void
  unschedule(id: string): void
}

/** 为 Agent 的 schedule 字段重建 cron 任务(agents → tasks 纯转换):
 *  清理既有 agent-schedule-* 前缀任务后按当前 agents 重建,
 *  返回 agentId → cron taskIds 映射,供 AgentService 聚合 nextRunAt(P1-1) */
export function syncAgentScheduleTasks(
  agents: AgentScheduleInput[],
  ctx: AgentScheduleSyncCtx,
): Map<string, string[]> {
  const mapping: Map<string, string[]> = new Map()

  // 清理已有的 agent-schedule-* 前缀任务
  for (const [id] of ctx.tasks) {
    if (id.startsWith('agent-schedule-')) {
      ctx.unschedule(id)
      ctx.tasks.delete(id)
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
      ctx.tasks.set(id, task)
      ctx.schedule(id, task)
      taskIds.push(id)
    }
    if (taskIds.length > 0) {
      mapping.set(agent.id, taskIds)
    }
  }
  return mapping
}
