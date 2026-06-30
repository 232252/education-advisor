// =============================================================
// 定时任务 IPC 处理器
// =============================================================

import { type BrowserWindow, ipcMain } from 'electron'
import cron from 'node-cron'
import * as IPC from '../../shared/ipc-channels'
import type { CronTask } from '../../shared/types'
import { cronService } from '../services/cron-service'

export function registerCronHandlers(win: BrowserWindow) {
  // 设置窗口引用，用于推送状态更新
  cronService.setMainWindow(win)

  // 启动时从磁盘恢复历史日志（P1-9 持久化日志的配套）
  cronService.loadPersistedLogs().catch((err) => {
    console.warn('[Cron] Failed to load persisted logs:', err)
  })

  ipcMain.handle(IPC.IPC_CRON_LIST, async () => {
    return cronService.listTasks()
  })

  // P1-36 修复:用 Omit<CronTask, 'id'> 替代 as any,
  // 拒绝畸形数据(空对象/缺失 name/expression 等)
  // H-3 修复:增加 cron 表达式语法校验,防止无效表达式进入调度器
  ipcMain.handle(IPC.IPC_CRON_ADD, async (_e, task: unknown) => {
    if (!task || typeof task !== 'object') {
      throw new Error('task must be a non-null object')
    }
    const t = task as Record<string, unknown>
    if (typeof t.name !== 'string' || t.name.length === 0) {
      throw new Error('task.name must be a non-empty string')
    }
    if (typeof t.expression !== 'string' || t.expression.length === 0) {
      throw new Error('task.expression must be a non-empty string')
    }
    // H-3 修复:校验 cron 表达式语法,拒绝如 "*/foo * * * *" 等畸形表达式
    if (!cron.validate(t.expression)) {
      throw new Error(`task.expression "${t.expression}" 不是合法的 cron 表达式`)
    }
    try {
      const id = cronService.addTask(task as Omit<CronTask, 'id'>)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // P1-37 修复:用 Partial<CronTask> 替代 as any,
  // 过滤 patch 中 id 等不可变字段
  // H-3 修复:update 中若包含 expression,也需校验
  ipcMain.handle(IPC.IPC_CRON_UPDATE, async (_e, id: string, patch: unknown) => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('patch must be a non-null object')
    }
    // 排除 id 字段,防止 id 被篡改
    const { id: _ignored, ...safePatch } = patch as Record<string, unknown>
    if (
      typeof safePatch.expression === 'string' &&
      safePatch.expression.length > 0 &&
      !cron.validate(safePatch.expression)
    ) {
      throw new Error(`expression "${safePatch.expression}" 不是合法的 cron 表达式`)
    }
    return cronService.updateTask(id, safePatch as Partial<CronTask>)
  })

  ipcMain.handle(IPC.IPC_CRON_REMOVE, async (_e, id: string) => {
    return cronService.removeTask(id)
  })

  ipcMain.handle(IPC.IPC_CRON_TOGGLE, async (_e, id: string, enabled: boolean) => {
    return cronService.toggleTask(id, enabled)
  })

  // P1-38 修复:await runNow() 并捕获错误,避免误导前端
  ipcMain.handle(IPC.IPC_CRON_RUN_NOW, async (_e, id: string) => {
    try {
      await cronService.runNow(id)
      return { success: true, message: 'Task execution completed' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Cron] runNow failed for ${id}:`, message)
      return { success: false, message }
    }
  })

  ipcMain.handle(IPC.IPC_CRON_GET_LOGS, async (_e, taskId?: string) => {
    return cronService.getLogs(taskId)
  })

  console.log('[IPC] Cron handlers registered')
}
