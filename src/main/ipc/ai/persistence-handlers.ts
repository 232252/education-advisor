// =============================================================
// 对话持久化 handler — SQLite 消息/会话读写
// =============================================================

import * as IPC from '@shared/ipc-channels'
import { ipcMain } from 'electron'
import { dbService } from '../../services/db-service'

export function registerAIChatPersistenceHandlers(): void {
  // ----- 对话持久化: 保存消息 -----
  // R4 修复: timestamp 字段可选,未提供时默认 Date.now(),避免 NOT NULL 约束失败
  // M-1 修复: 加 try-catch,db 未就绪或 schema 错误时返回结构化错误而非抛异常
  ipcMain.handle(
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
      try {
        // 健壮性: 若调用方未传 timestamp,自动填充当前时间
        const enrichedMsg = { ...msg, timestamp: msg.timestamp ?? Date.now() }
        const id = dbService.saveChatMessage(enrichedMsg)
        return { success: id >= 0, id }
      } catch (err: unknown) {
        const msg2 = err instanceof Error ? err.message : String(err)
        console.error('[IPC] chat:save-message failed:', msg2)
        return { success: false, id: -1, error: msg2 }
      }
    },
  )

  // ----- 对话持久化: 加载消息 -----
  // M-1 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_CHAT_LOAD_MESSAGES, async (_e, sessionId?: string) => {
    try {
      const messages = dbService.loadChatMessages(sessionId)
      return { success: true, messages }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] chat:load-messages failed:', msg)
      return { success: false, messages: [], error: msg }
    }
  })

  // ----- 对话持久化: 删除会话 -----
  // M-1 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_CHAT_DELETE_SESSION, async (_e, sessionId: string) => {
    try {
      const success = dbService.deleteChatSession(sessionId)
      return { success }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] chat:delete-session failed:', msg)
      return { success: false, error: msg }
    }
  })

  // ----- 对话持久化: 列出所有会话 -----
  // M-1 修复: 加 try-catch
  ipcMain.handle(IPC.IPC_CHAT_LIST_SESSIONS, async () => {
    try {
      const rows = dbService.listChatSessions()
      // DB 列名 snake_case → 前端 camelCase 映射
      const sessions = rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at,
        messageCount: r.message_count,
      }))
      return { success: true, sessions }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[IPC] chat:list-sessions failed:', msg)
      return { success: false, sessions: [], error: msg }
    }
  })
}
