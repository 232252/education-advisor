// =============================================================
// Preload API — 数据备份/恢复域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export interface AutoBackupInfo {
  fileName: string
  sizeBytes: number
  createdAt: number
  kind: 'auto' | 'pre-restore'
}

export const backupApi = {
  // [w] 弹保存对话框 → 打包核心数据为 zip
  createDialog: () => ipcRenderer.invoke(IPC.IPC_BACKUP_CREATE_DIALOG),
  // [c] 弹选择对话框 → 校验 → 安全备份 → 替换数据文件(danger, UI 层需二次确认)
  restoreDialog: () => ipcRenderer.invoke(IPC.IPC_BACKUP_RESTORE_DIALOG),
  // [r] 列出 {userData}/backups/ 下的自动/安全备份
  listAuto: () => ipcRenderer.invoke(IPC.IPC_BACKUP_LIST_AUTO),
  // [c] 删除一个备份文件
  deleteAuto: (fileName: string) => ipcRenderer.invoke(IPC.IPC_BACKUP_DELETE_AUTO, fileName),
}
