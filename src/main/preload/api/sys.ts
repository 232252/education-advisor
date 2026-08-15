// =============================================================
// Preload API — 系统域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const sysApi = {
  // [r] 打开文件选择对话框
  openDialog: (options: unknown) => ipcRenderer.invoke(IPC.IPC_SYS_OPEN_DIALOG, options),
  // [r] 打开保存对话框
  saveDialog: (options: unknown) => ipcRenderer.invoke(IPC.IPC_SYS_SAVE_DIALOG, options),
  // [r] 获取系统路径
  getPath: (name: string) => ipcRenderer.invoke(IPC.IPC_SYS_GET_PATH, name),
  // [r] 检查更新
  checkUpdate: () => ipcRenderer.invoke(IPC.IPC_SYS_CHECK_UPDATE),
  showUpdateDialog: () => ipcRenderer.invoke(IPC.IPC_SYS_SHOW_UPDATE_DIALOG),
  // [r] 读取文件内容(文本 utf-8 / 二进制 base64),用于文件上传
  //   安全限制: 文件大小 ≤ 10MB,自动推断 MIME 类型
  readFile: (filePath: string) => ipcRenderer.invoke(IPC.IPC_SYS_READ_FILE, filePath),
}
