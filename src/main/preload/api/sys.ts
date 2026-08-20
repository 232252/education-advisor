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
  // [w] 下载更新(M31: electron-updater,进度经 onUpdateProgress 推送)
  downloadUpdate: () => ipcRenderer.invoke(IPC.IPC_SYS_DOWNLOAD_UPDATE),
  // [c] 重启并安装已下载的更新(调用后进程退出)
  installUpdate: () => ipcRenderer.invoke(IPC.IPC_SYS_INSTALL_UPDATE),
  // [r] 订阅更新下载进度(返回取消订阅函数)
  onUpdateProgress: (callback: (info: unknown) => void) => {
    const listener = (_e: unknown, info: unknown) => callback(info)
    ipcRenderer.on(IPC.IPC_SYS_UPDATE_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC.IPC_SYS_UPDATE_PROGRESS, listener)
  },
  // [r] 读取文件内容(文本 utf-8 / 二进制 base64),用于文件上传
  //   安全限制: 文件大小 ≤ 10MB,自动推断 MIME 类型
  readFile: (filePath: string) => ipcRenderer.invoke(IPC.IPC_SYS_READ_FILE, filePath),
  // [c] 重启应用(备份恢复后需重启加载数据;调用后进程立即退出)
  restartApp: () => ipcRenderer.invoke(IPC.IPC_SYS_RESTART_APP),
}
