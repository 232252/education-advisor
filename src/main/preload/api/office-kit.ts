// =============================================================
// Preload API — office 转 PDF 组件
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const officeKitApi = {
  status: () => ipcInvoke(IPC.IPC_OFFICE_KIT_STATUS),
  install: () => ipcInvoke(IPC.IPC_OFFICE_KIT_INSTALL),
}
