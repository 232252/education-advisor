// =============================================================
// Preload API — 学生档案域
// =============================================================

import type { ProfileAPI } from '@shared/api/profile'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const profileApi: ProfileAPI = {
  // [r] 读取学生扩展档案
  get: (name: string) => ipcInvoke(IPC.IPC_PROFILE_GET, name),
  // [w] 写入学生扩展档案
  set: (name: string, data: unknown) => ipcInvoke(IPC.IPC_PROFILE_SET, name, data),
}
