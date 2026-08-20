// =============================================================
// 定时任务 IPC 处理器
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { CronTask } from '@shared/types'
import { type BrowserWindow, ipcMain } from 'electron'
import cron from 'node-cron'
import { agentService } from '../services/agent-service'
import { cronService } from '../services/cron-service'

export function registerCronHandlers(win: BrowserWindow) {
  // 设置窗口引用，用于推送状态更新
  cronService.setMainWindow(win)

  // 启动时从磁盘恢复历史日志（P1-9 持久化日志的配套）
  cronService.loadPersistedLogs().catch((err) => {
    console.warn('[Cron] Failed to load persisted logs:', err)
  })

  // R87 BUG-1 修复：启动时从 cron.user.json 恢复用户任务
  cronService.loadUserTasks().catch((err) => {
    console.warn('[Cron] Failed to load persisted user tasks:', err)
  })

  // H-3 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_CRON_LIST, async () => {
    try {
      return cronService.listTasks()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] cron:list failed:', msg)
      // F3 模式: 渲染层契约是 CronTask[],错误时返回空数组而非形状不符的对象
      return []
    }
  })

  // P1-36 修复:用 Omit<CronTask, 'id'> 替代 as any,
  // 拒绝畸形数据(空对象/缺失 name/expression 等)
  // H-3 修复:增加 cron 表达式语法校验,防止无效表达式进入调度器
  // H-3 修复:校验失败返回结构化错误而非抛出
  // R151 修复: node-cron.validate() 对超长字段数(7/9 等)误返回 true,
  // 额外校验字段数为 5 或 6(标准 5 字段 + 扩展带秒 6 字段)
  // R151 修复: 校验 agentId 非空字符串,防止空 agentId 任务进入调度器
  ipcMain.handle(IPC.IPC_CRON_ADD, async (_e, task: unknown) => {
    if (!task || typeof task !== 'object') {
      return { success: false, error: 'task must be a non-null object' }
    }
    const t = task as Record<string, unknown>
    if (typeof t.name !== 'string' || t.name.length === 0) {
      return { success: false, error: 'task.name must be a non-empty string' }
    }
    if (typeof t.expression !== 'string' || t.expression.length === 0) {
      return { success: false, error: 'task.expression must be a non-empty string' }
    }
    // R151 修复: 校验 cron 表达式字段数(5 或 6),拒绝 node-cron 误接受的 7+ 字段
    const fieldCount = t.expression.trim().split(/\s+/).length
    if (fieldCount < 5 || fieldCount > 6) {
      return {
        success: false,
        error: `task.expression "${t.expression}" 字段数 ${fieldCount} 非法,cron 表达式应为 5 或 6 字段`,
      }
    }
    // H-3 修复:校验 cron 表达式语法,拒绝如 "*/foo * * * *" 等畸形表达式
    if (!cron.validate(t.expression)) {
      return { success: false, error: `task.expression "${t.expression}" 不是合法的 cron 表达式` }
    }
    // R151 修复: 校验 agentId 非空字符串(调度执行需要有效 agent)
    if (typeof t.agentId !== 'string' || t.agentId.length === 0) {
      return { success: false, error: 'task.agentId must be a non-empty string' }
    }
    // R155 修复: 校验 agentId 实际存在,防止引用不存在 agent 的任务进入调度器
    if (!agentService.hasAgent(t.agentId)) {
      return {
        success: false,
        error: `task.agentId "${t.agentId}" 不存在,请使用 agent.list 查看可用 agent`,
      }
    }
    try {
      const id = cronService.addTask(task as Omit<CronTask, 'id'>)
      return { success: true, id }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] cron:add failed:', msg)
      return { success: false, error: msg }
    }
  })

  // P1-37 修复:用 Partial<CronTask> 替代 as any,
  // 过滤 patch 中 id 等不可变字段
  // H-3 修复:update 中若包含 expression,也需校验
  // H-3 修复:校验失败/service 调用返回结构化错误而非抛出
  ipcMain.handle(IPC.IPC_CRON_UPDATE, async (_e, id: string, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      return { success: false, error: 'patch must be a non-null object' }
    }
    // 排除 id 字段,防止 id 被篡改
    const { id: _ignored, ...safePatch } = patch as Record<string, unknown>
    if (typeof safePatch.expression === 'string' && safePatch.expression.length > 0) {
      // R151 修复: 校验字段数(同 add)
      const fc = safePatch.expression.trim().split(/\s+/).length
      if (fc < 5 || fc > 6) {
        return {
          success: false,
          error: `expression "${safePatch.expression}" 字段数 ${fc} 非法,应为 5 或 6 字段`,
        }
      }
      if (!cron.validate(safePatch.expression)) {
        return {
          success: false,
          error: `expression "${safePatch.expression}" 不是合法的 cron 表达式`,
        }
      }
    }
    // R151 修复: update 中若包含 agentId,也需校验非空
    if (
      'agentId' in safePatch &&
      (typeof safePatch.agentId !== 'string' || safePatch.agentId.length === 0)
    ) {
      return { success: false, error: 'agentId must be a non-empty string' }
    }
    // R155 修复: update 中若包含 agentId,也需校验存在性
    if (
      'agentId' in safePatch &&
      typeof safePatch.agentId === 'string' &&
      safePatch.agentId.length > 0 &&
      !agentService.hasAgent(safePatch.agentId)
    ) {
      return { success: false, error: `agentId "${safePatch.agentId}" 不存在` }
    }
    try {
      return cronService.updateTask(id, safePatch as Partial<CronTask>)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] cron:update failed for "${id}":`, msg)
      return { success: false, error: msg }
    }
  })

  // H-3 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_CRON_REMOVE, async (_e, id: string) => {
    try {
      return cronService.removeTask(id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] cron:remove failed for "${id}":`, msg)
      return { success: false, error: msg }
    }
  })

  // H-3 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_CRON_TOGGLE, async (_e, id: string, enabled: boolean) => {
    try {
      return cronService.toggleTask(id, enabled)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] cron:toggle failed for "${id}":`, msg)
      return { success: false, error: msg }
    }
  })

  // P1-38 修复:await runNow() 并捕获错误,避免误导前端
  // R3 修复: 不存在的 task 应返回 failure,而非 "Task execution completed"
  ipcMain.handle(IPC.IPC_CRON_RUN_NOW, async (_e, id: string) => {
    try {
      // 先检查任务是否存在,executeTask 对不存在 id 静默 return 会导致误导性 "completed" 消息
      const exists = cronService.listTasks().some((t) => t.id === id)
      if (!exists) {
        return { success: false, message: `Task not found: ${id}` }
      }
      await cronService.runNow(id)
      return { success: true, message: 'Task execution completed' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Cron] runNow failed for ${id}:`, message)
      return { success: false, message }
    }
  })

  // H-3 修复: 加 try-catch
  // F3 修复: catch 返回 [](renderer 契约是 CronLogEntry[]),此前的 {success:false,...} 对象与类型不符
  ipcMain.handle(IPC.IPC_CRON_GET_LOGS, async (_e, taskId?: string) => {
    try {
      return cronService.getLogs(taskId)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[IPC] cron:get-logs failed for "${taskId ?? 'all'}":`, msg)
      return []
    }
  })

  console.log('[IPC] Cron handlers registered')
}
