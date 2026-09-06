// =============================================================
// 数据备份/恢复 IPC 处理器
// - backup:create-dialog: 弹保存对话框 → 打包核心数据为 zip
// - backup:restore-dialog: 弹选择对话框 → 校验 → 安全备份 → 恢复(danger)
// - backup:list-auto / delete-auto: 管理 {userData}/backups/
// 返回约定: { success, canceled?, error?, ...data }
// (失败信封/日志骨架统一走 handleIpc,标签与通道名一致)
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { type BrowserWindow, dialog } from 'electron'
import {
  createBackup,
  deleteAutoBackup,
  listAutoBackups,
  restoreFromZip,
} from '../services/backup-service'
import { formatTimestampFileSafe } from '../utils/format-timestamp'
import { handleIpc } from './handle'

function backupStamp(): string {
  return formatTimestampFileSafe()
}

export function registerBackupHandlers(win: BrowserWindow): void {
  handleIpc(IPC.IPC_BACKUP_CREATE_DIALOG, async () => {
    const result = await dialog.showSaveDialog(win, {
      title: '备份数据到…',
      defaultPath: `education-advisor-backup-${backupStamp()}.zip`,
      filters: [{ name: '备份文件', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true }
    }
    const { files, bytes } = await createBackup(result.filePath)
    return { success: true, path: result.filePath, files, bytes }
  })

  handleIpc(IPC.IPC_BACKUP_RESTORE_DIALOG, async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '选择要恢复的备份文件',
      filters: [{ name: '备份文件', extensions: ['zip'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }
    const restore = await restoreFromZip(result.filePaths[0])
    return { success: true, requiresRestart: true, ...restore }
  })

  handleIpc(IPC.IPC_BACKUP_LIST_AUTO, async () => {
    const data = await listAutoBackups()
    return { success: true, data }
  })

  handleIpc(IPC.IPC_BACKUP_DELETE_AUTO, async (_e, fileName: string) => {
    await deleteAutoBackup(String(fileName))
    return { success: true }
  })

  console.log('[IPC] Backup handlers registered')
}
