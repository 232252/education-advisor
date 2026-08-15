// =============================================================
// Preload API — 技能域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const skillApi = {
  // [r] 列出技能
  list: () => ipcRenderer.invoke(IPC.IPC_SKILL_LIST),
  // [r] 读取技能
  get: (name: string) => ipcRenderer.invoke(IPC.IPC_SKILL_GET, name),
  // [w] 写入技能
  save: (name: string, content: string) => ipcRenderer.invoke(IPC.IPC_SKILL_SAVE, name, content),
  // [c] 删除技能 — UI 层应二次确认
  delete: (name: string) => ipcRenderer.invoke(IPC.IPC_SKILL_DELETE, name),
}
