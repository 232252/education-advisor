// =============================================================
// 记忆管理 IPC — 查看/删除各 agent 长期记忆(R2+ 记忆透明化)
// 此前 memory-service 的 deleteEntry/clear 没有任何消费方,
// 用户无法审查"AI 记住了什么";本组通道补齐管理入口
// =============================================================

import * as IPC from '@shared/ipc-channels'
import type { BrowserWindow } from 'electron'
import { memoryService } from '../services/agent/memory-service'
import { handleIpc } from './handle'

export function registerMemoryHandlers(_win: BrowserWindow) {
  // 列出所有 agent 的记忆(无记忆的 agent 不出现)
  handleIpc(
    IPC.IPC_MEMORY_LIST,
    async () => {
      return memoryService.listAllEntries()
    },
    () => [],
  )

  // 删除单条记忆
  handleIpc(IPC.IPC_MEMORY_DELETE_ENTRY, async (_e, agentId: string, entryId: string) => {
    if (typeof agentId !== 'string' || typeof entryId !== 'string') {
      return { success: false, error: 'invalid arguments' }
    }
    const ok = await memoryService.deleteEntry(agentId, entryId)
    return { success: ok, error: ok ? undefined : 'entry not found' }
  })

  // 清空某 agent 的全部记忆
  handleIpc(IPC.IPC_MEMORY_CLEAR, async (_e, agentId: string) => {
    if (typeof agentId !== 'string') {
      return { success: false, error: 'invalid arguments' }
    }
    await memoryService.clear(agentId)
    return { success: true }
  })
}
