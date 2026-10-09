// =============================================================
// Preload API — dsh-im 连接中心
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'
import { subscribe } from './subscribe'

export const dshImApi = {
  show: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcInvoke(IPC.IPC_DSH_IM_SHOW, bounds),
  hide: () => ipcInvoke(IPC.IPC_DSH_IM_HIDE),
  onClosed: (callback: () => void) => subscribe(IPC.IPC_DSH_IM_CLOSED, callback),
  pluginInstall: () => ipcInvoke(IPC.IPC_DSH_IM_PLUGIN_INSTALL),
}
