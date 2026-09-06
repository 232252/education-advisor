// =============================================================
// IPC API 类型 — 聊天持久化域 (window.api.chat)
// =============================================================

/** 聊天消息入参 — preload/db/save 链路的单一类型来源(此前抄了 4 份) */
export interface ChatMessageInput {
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
}

export interface ChatAPI {
  saveMessage: (msg: ChatMessageInput) => Promise<{ success: boolean; id?: number }>
  loadMessages: (
    sessionId?: string,
  ) => Promise<{ success: boolean; messages: Array<Record<string, unknown>> }>
  deleteSession: (sessionId: string) => Promise<{ success: boolean }>
  /** R2+: 会话重命名(自动起名用) */
  renameSession: (sessionId: string, title: string) => Promise<{ success: boolean; error?: string }>
  listSessions: () => Promise<{
    success: boolean
    sessions: Array<{ id: string; title: string; createdAt: number; messageCount: number }>
  }>
}
