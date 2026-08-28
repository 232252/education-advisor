// =============================================================
// 记忆管理 IPC — 查看/删除各 agent 长期记忆(R2+ 记忆透明化)
// 此前 memory-service 的 deleteEntry/clear 没有任何消费方,
// 用户无法审查"AI 记住了什么";本组通道补齐管理入口
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { type BrowserWindow, ipcMain } from 'electron'
import { memoryService } from '../services/agent/memory-service'

export function registerMemoryHandlers(_win: BrowserWindow) {
  // 列出所有 agent 的记忆(无记忆的 agent 不出现)
  ipcMain.handle(IPC.IPC_MEMORY_LIST, async () => {
    try {
      return memoryService.listAllEntries()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] memory:list failed:', msg)
      return []
    }
  })

  // 删除单条记忆
  ipcMain.handle(IPC.IPC_MEMORY_DELETE_ENTRY, async (_e, agentId: string, entryId: string) => {
    try {
      if (typeof agentId !== 'string' || typeof entryId !== 'string') {
        return { success: false, error: 'invalid arguments' }
      }
      const ok = memoryService.deleteEntry(agentId, entryId)
      return { success: ok, error: ok ? undefined : 'entry not found' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] memory:delete-entry failed:', msg)
      return { success: false, error: msg }
    }
  })

  // 清空某 agent 的全部记忆
  ipcMain.handle(IPC.IPC_MEMORY_CLEAR, async (_e, agentId: string) => {
    try {
      if (typeof agentId !== 'string') {
        return { success: false, error: 'invalid arguments' }
      }
      memoryService.clear(agentId)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] memory:clear failed:', msg)
      return { success: false, error: msg }
    }
  })
}
