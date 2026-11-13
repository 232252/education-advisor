// =============================================================
// 会话工作目录 IPC — 列产出文件 / 另存为
// 路径一律经 session-workspace 防穿越校验；另存走系统保存对话框。
// =============================================================

import { copyFile } from 'node:fs/promises'
import { basename } from 'node:path'
import * as IPC from '@shared/ipc-channels'
import { type BrowserWindow, dialog } from 'electron'
import { listSessionFiles, resolveSessionFile } from '../services/dsh/session-workspace'
import { resolveAppDataDir } from '../services/paths'
import { handleIpc } from './handle'

export function registerWorkspaceHandlers(win: BrowserWindow): void {
  handleIpc(
    IPC.IPC_WORKSPACE_LIST,
    async (_e, sessionId: unknown) => {
      if (typeof sessionId !== 'string' || !sessionId) {
        return { success: false, error: 'sessionId required', files: [] }
      }
      const files = await listSessionFiles(resolveAppDataDir(), sessionId)
      return { success: true, files }
    },
    {
      onError: (msg) => ({ success: false, error: msg, files: [] }),
      label: (sessionId: unknown) => `workspace:list-files failed for "${String(sessionId)}"`,
    },
  )

  handleIpc(
    IPC.IPC_WORKSPACE_SAVE_AS,
    async (_e, sessionId: unknown, relPath: unknown) => {
      if (typeof sessionId !== 'string' || typeof relPath !== 'string') {
        return { success: false, error: 'sessionId and relPath required' }
      }
      const source = await resolveSessionFile(resolveAppDataDir(), sessionId, relPath)
      if (!source) return { success: false, error: '文件不存在或路径非法' }
      if (!win || win.isDestroyed()) return { success: false, error: '窗口不可用' }
      const result = await dialog.showSaveDialog(win, {
        defaultPath: basename(source),
        title: '另存为',
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      await copyFile(source, result.filePath)
      return { success: true, path: result.filePath }
    },
    {
      onError: (msg) => ({ success: false, error: msg }),
      label: () => 'workspace:save-as failed',
    },
  )
}
