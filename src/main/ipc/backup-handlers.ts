// =============================================================
// 数据备份/恢复 IPC 处理器
// - backup:create-dialog: 弹保存对话框 → 打包核心数据为 zip
// - backup:restore-dialog: 弹选择对话框 → 校验 → 安全备份 → 恢复(danger)
// - backup:list-auto / delete-auto: 管理 {userData}/backups/
// 返回约定: { success, canceled?, error?, ...data }
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { type BrowserWindow, dialog, ipcMain } from 'electron'
import type { AutoBackupInfo } from '../services/backup-service'
import {
  createBackup,
  deleteAutoBackup,
  listAutoBackups,
  restoreFromZip,
} from '../services/backup-service'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function backupStamp(): string {
  const ts = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`
}

export function registerBackupHandlers(win: BrowserWindow): void {
  ipcMain.handle(IPC.IPC_BACKUP_CREATE_DIALOG, async () => {
    try {
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
    } catch (err) {
      console.error('[IPC] backup:create-dialog failed:', errMessage(err))
      return { success: false, error: errMessage(err) }
    }
  })

  ipcMain.handle(IPC.IPC_BACKUP_RESTORE_DIALOG, async () => {
    try {
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
    } catch (err) {
      console.error('[IPC] backup:restore-dialog failed:', errMessage(err))
      return { success: false, error: errMessage(err) }
    }
  })

  ipcMain.handle(
    IPC.IPC_BACKUP_LIST_AUTO,
    async (): Promise<{
      success: boolean
      data?: AutoBackupInfo[]
      error?: string
    }> => {
      try {
        const data = await listAutoBackups()
        return { success: true, data }
      } catch (err) {
        return { success: false, error: errMessage(err) }
      }
    },
  )

  ipcMain.handle(IPC.IPC_BACKUP_DELETE_AUTO, async (_e, fileName: string) => {
    try {
      await deleteAutoBackup(String(fileName))
      return { success: true }
    } catch (err) {
      return { success: false, error: errMessage(err) }
    }
  })

  console.log('[IPC] Backup handlers registered')
}
