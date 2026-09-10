// =============================================================
// Preload API — 数据备份/恢复域
// =============================================================

import type { BackupAPI } from '@shared/api/backup'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const backupApi: BackupAPI = {
  // [w] 弹保存对话框 → 打包核心数据为 zip
  createDialog: () => ipcInvoke(IPC.IPC_BACKUP_CREATE_DIALOG),
  // [c] 弹选择对话框 → 校验 → 安全备份 → 替换数据文件(danger, UI 层需二次确认)
  restoreDialog: () => ipcInvoke(IPC.IPC_BACKUP_RESTORE_DIALOG),
  // [r] 列出 {userData}/backups/ 下的自动/安全备份
  listAuto: () => ipcInvoke(IPC.IPC_BACKUP_LIST_AUTO),
  // [c] 删除一个备份文件
  deleteAuto: (fileName: string) => ipcInvoke(IPC.IPC_BACKUP_DELETE_AUTO, fileName),
}
