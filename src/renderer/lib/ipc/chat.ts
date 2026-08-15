// =============================================================
// IPC API 类型 — 聊天持久化域 (window.api.chat)
// =============================================================

export interface ChatAPI {
  saveMessage: (msg: {
    sessionId?: string
    role: string
    content: string
    thinking?: string
    toolCalls?: string
    timestamp: number
    provider?: string
    model?: string
    tokenInput?: number
    tokenOutput?: number
    cost?: number
  }) => Promise<{ success: boolean; id?: number }>
  loadMessages: (
    sessionId?: string,
  ) => Promise<{ success: boolean; messages: Array<Record<string, unknown>> }>
  deleteSession: (sessionId: string) => Promise<{ success: boolean }>
  listSessions: () => Promise<{
    success: boolean
    sessions: Array<{ id: string; title: string; createdAt: number; messageCount: number }>
  }>
}
