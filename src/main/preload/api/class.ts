// =============================================================
// Preload API — 班级管理域(本地: 存档/删除)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const classApi = {
  // [r] 列出所有班级
  list: () => ipcRenderer.invoke(IPC.IPC_CLASS_LIST),
  // [w] 新建班级
  create: (params: unknown) => ipcRenderer.invoke(IPC.IPC_CLASS_CREATE, params),
  // [w] 更新班级信息（名称/年级/备注/班主任）
  update: (id: string, fields: unknown) => ipcRenderer.invoke(IPC.IPC_CLASS_UPDATE, id, fields),
  // [w] 存档班级（标记隐藏，数据保留）
  archive: (id: string) => ipcRenderer.invoke(IPC.IPC_CLASS_ARCHIVE, id),
  // [w] 恢复班级（取消存档）
  restore: (id: string) => ipcRenderer.invoke(IPC.IPC_CLASS_RESTORE, id),
  // [c] 删除班级（仅删本地记录，学生保留）— UI 层应二次确认
  delete: (id: string) => ipcRenderer.invoke(IPC.IPC_CLASS_DELETE, id),
  // [w] 调班：批量把学生分入班级
  assign: (params: unknown) => ipcRenderer.invoke(IPC.IPC_CLASS_ASSIGN, params),
  // [event] 调班进度（主进程串行 spawn 较慢，实时推送 current/total/assigned/lastName）
  onAssignProgress: (callback: (data: unknown) => void) => {
    const handler = (_e: unknown, data: unknown) => callback(data)
    ipcRenderer.on(IPC.IPC_CLASS_ASSIGN_PROGRESS, handler)
    return () => {
      ipcRenderer.removeListener(IPC.IPC_CLASS_ASSIGN_PROGRESS, handler)
    }
  },
}
