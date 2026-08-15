// =============================================================
// Preload API — 学生档案域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const profileApi = {
  // [r] 读取学生扩展档案
  get: (name: string) => ipcRenderer.invoke(IPC.IPC_PROFILE_GET, name),
  // [w] 写入学生扩展档案
  set: (name: string, data: unknown) => ipcRenderer.invoke(IPC.IPC_PROFILE_SET, name, data),
}
