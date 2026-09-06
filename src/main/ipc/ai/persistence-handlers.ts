// =============================================================
// 对话持久化 handler — SQLite 消息/会话读写
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { dbService } from '../../services/db-service'
import { handleIpc } from '../handle'

export function registerAIChatPersistenceHandlers(): void {
  // ----- 对话持久化: 保存消息 -----
  // R4 修复: timestamp 字段可选,未提供时默认 Date.now(),避免 NOT NULL 约束失败
  // M-1 修复: 加 try-catch,db 未就绪或 schema 错误时返回结构化错误而非抛异常
  handleIpc(
    IPC.IPC_CHAT_SAVE_MESSAGE,
    async (
      _e,
      msg: {
        sessionId?: string
        role: string
        content: string
        thinking?: string
        toolCalls?: string
        timestamp?: number
        provider?: string
        model?: string
        tokenInput?: number
        tokenOutput?: number
        cost?: number
      },
    ) => {
      // 健壮性: 若调用方未传 timestamp,自动填充当前时间
      const enrichedMsg = { ...msg, timestamp: msg.timestamp ?? Date.now() }
      const id = dbService.saveChatMessage(enrichedMsg)
      return { success: id >= 0, id }
    },
    (msg) => ({ success: false, id: -1, error: msg }),
  )

  // ----- 对话持久化: 加载消息 -----
  // M-1 修复: 加 try-catch
  handleIpc(
    IPC.IPC_CHAT_LOAD_MESSAGES,
    async (_e, sessionId?: string) => {
      const messages = dbService.loadChatMessages(sessionId)
      return { success: true, messages }
    },
    (msg) => ({ success: false, messages: [], error: msg }),
  )

  // ----- 对话持久化: 删除会话 -----
  // M-1 修复: 加 try-catch
  // R2+: 会话重命名(自动起名; 参数校验与 delete 同口径)
  handleIpc(IPC.IPC_CHAT_RENAME_SESSION, async (_e, sessionId: string, title: string) => {
    if (typeof sessionId !== 'string' || typeof title !== 'string' || title.length === 0) {
      return { success: false, error: 'invalid arguments' }
    }
    const success = dbService.renameChatSession(sessionId, title.slice(0, 60))
    return { success }
  })

  handleIpc(IPC.IPC_CHAT_DELETE_SESSION, async (_e, sessionId: string) => {
    const success = dbService.deleteChatSession(sessionId)
    return { success }
  })

  // ----- 对话持久化: 列出所有会话 -----
  // M-1 修复: 加 try-catch
  handleIpc(
    IPC.IPC_CHAT_LIST_SESSIONS,
    async () => {
      const rows = dbService.listChatSessions()
      // DB 列名 snake_case → 前端 camelCase 映射
      const sessions = rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        messageCount: r.message_count,
      }))
      return { success: true, sessions }
    },
    (msg) => ({ success: false, sessions: [], error: msg }),
  )
}
