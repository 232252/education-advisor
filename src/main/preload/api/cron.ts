// =============================================================
// Preload API — 定时任务域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const cronApi = {
  // [r] 列出任务
  list: () => ipcRenderer.invoke(IPC.IPC_CRON_LIST),
  // [w] 新增任务
  add: (task: unknown) => ipcRenderer.invoke(IPC.IPC_CRON_ADD, task),
  // [w] 更新任务
  update: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.IPC_CRON_UPDATE, id, patch),
  // [c] 删除任务 — UI 层应二次确认
  remove: (id: string) => ipcRenderer.invoke(IPC.IPC_CRON_REMOVE, id),
  // [w] 启停任务
  toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.IPC_CRON_TOGGLE, id, enabled),
  // [w] 立即执行
  runNow: (id: string) => ipcRenderer.invoke(IPC.IPC_CRON_RUN_NOW, id),
  // [r] 读取日志
  getLogs: (taskId?: string) => ipcRenderer.invoke(IPC.IPC_CRON_GET_LOGS, taskId),

  onStatusUpdate: (callback: (data: unknown) => void) => {
    const handler = (_e: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.IPC_CRON_STATUS_UPDATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC.IPC_CRON_STATUS_UPDATE, handler)
    }
  },
}
