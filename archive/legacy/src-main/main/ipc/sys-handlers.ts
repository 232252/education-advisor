// =============================================================
// 系统 IPC 处理器
// =============================================================

import { app, type BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import * as IPC from '../../shared/ipc-channels'
import { updateService } from '../services/update-service'

export function registerSysHandlers(win: BrowserWindow) {
  // 打开文件选择对话框
  ipcMain.handle(IPC.IPC_SYS_OPEN_DIALOG, async (_e, options: Electron.OpenDialogOptions) => {
    return dialog.showOpenDialog(win, options)
  })

  // 保存文件对话框
  ipcMain.handle(IPC.IPC_SYS_SAVE_DIALOG, async (_e, options: Electron.SaveDialogOptions) => {
    return dialog.showSaveDialog(win, options)
  })

  // 在系统浏览器中打开链接
  ipcMain.handle(IPC.IPC_SYS_OPEN_EXTERNAL, async (_e, url: string) => {
    await shell.openExternal(url)
    return { success: true }
  })

  // 获取系统路径
  // P1-34 修复:用 Parameters<typeof app.getPath>[0] 替代 as any,
  // 避免非法路径名（如 '../evil'）导致 app.getPath 抛错
  ipcMain.handle(IPC.IPC_SYS_GET_PATH, async (_e, name: string) => {
    // app.getPath 的合法入参固定枚举,运行时窄化
    const validNames = [
      'home',
      'appData',
      'userData',
      'sessionData',
      'temp',
      'exe',
      'module',
      'desktop',
      'documents',
      'downloads',
      'music',
      'pictures',
      'videos',
      'recent',
      'logs',
      'crashDumps',
    ] as const
    type ValidPathName = (typeof validNames)[number]
    if (!(validNames as readonly string[]).includes(name)) {
      throw new Error(`Invalid path name: ${name}`)
    }
    return app.getPath(name as ValidPathName)
  })

  // 检查更新
  ipcMain.handle(IPC.IPC_SYS_CHECK_UPDATE, async () => {
    return updateService.checkForUpdates()
  })

  // 弹出更新对话框
  ipcMain.handle(IPC.IPC_SYS_SHOW_UPDATE_DIALOG, async () => {
    await updateService.showUpdateDialog()
    return { success: true }
  })

  // 系统通知
  ipcMain.handle(IPC.IPC_SYS_NOTIFICATION, async (_e, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
    return { success: true }
  })

  console.log('[IPC] System handlers registered')
}
