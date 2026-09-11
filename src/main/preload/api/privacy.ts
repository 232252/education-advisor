// =============================================================
// Preload API — 隐私引擎域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const privacyApi = {
  // [w] 初始化(密码仅在本次 IPC 传输,主进程在内存中保留,渲染进程应随后清空自身状态)
  init: (password: string, autoScan?: boolean) =>
    ipcInvoke(IPC.IPC_PRIVACY_INIT, password, autoScan),
  // [w] 载入隐私字典(密码仅在本次 IPC 传输)
  load: (password: string) => ipcInvoke(IPC.IPC_PRIVACY_LOAD, password),
  // [r] 列出映射(使用主进程内存中已缓存的密码,渲染进程无需再传密码)
  list: (password?: string) => ipcInvoke(IPC.IPC_PRIVACY_LIST, password),
  // [w] 新增映射
  add: (entityType: string, text: string) => ipcInvoke(IPC.IPC_PRIVACY_ADD, entityType, text),
  // [r] dry-run 预览
  dryrun: (text: string) => ipcInvoke(IPC.IPC_PRIVACY_DRYRUN, text),
  // [c] 备份映射(写文件到 destPath) — UI 层应二次确认
  backup: (destPath: string) => ipcInvoke(IPC.IPC_PRIVACY_BACKUP, destPath),
  // [w] 锁定(清空主进程内存中的密码,后续隐私操作需重新输入密码)
  lock: () => ipcInvoke(IPC.IPC_PRIVACY_LOCK),
  // [r] 查询隐私引擎状态(是否已加载密码,不返回密码本身)
  status: () => ipcInvoke(IPC.IPC_PRIVACY_STATUS),
}
