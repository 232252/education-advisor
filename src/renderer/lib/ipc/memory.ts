// =============================================================
// 记忆管理 API 类型(渲染侧 — 与 preload/api/memory.ts 对应)
// =============================================================

export interface MemoryEntryView {
  id: string
  content: string
  category: string
  createdAt: number
}

export interface MemoryAgentEntries {
  agentId: string
  entries: MemoryEntryView[]
}

export interface MemoryOpResult {
  success: boolean
  error?: string
}

export interface MemoryAPI {
  list: () => Promise<MemoryAgentEntries[]>
  deleteEntry: (agentId: string, entryId: string) => Promise<MemoryOpResult>
  clear: (agentId: string) => Promise<MemoryOpResult>
}
