// =============================================================
// Preload API — 对话持久化域
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcRenderer } from 'electron'

export const chatApi = {
  // [w] 保存对话消息到 SQLite
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
  }) => ipcRenderer.invoke(IPC.IPC_CHAT_SAVE_MESSAGE, msg),
  // [r] 加载对话历史
  loadMessages: (sessionId?: string) => ipcRenderer.invoke(IPC.IPC_CHAT_LOAD_MESSAGES, sessionId),
  // [c] 删除会话 — UI 层应二次确认
  deleteSession: (sessionId: string) => ipcRenderer.invoke(IPC.IPC_CHAT_DELETE_SESSION, sessionId),
  // [r] 列出所有会话
  listSessions: () => ipcRenderer.invoke(IPC.IPC_CHAT_LIST_SESSIONS),
}
