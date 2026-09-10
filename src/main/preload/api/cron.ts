// =============================================================
// Preload API — 定时任务域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import { subscribe } from './subscribe'

export const cronApi = {
  // [r] 列出任务
  list: () => ipcInvoke(IPC.IPC_CRON_LIST),
  // [w] 新增任务
  add: (task: unknown) => ipcInvoke(IPC.IPC_CRON_ADD, task),
  // [w] 更新任务
  update: (id: string, patch: unknown) => ipcInvoke(IPC.IPC_CRON_UPDATE, id, patch),
  // [c] 删除任务 — UI 层应二次确认
  remove: (id: string) => ipcInvoke(IPC.IPC_CRON_REMOVE, id),
  // [w] 启停任务
  toggle: (id: string, enabled: boolean) => ipcInvoke(IPC.IPC_CRON_TOGGLE, id, enabled),
  // [w] 立即执行
  runNow: (id: string) => ipcInvoke(IPC.IPC_CRON_RUN_NOW, id),
  // [r] 读取日志
  getLogs: (taskId?: string) => ipcInvoke(IPC.IPC_CRON_GET_LOGS, taskId),

  // [r] 订阅任务状态变化(返回取消订阅函数)
  onStatusUpdate: (callback: (data: unknown) => void) =>
    subscribe(IPC.IPC_CRON_STATUS_UPDATE, callback),
}
