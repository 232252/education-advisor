// =============================================================
// Preload API — 会话工作目录
// =============================================================

import type { WorkspaceAPI } from '@shared/api/workspace'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const workspaceApi: WorkspaceAPI = {
  listFiles: (sessionId) => ipcInvoke(IPC.IPC_WORKSPACE_LIST, sessionId),
  saveAs: (sessionId, relPath) => ipcInvoke(IPC.IPC_WORKSPACE_SAVE_AS, sessionId, relPath),
}
