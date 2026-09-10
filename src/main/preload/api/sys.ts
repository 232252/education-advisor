// =============================================================
// Preload API — 系统域
// =============================================================

import type { SysAPI } from '@shared/api/sys'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import { subscribe } from './subscribe'

export const sysApi: SysAPI = {
  // [r] 打开文件选择对话框
  openDialog: (options: unknown) => ipcInvoke(IPC.IPC_SYS_OPEN_DIALOG, options),
  // [r] 打开保存对话框
  saveDialog: (options: unknown) => ipcInvoke(IPC.IPC_SYS_SAVE_DIALOG, options),
  // [r] 应用版本号(R2-16: About 页唯一来源,防发版漂移)
  getVersion: () => ipcInvoke(IPC.IPC_SYS_GET_VERSION),
  // [r] 获取系统路径(入参为 Electron 固定枚举,主进程窄化校验)
  getPath: (name: string) => ipcInvoke(IPC.IPC_SYS_GET_PATH, name),
  // [r] 弹出更新对话框
  showUpdateDialog: () => ipcInvoke(IPC.IPC_SYS_SHOW_UPDATE_DIALOG),
  // [r] 检查更新
  checkUpdate: () => ipcInvoke(IPC.IPC_SYS_CHECK_UPDATE),
  // [w] 下载更新(M31: electron-updater,进度经 onUpdateProgress 推送)
  downloadUpdate: () => ipcInvoke(IPC.IPC_SYS_DOWNLOAD_UPDATE),
  // [c] 重启并安装已下载的更新(调用后进程退出)
  installUpdate: () => ipcInvoke(IPC.IPC_SYS_INSTALL_UPDATE),
  // [r] 订阅更新下载进度(返回取消订阅函数)
  onUpdateProgress: (callback) => subscribe(IPC.IPC_SYS_UPDATE_PROGRESS, callback),
  // [r] 读取文件内容(文本 utf-8 / 二进制 base64),用于文件上传
  //   安全限制: 文件大小 ≤ 10MB,自动推断 MIME 类型
  readFile: (filePath: string) => ipcInvoke(IPC.IPC_SYS_READ_FILE, filePath),
  // [c] 重启应用(备份恢复后需重启加载数据;调用后进程立即退出)
  restartApp: () => ipcInvoke(IPC.IPC_SYS_RESTART_APP),
  // [c] 出厂重置 — UI 层必须二次确认；成功后应 relaunch
  factoryReset: () => ipcInvoke(IPC.IPC_SYS_FACTORY_RESET),
  getWebUiStatus: () => ipcInvoke(IPC.IPC_SYS_WEBUI_STATUS),
  openWebUi: () => ipcInvoke(IPC.IPC_SYS_WEBUI_OPEN),
  regenerateWebUiToken: () => ipcInvoke(IPC.IPC_SYS_WEBUI_REGEN_TOKEN),
} as SysAPI
