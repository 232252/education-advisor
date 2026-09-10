// =============================================================
// Preload API — 对话持久化域
// =============================================================

import type { ChatAPI, ChatMessageInput } from '@shared/api/chat'
import * as IPC from '@shared/ipc-channels'
import { ipcInvoke } from '@shared/ipc-runtime'

export const chatApi: ChatAPI = {
  // [w] 保存对话消息到 SQLite
  saveMessage: (msg: ChatMessageInput) => ipcInvoke(IPC.IPC_CHAT_SAVE_MESSAGE, msg),
  // [r] 加载对话历史
  loadMessages: (sessionId?: string) => ipcInvoke(IPC.IPC_CHAT_LOAD_MESSAGES, sessionId),
  // [c] 删除会话 — UI 层应二次确认
  deleteSession: (sessionId: string) => ipcInvoke(IPC.IPC_CHAT_DELETE_SESSION, sessionId),
  // [w] 重命名会话(自动起名用)
  renameSession: (sessionId: string, title: string) =>
    ipcInvoke(IPC.IPC_CHAT_RENAME_SESSION, sessionId, title) as Promise<{
      success: boolean
      error?: string
    }>,
  // [r] 列出所有会话
  listSessions: () => ipcInvoke(IPC.IPC_CHAT_LIST_SESSIONS),
}
