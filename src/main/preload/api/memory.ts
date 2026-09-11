// =============================================================
// Preload API — 记忆管理域(R2+ 记忆透明化)
// =============================================================

import type { MemoryAgentEntries, MemoryAPI, MemoryOpResult } from '@shared/api/memory'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const memoryApi: MemoryAPI = {
  // [r] 列出所有 agent 的记忆
  list: () => ipcInvoke(IPC.IPC_MEMORY_LIST) as Promise<MemoryAgentEntries[]>,
  // [w] 删除单条记忆
  deleteEntry: (agentId: string, entryId: string) =>
    ipcInvoke(IPC.IPC_MEMORY_DELETE_ENTRY, agentId, entryId) as Promise<MemoryOpResult>,
  // [w] 清空某 agent 全部记忆
  clear: (agentId: string) => ipcInvoke(IPC.IPC_MEMORY_CLEAR, agentId) as Promise<MemoryOpResult>,
}
